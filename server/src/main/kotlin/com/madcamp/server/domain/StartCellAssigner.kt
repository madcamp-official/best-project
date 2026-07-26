package com.madcamp.server.domain

import com.madcamp.server.config.HolderIds

/**
 * 시작 동(또는 재시작 동) 배정. 신규 참가자(SessionService)와 궤멸 후 재시작
 * (GameCore.respawnEliminatedPlayers) 둘 다 이걸 쓴다 — "빈손이 된 플레이어에게
 * 새 땅을 준다"는 같은 문제이기 때문(plan.md Day 3 "기존 영토와 겹치지 않는 중립 동, 전국에 분산").
 * `internal`로 둬서 domain 밖(session 패키지)에서도 쓸 수 있게 한다.
 */
internal object StartCellAssigner {
    /**
     * 이미 플레이어가 있는 시군구를 우선 피해 무작위로 골라 수도권 등 특정 지역 쏠림을 줄인다.
     * 정교한 인구/지역 가중치 배정은 아님 — 데모 스코프의 단순 휴리스틱.
     * 배정 가능한 중립 동이 전혀 없으면(맵이 가득 참) null.
     */
    fun pick(world: World): Int? {
        val neutralCells = (0 until world.n).filter { world.ownerId[it] == HolderIds.NEUTRAL }
        if (neutralCells.isEmpty()) return null

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
