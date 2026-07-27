package com.madcamp.server.loop

import com.madcamp.server.auth.AppUserRepository
import com.madcamp.server.config.ConfigService
import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.HolderIds
import com.madcamp.server.data.BoundaryDataLoader
import com.madcamp.server.domain.EnvAi
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.World
import com.madcamp.server.game.Room
import com.madcamp.server.game.RoomManager
import com.madcamp.server.game.RoomState
import com.madcamp.server.ws.RoomBroadcaster
import com.madcamp.server.ws.dto.DeltaMessage
import com.madcamp.server.ws.dto.LeaderboardMessage
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Component
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 모든 방(Room)의 월드를 만지는 유일한 스레드. plan.md §3/§6 — 명령(JOIN/SORTIE…)도 tick도,
 * 그리고 방 생명주기 전환(월드 생성/시작/종료)도 전부 이 단일 executor 위에서 순서대로 실행되므로
 * 어떤 방의 World에도 락이 필요 없다. 매 tick PLAYING 방을 순회하며 각 방의 accumulator로
 * 진행하고, 라운드 종료(51% 지배 또는 제한 시간)를 판정한다.
 *
 * 레거시/개발 호환 브리지: 서버 시작 시 기본 방 1개를 PLAYING으로 띄우고, 그 방의 브로드캐스트를
 * 레거시 전역 토픽(/topic/world, /topic/leaderboard)에도 미러링한다. 정식 클라는 로비(/app/lobby/…)로
 * 진입하고 이 방/토픽을 쓰지 않지만, /app/join·/topic/world에 의존하는 스모크테스트 도구
 * (server/tools/smoke-test)는 이 브리지로 계속 동작한다. 로비 목록에는 기본 방을 숨긴다.
 */
