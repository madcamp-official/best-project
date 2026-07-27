package com.madcamp.server.session

import com.madcamp.server.config.GameConfig
import com.madcamp.server.config.Palette
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.StartCellAssigner
import com.madcamp.server.domain.World
import org.springframework.stereotype.Service
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class PlayerSession(val roomId: String, val holderId: Int, var nickname: String)

/**
 * 게스트 토큰(UUID) ↔ (방·holderId) 매핑. plan.md §2 "게스트 세션 — 닉네임 + localStorage 토큰".
 * World 자체는 GameLoop 단일 스레드 안에서만 건드리는 전제이고, 여기선 토큰 조회/발급만 담당한다.
 * 다중 방: 세션은 자신이 속한 roomId를 기억해 재접속 시 원래 방으로 복구되게 한다.
 */
@Service
class SessionService {
    private val sessionsByToken = ConcurrentHashMap<String, PlayerSession>()

    /** 토큰이 기억하는 방 id(재접속 라우팅용). 없으면 null. */
    fun roomOf(token: String?): String? = token?.let { sessionsByToken[it]?.roomId }

    /** 기존 토큰이면 그대로 복구, 아니면 roomId의 World에 새 holder를 등록하고 새 토큰을 발급한다. */
    fun joinOrRestore(roomId: String, world: World, config: GameConfig, nickname: String?, token: String?): Pair<String, PlayerSession> {
        if (token != null) {
            sessionsByToken[token]?.let { return token to it } // 재접속 — 방어막 재부여 없음(이미 하던 게임 이어감)
        }
        val newToken = UUID.randomUUID().toString()
        val holderId = allocateHolderId(world)
        val name = nickname?.trim().takeUnless { it.isNullOrEmpty() }?.take(12) ?: "player$holderId"
        // web/src/config.ts PLAYER_PALETTE_IDXS(현재 5슬롯)와 동일 규칙으로 순환 배정.
        // 5명을 넘으면 색이 겹칠 수 있음 — 데모 규모에서는 허용(같은 comment가 클라 쪽에도 있음).
        val paletteIdx = Palette.PLAYER_IDXS[(holderId - 1).mod(Palette.PLAYER_IDXS.size)]

        val holder = Holder(holderId, name, paletteIdx)
        world.holders[holderId] = holder
        // 이미 접속 중인 다른 클라는 이 holder를 모른다 — 다음 DELTA에 같이 실어 보내
        // paletteIdx를 몰라 땅 색을 잘못(fallback) 칠하는 순간이 생기지 않게 한다.
        world.pendingNewHolders.add(holder)
        val startIndex = requireNotNull(StartCellAssigner.pick(world)) { "배정 가능한 중립 동이 없습니다(맵이 가득 참)." }
        world.ownerId[startIndex] = holderId
        world.troops[startIndex] = world.troopCap[startIndex]
        world.dirty.add(startIndex)
        val nowMs = System.currentTimeMillis()
        GameCore.applyShield(world, config, holderId, nowMs) // 신규 참가 스폰 방어막(SPAWN_SHIELD_SEC)
        GameCore.pushLog(world, "${world.meta[startIndex].name}에서 ${name}님이 시작합니다.", nowMs)

        val session = PlayerSession(roomId, holderId, name)
        sessionsByToken[newToken] = session
        return newToken to session
    }

    /** 1..254 순환 할당. 254를 넘으면 1부터 재사용(이미 쓰이는 id는 건너뜀). */
    private fun allocateHolderId(world: World): Int {
        var candidate = world.nextHolderId
        repeat(254) {
            if (candidate !in world.holders) {
                world.nextHolderId = if (candidate >= 254) 1 else candidate + 1
                return candidate
            }
            candidate = if (candidate >= 254) 1 else candidate + 1
        }
        error("holderId 254개가 모두 사용 중입니다.")
    }
}
