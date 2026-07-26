package com.madcamp.server.session

import com.madcamp.server.config.HolderIds
import com.madcamp.server.domain.GameCore
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.World
import org.springframework.stereotype.Service
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** README §7.1 — 언젠가 12색 팔레트가 목표. 클라 PALETTE(현재 web/src/config.ts)가 이보다
 * 작으면 클라 쪽에서 마저 채워야 한다(README 부록A "12색 팔레트 실제 색값" 미정 항목). */
private const val PALETTE_SIZE = 12

data class PlayerSession(val holderId: Int, var nickname: String)

/**
 * 게스트 토큰(UUID) ↔ holderId 매핑. plan.md §2 "게스트 세션 — 닉네임 + localStorage 토큰".
 * World 자체는 건드리지 않고(GameLoop.runOnLoop 안에서 호출되는 전제), 토큰 조회/발급만 담당.
 */
@Service
class SessionService {
    private val sessionsByToken = ConcurrentHashMap<String, PlayerSession>()

    /** 기존 토큰이면 그대로 복구, 아니면 새 holder를 World에 등록하고 새 토큰을 발급한다. */
    fun joinOrRestore(world: World, nickname: String?, token: String?): Pair<String, PlayerSession> {
        if (token != null) {
            sessionsByToken[token]?.let { return token to it }
        }
        val newToken = UUID.randomUUID().toString()
        val holderId = allocateHolderId(world)
        val name = nickname?.trim().takeUnless { it.isNullOrEmpty() }?.take(12) ?: "player$holderId"
        val paletteIdx = (holderId - 1).mod(PALETTE_SIZE)

        world.holders[holderId] = Holder(holderId, name, paletteIdx)
        val startIndex = StartCellAssigner.pick(world)
        world.ownerId[startIndex] = holderId
        world.troops[startIndex] = world.troopCap[startIndex]
        world.dirty.add(startIndex)
        GameCore.pushLog(world, "${world.meta[startIndex].name}에서 ${name}님이 시작합니다.", System.currentTimeMillis())

        val session = PlayerSession(holderId, name)
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

private object StartCellAssigner {
    /**
     * 신규 참가자 시작 동 배정(plan.md Day 3 "기존 영토와 겹치지 않는 중립 동, 전국에 분산").
     * 이미 플레이어가 있는 시군구를 우선 피해 무작위로 골라 수도권 등 특정 지역 쏠림을 줄인다.
     * 정교한 인구/지역 가중치 배정은 아님 — 데모 스코프의 단순 휴리스틱.
     */
    fun pick(world: World): Int {
        val neutralCells = (0 until world.n).filter { world.ownerId[it] == HolderIds.NEUTRAL }
        require(neutralCells.isNotEmpty()) { "배정 가능한 중립 동이 없습니다(맵이 가득 참)." }

        val usedSgg = HashSet<String>()
        for (i in 0 until world.n) {
            val owner = world.ownerId[i]
            if (owner != HolderIds.NEUTRAL && owner != HolderIds.ENV) usedSgg.add(world.meta[i].sggcd)
        }

        val fresh = neutralCells.filter { world.meta[it].sggcd !in usedSgg }
        val pool = fresh.ifEmpty { neutralCells }
        return pool.random()
    }
}
