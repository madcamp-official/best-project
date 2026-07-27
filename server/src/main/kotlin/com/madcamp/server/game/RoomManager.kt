package com.madcamp.server.game

import com.madcamp.server.data.MapCatalog
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * 방 레지스트리. 맵 구조 조작(create/get/remove/list)만 동시성 안전하게 담당하고,
 * 각 Room의 내부 상태(world/state/members)는 GameLoop 단일 스레드에서만 mutate된다.
 */
@Component
class RoomManager {
    private val rooms = ConcurrentHashMap<String, Room>()
    private val seq = AtomicInteger(0)

    /** 새 방 생성(자동 id 부여). mapId는 알 수 없는 값이면 기본 지도로 대체(MapCatalog.normalize). */
    fun create(name: String, mapId: String = MapCatalog.DEFAULT): Room {
        val id = "r${seq.incrementAndGet()}"
        return Room(id, name, MapCatalog.normalize(mapId)).also { rooms[id] = it }
    }

    /** 지정 id로 방 생성(기본 브리지 방 등 well-known id용). */
    fun createWithId(id: String, name: String): Room = Room(id, name).also { rooms[id] = it }

    fun get(id: String): Room? = rooms[id]
    fun remove(id: String) { rooms.remove(id) }
    fun list(): List<Room> = rooms.values.toList()
    fun playingRooms(): List<Room> = rooms.values.filter { it.state == RoomState.PLAYING }
    fun playingCount(): Int = rooms.values.count { it.state == RoomState.PLAYING }

    companion object {
        const val DEFAULT_ROOM_ID = "default" // 과도기 브리지(레거시 단일 월드) 방의 well-known id
        const val MAX_ROOMS = 32 // 동시 존재 방 수 상한
        const val MAX_PLAYING_ROOMS = 8 // 동시에 tick하는 방 수 상한(전국 맵 × N방 tick 비용 보호)
        const val MAX_MEMBERS_PER_ROOM = 8 // 방당 인원(색 슬롯 5 순환, holderId 공간 254)
    }
}
