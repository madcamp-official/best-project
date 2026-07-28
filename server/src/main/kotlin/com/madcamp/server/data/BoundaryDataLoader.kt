package com.madcamp.server.data

import com.madcamp.server.config.GameConfig
import tools.jackson.databind.ObjectMapper
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component

/**
 * server/tools/data-gen/generate.mjs 산출물(resources/data/nationwide-dong.json)을 읽는다.
 * 스크립트는 web/src/data/loadSeoulDong.ts와 같은 방식(admdongkor + topojson 위상)으로
 * 전국 데이터를 뽑아낸 결과다 — plan.md Day 1 "S: 전국 경계 데이터 서버 로드".
 */
data class BoundaryCell(
    val admIndex: Int,
    val code: String,
    val name: String,
    val sggcd: String,
    val sggnm: String,
    val sidocd: String,
    val sidonm: String,
    val centroid: DoubleArray,
    val neighbors: List<Int>,
    val border: Boolean, // 지도 바깥(바다·국경)에 닿는 동인지 — 포위 귀속 판정용(GameCore.tickAnnex)
    // 셀의 대략적인 반지름(경위도 도 단위, bounding box 대각선의 절반) — data-gen/lib/buildCells.mjs
    // computeRadiusDeg 산출. 미사일/전술핵 명중 판정(withinRadius)이 클릭 지점↔centroid 거리만
    // 보면 러시아·시군구처럼 큰 셀 가장자리를 맞춰도 centroid가 멀어 거부되는 문제가 있어 보정에 쓴다.
    val radiusDeg: Double,
)

private data class BoundaryFile(
    val n: Int,
    val generatedAt: String,
    val sourceVersion: String,
    val cells: List<BoundaryCell>,
)

/**
 * 선택 가능한 지도 목록. id는 Room.mapId/CreateRoomCommand.mapId/WelcomeMessage.mapId로
 * 그대로 오간다. resourcePath는 각 data-gen 스크립트(server/tools/data-gen/generate*.mjs) 산출물.
 */
object MapCatalog {
    const val DEFAULT: String = "kr-sgg"

    // 시/군/구 단일 지도 — (구) 전국 법정동(kr-dong, data/nationwide-dong.json)은 비활성화.
    // 산출물 파일은 남아 있으므로 재활성화 시 여기 항목만 되살리면 된다. 목록에 없는 mapId는
    // normalize가 기본 지도로 대체하므로 구버전 클라가 kr-dong을 보내도 kr-sgg 방이 된다.
    private val RESOURCE_PATHS: Map<String, String> = mapOf(
        "kr-sgg" to "data/kr-sgg-cells.json", // 시/군/구(~250개)
    )

    val DISPLAY_NAMES: Map<String, String> = mapOf(
        "kr-sgg" to "시/군/구",
    )

    fun resourcePathOf(mapId: String): String = RESOURCE_PATHS[mapId] ?: RESOURCE_PATHS.getValue(DEFAULT)

    /** 알 수 없는 mapId는 기본 지도로 대체(오래된 클라·오타 방어). */
    fun normalize(mapId: String?): String = mapId?.takeIf { RESOURCE_PATHS.containsKey(it) } ?: DEFAULT

    /**
     * 지도별 거리 기반 물리 상수 오버라이드. 미사일/공수 범위는 실제 지리 거리(centroid 도 단위)에
     * 하한 클램프 없이 그대로 비교되므로(GameCore.tryAirdrop/MissileController.withinRadius),
     * 한국 동 지도 기준으로 튜닝된 기본값을 시군구(동보다 훨씬 큰 셀)에 그대로 쓰면 미사일이
     * 사실상 안 보이고 공수는 항상 사거리 밖이 된다. 유닛 이동 속도(UNIT_SPEED_DEG_PER_SEC)는
     * 건드리지 않는다 — 이동 시간이 UNIT_TRAVEL_MAX_SEC로 이미 클램프돼 거리가 커도 자연히
     * 상한에서 멈춘다. world는 이 브랜치에 아직 없는 지도지만, feat/world-expansion과 병합을
     * 쉽게 하려고 오버라이드 키 자체는 그대로 둔다(RESOURCE_PATHS에 없어 실제로는 호출되지 않음).
     *
     * 아래 값은 셀 실측 거리(이웃 centroid 간 중간값 등)를 참고한 1차 추정치 — 플레이테스트로
     * 조정 예정. missileHitMarginDeg는 World.radiusDeg(셀별 크기 보정)가 따로 있어 지도별로
     * 크게 늘릴 필요는 없다(withinRadius 참조).
     */
    private val MISSILE_RADIUS_DEG_OVERRIDES: Map<String, Double> = mapOf("kr-sgg" to 0.25, "world" to 3.0)
    private val MISSILE_MAX_RADIUS_DEG_OVERRIDES: Map<String, Double> = mapOf("kr-sgg" to 0.4, "world" to 6.0)
    private val MISSILE_HIT_MARGIN_DEG_OVERRIDES: Map<String, Double> = mapOf("world" to 1.5)
    private val AIRDROP_MAX_RANGE_DEG_OVERRIDES: Map<String, Double> = mapOf("kr-sgg" to 3.0, "world" to 60.0)

    /** 방의 mapId에 맞춰 거리 기반 필드만 덮어쓴 GameConfig 사본을 만든다. 나머지(생산·전투 비율
     * 등 지도 무관 튜닝값)는 admin 설정 그대로 유지한다. */
    fun applyProfile(base: GameConfig, mapId: String): GameConfig = base.copy(
        missileRadiusDeg = MISSILE_RADIUS_DEG_OVERRIDES[mapId] ?: base.missileRadiusDeg,
        missileMaxRadiusDeg = MISSILE_MAX_RADIUS_DEG_OVERRIDES[mapId] ?: base.missileMaxRadiusDeg,
        missileHitMarginDeg = MISSILE_HIT_MARGIN_DEG_OVERRIDES[mapId] ?: base.missileHitMarginDeg,
        airdropMaxRangeDeg = AIRDROP_MAX_RANGE_DEG_OVERRIDES[mapId] ?: base.airdropMaxRangeDeg,
    )
}

@Component
class BoundaryDataLoader(private val objectMapper: ObjectMapper) {
    fun load(mapId: String): List<BoundaryCell> {
        val resource = ClassPathResource(MapCatalog.resourcePathOf(mapId))
        resource.inputStream.use { stream ->
            val file = objectMapper.readValue(stream, BoundaryFile::class.java)
            check(file.cells.size == file.n) { "cells.size(${file.cells.size}) != n(${file.n})" }
            return file.cells
        }
    }
}
