package com.madcamp.server.persistence

import com.madcamp.server.config.GameConfig
import com.madcamp.server.data.BoundaryDataLoader
import com.madcamp.server.domain.Holder
import com.madcamp.server.domain.Order
import com.madcamp.server.domain.World
import tools.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path

/**
 * plan.md Day 5 "서버 재시작 시 월드 스냅샷 저장/복구(파일이면 충분)".
 * 경계 데이터(nationwide-dong.json)가 바뀌면 admIndex 매핑이 달라질 수 있으므로,
 * 셀 수가 다르면 스냅샷을 버리고 새 월드로 시작한다(§6 참고: 데이터 변경은 흔치 않음).
 */
data class WorldSnapshot(
    val ownerId: IntArray,
    val troops: IntArray,
    val troopCap: IntArray,
    val holders: List<Holder>,
    val orders: List<Order>,
    val nextHolderId: Int,
    val nextLogId: Int,
    val envLastActMs: Long,
)

@Component
class SnapshotService(private val objectMapper: ObjectMapper) {
    private val log = LoggerFactory.getLogger(SnapshotService::class.java)
    private val path: Path = Path.of("data", "world-snapshot.json")

    fun save(world: World) {
        try {
            Files.createDirectories(path.parent)
            val snapshot = WorldSnapshot(
                ownerId = world.ownerId,
                troops = world.troops,
                troopCap = world.troopCap,
                holders = world.holders.values.toList(),
                orders = world.orders.toList(),
                nextHolderId = world.nextHolderId,
                nextLogId = world.nextLogId,
                envLastActMs = world.envLastActMs,
            )
            objectMapper.writeValue(path.toFile(), snapshot)
        } catch (e: Exception) {
            log.warn("월드 스냅샷 저장 실패", e)
        }
    }

    fun tryRestore(boundaryDataLoader: BoundaryDataLoader): World? {
        if (Files.notExists(path)) return null
        return try {
            val snapshot = objectMapper.readValue(path.toFile(), WorldSnapshot::class.java)
            val cells = boundaryDataLoader.load()
            if (snapshot.ownerId.size != cells.size) {
                log.warn("스냅샷 셀 수({})가 현재 경계 데이터({})와 달라 폐기합니다", snapshot.ownerId.size, cells.size)
                return null
            }

            val world = World.create(cells, GameConfig())
            snapshot.ownerId.copyInto(world.ownerId)
            snapshot.troops.copyInto(world.troops)
            snapshot.troopCap.copyInto(world.troopCap)
            world.holders.clear()
            snapshot.holders.forEach { world.holders[it.id] = it }
            world.orders.addAll(snapshot.orders)
            world.nextHolderId = snapshot.nextHolderId
            world.nextLogId = snapshot.nextLogId
            world.envLastActMs = snapshot.envLastActMs
            log.info("월드 스냅샷 복구 완료 ({}개 동)", world.n)
            world
        } catch (e: Exception) {
            log.warn("월드 스냅샷 복구 실패 — 새 월드로 시작합니다", e)
            null
        }
    }
}
