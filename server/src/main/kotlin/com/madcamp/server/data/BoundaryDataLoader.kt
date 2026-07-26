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
)

private data class BoundaryFile(
    val n: Int,
    val generatedAt: String,
    val sourceVersion: String,
    val cells: List<BoundaryCell>,
)

@Component
class BoundaryDataLoader(private val objectMapper: ObjectMapper) {
    fun load(): List<BoundaryCell> {
        val resource = ClassPathResource("data/nationwide-dong.json")
        resource.inputStream.use { stream ->
            val file = objectMapper.readValue(stream, BoundaryFile::class.java)
            check(file.cells.size == file.n) { "cells.size(${file.cells.size}) != n(${file.n})" }
            return file.cells
        }
    }
}
