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

    /**
     * 새 방 생성(자동 id 부여). mapId는 알 수 없는 값이면 기본 지도로 대체(MapCatalog.normalize).
     * private=true면 초대 코드를 발급하고(친구 초대용) 로비 공개 목록에서 빠진다
     * (RoomBroadcaster.roomListMessage) — 코드를 아는 사람만 /lobby/joinByCode로 입장 가능.
     */
    fun create(name: String, mapId: String = MapCatalog.DEFAULT, private_: Boolean = false): Room {
        val id = "r${seq.incrementAndGet()}"
        return Room(id, name, MapCatalog.normalize(mapId)).also {
            it.private = private_
            if (private_) it.joinCode = generateJoinCode()
            rooms[id] = it
        }
    }

    /** 지정 id로 방 생성(기본 브리지 방 등 well-known id용). */
    fun createWithId(id: String, name: String): Room = Room(id, name).also { rooms[id] = it }

    fun get(id: String): Room? = rooms[id]
    fun remove(id: String) { rooms.remove(id) }
    fun list(): List<Room> = rooms.values.toList()
    fun playingRooms(): List<Room> = rooms.values.filter { it.state == RoomState.PLAYING }
    fun playingCount(): Int = rooms.values.count { it.state == RoomState.PLAYING }

    /** 초대 코드로 방 찾기(대소문자 무시) — 비공개 방 입장(/lobby/joinByCode)용. */
    fun findByJoinCode(code: String): Room? {
        val normalized = code.trim().uppercase()
        if (normalized.isEmpty()) return null
        return rooms.values.find { it.joinCode == normalized }
    }

    // 헷갈리는 문자(0/O, 1/I) 뺀 6자리 코드. 충돌은 사실상 무시할 만큼 희박(32^6 조합) — 겹치면
    // 그냥 재추첨 없이 둔다(같은 코드가 동시에 두 방에 발급될 확률은 이 규모에서 무의미).
    private fun generateJoinCode(): String {
        val alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
        return (1..6).map { alphabet.random() }.joinToString("")
    }

    companion object {
        const val DEFAULT_ROOM_ID = "default" // 과도기 브리지(레거시 단일 월드) 방의 well-known id
        const val MAX_ROOMS = 32 // 동시 존재 방 수 상한
        const val MAX_PLAYING_ROOMS = 8 // 동시에 tick하는 방 수 상한(전국 맵 × N방 tick 비용 보호)
        const val MAX_MEMBERS_PER_ROOM = 8 // 방당 인원(색 슬롯 5 순환, holderId 공간 254)
    }
}
