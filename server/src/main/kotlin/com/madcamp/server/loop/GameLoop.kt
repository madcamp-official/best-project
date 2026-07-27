package com.madcamp.server.loop

import com.madcamp.server.config.ConfigService
import com.madcamp.server.config.HolderIds
import com.madcamp.server.data.BoundaryDataLoader
import com.madcamp.server.domain.EnvAi
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.World
import com.madcamp.server.persistence.SnapshotService
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
 * 월드 상태를 만지는 유일한 스레드. plan.md §3 "게임 로직의 진실은 서버 하나" +
 * plan.md §6 "동시성 검증" 리스크에 대한 답: 명령(JOIN/SORTIE)도 tick도 전부 이
 * 단일 스레드 executor 위에서 순서대로 실행되므로 World에 락이 필요 없다.
 *
 * tick 주기 = DELTA 브로드캐스트 주기(api-spec.md §2.5, 5Hz)와 그대로 맞춘다.
 */
@Component
class GameLoop(
    private val boundaryDataLoader: BoundaryDataLoader,
    private val configService: ConfigService,
    private val snapshotService: SnapshotService,
    private val messagingTemplate: SimpMessagingTemplate,
) {
    private val log = LoggerFactory.getLogger(GameLoop::class.java)
    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "game-loop") }

    final lateinit var world: World
        private set

    private var lastTickNanos = 0L
    private var tickCount = 0L
    private val rng = java.util.Random()
    private var missileAccumSec = 0.0
    private var supplyAccumSec = 0.0

    @EventListener(ApplicationReadyEvent::class)
    fun start() {
        world = snapshotService.tryRestore(boundaryDataLoader) ?: createFreshWorld()
        log.info("World ready: {} cells, {} holders", world.n, world.holders.size)

        lastTickNanos = System.nanoTime()
        executor.scheduleAtFixedRate({ safeTick() }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS)
    }

    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (executor.awaitTermination(5, TimeUnit.SECONDS).not()) {
            log.warn("game-loop executor did not stop within timeout")
        }
        if (::world.isInitialized) {
            snapshotService.save(world)
            log.info("World snapshot saved on shutdown")
        }
    }

    private fun createFreshWorld(): World {
        val cells = boundaryDataLoader.load()
        val fresh = World.create(cells, configService.current)
        EnvAi.spawn(fresh, configService.current)
        return fresh
    }

    /** JOIN처럼 결과(WELCOME 등)를 즉시 돌려줘야 할 때. tick 사이 최대 TICK_MS만큼 대기할 수 있다. */
    fun <T> runOnLoop(block: (World) -> T): T = executor.submit(Callable { block(world) }).get()

    /** SORTIE처럼 결과를 기다릴 필요 없는 명령. */
    fun submitOnLoop(block: (World) -> Unit) {
        executor.execute { block(world) }
    }

    private fun safeTick() {
        try {
            tick()
        } catch (e: Exception) {
            log.error("game loop tick failed", e)
        }
    }

    private fun tick() {
        val config = configService.current
        val now = System.nanoTime()
        val dtSec = (now - lastTickNanos) / 1_000_000_000.0
        lastTickNanos = now
        val wallNow = System.currentTimeMillis()

        GameCore.tickProduction(world, config, dtSec)
        GameCore.tickOrders(world, config, wallNow)
        GameCore.tickAnnex(world, config, wallNow, wallNow)
        EnvAi.maybeAct(world, config, wallNow)

        // 미사일 스폰 (MISSILE_SPAWN_SEC 주기)
        missileAccumSec += dtSec
        if (missileAccumSec >= config.missileSpawnSec) {
            missileAccumSec = 0.0
            val spawned = GameCore.trySpawnMissile(world, config, rng)
            if (spawned >= 0) world.pendingMissileAdd.add(spawned)
        }

        // 보급선 흐름 (SUPPLY_INTERVAL_SEC 주기) — 집결지 방향으로 후방 병력 한 홉 행군(B2)
        supplyAccumSec += dtSec
        if (supplyAccumSec >= config.supplyIntervalSec) {
            supplyAccumSec = 0.0
            GameCore.tickSupply(world, config, wallNow)
        }

        broadcastDelta(wallNow)
        tickCount++
        if (tickCount % LEADERBOARD_EVERY_N_TICKS == 0L) broadcastLeaderboard()
        if (tickCount % AUTOSAVE_EVERY_N_TICKS == 0L) snapshotService.save(world)
    }

    private fun broadcastDelta(nowMs: Long) {
        val dirty = GameCore.drainDirty(world)
        val newOrders = world.pendingNewOrders.toList()
        world.pendingNewOrders.clear()
        // web/src/world/worldView.ts applyDelta가 "서버는 최신순으로 보낸다"고 가정하고
        // msg.events를 앞에 붙인다 — pendingEvents는 발생 순(오래된 것부터)이라 뒤집어서 보낸다.
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
        if (dirty.isEmpty() && newOrders.isEmpty() && events.isEmpty() &&
            missileAdd.isEmpty() && missileRemove.isEmpty() && missileImpacts.isEmpty() &&
            newHolders.isEmpty() && shieldUpdates.isEmpty()
        ) {
            return
        }

        val cells = dirty.map { intArrayOf(it, world.ownerId[it], world.troops[it]) }
        messagingTemplate.convertAndSend(
            "/topic/world",
            DeltaMessage(nowMs, cells, newOrders, events, missileAdd, missileRemove, missileImpacts, newHolders, shieldUpdates),
        )
    }

    private fun broadcastLeaderboard() {
        val rows = GameCore.getLeaderboard(world)
        val envCells = GameCore.ownedCount(world, HolderIds.ENV)
        messagingTemplate.convertAndSend("/topic/leaderboard", LeaderboardMessage(rows, envCells, world.n))
    }

    companion object {
        private const val TICK_MS = 200L // 5Hz
        private const val LEADERBOARD_EVERY_N_TICKS = 5L // 1Hz
        private const val AUTOSAVE_EVERY_N_TICKS = 150L // 30초마다(비정상 종료 대비 안전망)
    }
}