@Component
class GameLoop(
    private val boundaryDataLoader: BoundaryDataLoader,
    private val configService: ConfigService,
    private val roomManager: RoomManager,
    private val roomBroadcaster: RoomBroadcaster,
    private val messagingTemplate: SimpMessagingTemplate,
    private val appUserRepository: AppUserRepository,
) {
    private val log = LoggerFactory.getLogger(GameLoop::class.java)
    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "game-loop") }

    // 경계 데이터는 한 번만 로드해 모든 방이 공유한다(정적·불변). 첫 접근(start)에서 로드.
    private val cells by lazy { boundaryDataLoader.load() }

    @EventListener(ApplicationReadyEvent::class)
    fun start() {
        // 레거시/스모크테스트 호환 브리지: 기본 방을 PLAYING으로 띄운다(정식 경로는 로비).
        val room = roomManager.createWithId(RoomManager.DEFAULT_ROOM_ID, "기본 방")
        room.world = createFreshWorld()
        room.state = RoomState.PLAYING
        room.roundStartMs = System.currentTimeMillis()
        room.lastTickNanos = System.nanoTime()
        log.info("World ready: {} cells (default room)", room.world!!.n)

        executor.scheduleAtFixedRate({ safeTick() }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS)
    }

    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
            log.warn("game-loop executor did not stop within timeout")
        }
    }

    /** 프레시 월드 1개 생성(경계 데이터 + 환경세력 스폰). 방 라운드 시작·재생성에서 재사용. */
    fun createFreshWorld(): World {
        val fresh = World.create(cells, configService.current)
        EnvAi.spawn(fresh, configService.current)
        return fresh
    }

    /** JOIN처럼 결과를 즉시 돌려줘야 할 때. 방/월드가 없으면 null. block은 executor에서 실행. */
    fun <T> runOnRoom(roomId: String, block: (World) -> T): T? =
        executor.submit(Callable { roomManager.get(roomId)?.world?.let(block) }).get()

    /** 액션 명령처럼 결과를 기다릴 필요 없을 때. 방/월드가 없으면 no-op. */
    fun submitOnRoom(roomId: String, block: (World) -> Unit) {
        executor.execute {
            val world = roomManager.get(roomId)?.world ?: return@execute
            block(world)
        }
    }

    /** 방 자체(멤버·상태·world 교체 등)를 executor 위에서 안전하게 조작할 때(로비/라운드 전환용). */
    fun submitRoomTask(block: () -> Unit) = executor.execute(block)
    fun <T> runRoomTask(block: () -> T): T = executor.submit(Callable(block)).get()

    private fun safeTick() {
        try {
            val config = configService.current
            for (room in roomManager.playingRooms()) {
                try {
                    tickRoom(room, config)
                } catch (e: Exception) {
                    // 방 하나의 예외가 다른 방들의 tick까지 멈추지 않게 방 단위로 격리한다.
                    log.error("room {} tick failed", room.id, e)
                }
            }
        } catch (e: Exception) {
            log.error("game loop tick failed", e)
        }
    }

    private fun tickRoom(room: Room, config: GameConfig) {
        val world = room.world ?: return
        val now = System.nanoTime()
        val dtSec = (now - room.lastTickNanos) / 1_000_000_000.0
        room.lastTickNanos = now
        val wallNow = System.currentTimeMillis()

        GameCore.tickProduction(world, config, dtSec)
        GameCore.tickOrders(world, config, wallNow)
        GameCore.tickAnnex(world, config, wallNow, wallNow)
        EnvAi.maybeAct(world, config, wallNow)

        // 미사일 스폰 (MISSILE_SPAWN_SEC 주기)
        room.missileAccumSec += dtSec
        if (room.missileAccumSec >= config.missileSpawnSec) {
            room.missileAccumSec = 0.0
            val spawned = GameCore.trySpawnMissile(world, config, room.rng)
            if (spawned >= 0) world.pendingMissileAdd.add(spawned)
        }

        // 보급선 흐름 (SUPPLY_INTERVAL_SEC 주기)
        room.supplyAccumSec += dtSec
        if (room.supplyAccumSec >= config.supplyIntervalSec) {
            room.supplyAccumSec = 0.0
            GameCore.tickSupply(world, config, wallNow)
        }

        // 자동 공세 (AGGRO_INTERVAL_SEC 주기) — 켜진 플레이어의 최전선이 인접 적·중립을 자동 출정
        room.aggroAccumSec += dtSec
        if (room.aggroAccumSec >= config.aggroIntervalSec) {
            room.aggroAccumSec = 0.0
            GameCore.tickAggro(world, config, wallNow)
        }

        broadcastDelta(room, wallNow)
        room.tickCount++
        if (room.tickCount % LEADERBOARD_EVERY_N_TICKS == 0L) broadcastLeaderboard(room)
        checkRoundEnd(room, config, wallNow)
    }

    // 라운드 종료 판정. 시간 종료(제한 시간)는 매 tick 저렴하게, 지배(51%) 판정은 1Hz에만.
    // 기본 브리지 방은 라운드 개념이 없어 종료하지 않는다.
    private fun checkRoundEnd(room: Room, config: GameConfig, wallNow: Long) {
        if (room.id == RoomManager.DEFAULT_ROOM_ID) return
        val world = room.world ?: return
        val timedOut = wallNow - room.roundStartMs >= config.roundDurationSec * 1000L
        val dominator =
            if (room.tickCount % LEADERBOARD_EVERY_N_TICKS == 0L) GameCore.dominationHolder(world, config) else -1
        if (dominator < 0 && !timedOut) return

        val reason = if (dominator >= 0) "DOMINATION" else "TIMEOUT"
        val winnerId = if (dominator >= 0) dominator else GameCore.getLeaderboard(world).firstOrNull()?.holderId ?: -1
        endRound(room, winnerId, reason)
    }

    // 라운드 종료 → 결과 브로드캐스트 → 프레시 빈 월드로 재생성하고 LOBBY 복귀(멤버 유지, holderId 리셋).
    private fun endRound(room: Room, winnerHolderId: Int, reason: String) {
        val world = room.world
        val leaderboard = world?.let { GameCore.getLeaderboard(it) } ?: emptyList()
        val winnerName = world?.holders?.get(winnerHolderId)?.name
        roomBroadcaster.broadcastRoundEnd(room, reason, winnerHolderId, winnerName, leaderboard)
        log.info("Room {} round ended ({}), winner={}", room.id, reason, winnerName)

        room.state = RoomState.ENDED
        // 구글 로그인(feat/google-login) 계정에 전적을 쌓는다 — holderId 리셋 전에, 승자와 같은
        // holderId를 가졌던 멤버를 승리로 집계한다. 게스트(appUserId=null)는 대상 아님.
        for (member in room.members.values) {
            val appUserId = member.appUserId ?: continue
            recordRoundResult(appUserId, won = member.holderId == winnerHolderId)
        }
        // 다음 라운드를 위해 프레시 빈 월드로 교체하고 LOBBY로 되돌린다. 멤버는 유지(대기 후 재시작).
        room.world = createFreshWorld()
        for (member in room.members.values) {
            member.holderId = -1
            member.ready = false // 다음 라운드는 다시 준비부터(방장 제외 전원 준비 시 시작 가능)
        }
        room.roundStartMs = 0
        room.winnerHolderId = -1
        room.tickCount = 0
        room.state = RoomState.LOBBY

        if (room.members.isEmpty()) {
            roomManager.remove(room.id) // 아무도 안 남은 방은 정리
        } else {
            roomBroadcaster.broadcastRoomState(room)
        }
        roomBroadcaster.broadcastRoomList()
    }

    // 라운드 1회 참여를 계정 전적에 반영(gamesPlayed 항상 +1, 승자면 wins도 +1). H2 로컬 파일
    // DB라 지연이 미미하고, 라운드 종료는 어차피 무거운 이벤트(월드 재생성·브로드캐스트)라
    // 여기서 동기 호출해도 tick 주기에 영향 없다.
    private fun recordRoundResult(appUserId: Long, won: Boolean) {
        val user = appUserRepository.findById(appUserId).orElse(null) ?: return
        user.gamesPlayed++
        if (won) user.wins++
        appUserRepository.save(user)
    }

    private fun broadcastDelta(room: Room, nowMs: Long) {
        val world = room.world ?: return
        val dirty = GameCore.drainDirty(world)
        val newOrders = world.pendingNewOrders.toList()
        world.pendingNewOrders.clear()
        // web/src/world/worldView.ts applyDelta가 "서버는 최신순으로 보낸다"고 가정하고 events를
        // 앞에 붙인다 — pendingEvents는 발생 순(오래된 것부터)이라 뒤집어서 보낸다.
        val events = world.pendingEvents.asReversed().toList()
        world.pendingEvents.clear()
        val missileAdd = world.pendingMissileAdd.toList()
        world.pendingMissileAdd.clear()
        val missileRemove = world.pendingMissileRemove.toList()
        world.pendingMissileRemove.clear()
        val missileImpacts = world.pendingMissileImpacts.toList()
        world.pendingMissileImpacts.clear()
        val newHolders = world.pendingNewHolders.toList()
        world.pendingNewHolders.clear()
        val shieldUpdates = world.pendingShields.toList()
        world.pendingShields.clear()

        val enclosedList = (0 until world.n).filter { world.enclosedBy[it] >= 0 }
        val enclosedKey = enclosedList.joinToString(",")
        val enclosedChanged = enclosedKey != room.lastEnclosedKey

        val nukeChanged = world.nukeDirty
        world.nukeDirty = false

        if (dirty.isEmpty() && newOrders.isEmpty() && events.isEmpty() &&
            missileAdd.isEmpty() && missileRemove.isEmpty() && missileImpacts.isEmpty() &&
            newHolders.isEmpty() && shieldUpdates.isEmpty() && !enclosedChanged && !nukeChanged
        ) {
            return
        }
        room.lastEnclosedKey = enclosedKey

        val cells = dirty.map { intArrayOf(it, world.ownerId[it], world.troops[it]) }
        val msg = DeltaMessage(
            nowMs, cells, newOrders, events, missileAdd, missileRemove, missileImpacts, newHolders,
            shieldUpdates,
            enclosed = if (enclosedChanged) enclosedList else null,
            nukeReadyAtMs = if (nukeChanged) world.nukeReadyAt.toList() else null,
        )
        messagingTemplate.convertAndSend(worldTopic(room.id), msg)
        if (room.id == RoomManager.DEFAULT_ROOM_ID) messagingTemplate.convertAndSend(LEGACY_WORLD_TOPIC, msg)
    }

    private fun broadcastLeaderboard(room: Room) {
        val world = room.world ?: return
        val rows = GameCore.getLeaderboard(world)
        val envCells = GameCore.ownedCount(world, HolderIds.ENV)
        val msg = LeaderboardMessage(rows, envCells, world.n)
        messagingTemplate.convertAndSend(leaderboardTopic(room.id), msg)
        if (room.id == RoomManager.DEFAULT_ROOM_ID) messagingTemplate.convertAndSend(LEGACY_LEADERBOARD_TOPIC, msg)
    }

    companion object {
        private const val TICK_MS = 200L // 5Hz
        private const val LEADERBOARD_EVERY_N_TICKS = 5L // 1Hz
        private const val LEGACY_WORLD_TOPIC = "/topic/world"
        private const val LEGACY_LEADERBOARD_TOPIC = "/topic/leaderboard"

        fun worldTopic(roomId: String) = "/topic/room/$roomId/world"
        fun leaderboardTopic(roomId: String) = "/topic/room/$roomId/leaderboard"
    }
}
