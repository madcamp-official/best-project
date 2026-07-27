package com.madcamp.server.data

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
    const val DEFAULT: String = "kr-dong"

    private val RESOURCE_PATHS: Map<String, String> = mapOf(
        "kr-dong" to "data/nationwide-dong.json", // 전국 법정동(~5,065개)
        "kr-sgg" to "data/kr-sgg-cells.json", // 시/군/구(~250개, "한국지리" 모드)
    )

    val DISPLAY_NAMES: Map<String, String> = mapOf(
        "kr-dong" to "전국 법정동",
        "kr-sgg" to "시/군/구",
    )

    fun resourcePathOf(mapId: String): String = RESOURCE_PATHS[mapId] ?: RESOURCE_PATHS.getValue(DEFAULT)

    /** 알 수 없는 mapId는 기본 지도로 대체(오래된 클라·오타 방어). */
    fun normalize(mapId: String?): String = mapId?.takeIf { RESOURCE_PATHS.containsKey(it) } ?: DEFAULT
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
