// 다중 방(로비) 라운드 E2E: 연결 → 방 목록 → 방 생성 → 대기실(roomJoined) → 라운드 시작 →
// WELCOME(룸 스코프) + 룸 state(PLAYING) + 룸 world DELTA 수신을 확인한다.
// 사용: PORT=8081 node lobby-smoke.mjs
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const PORT = process.env.PORT || "8080";
const client = new Client({
  webSocketFactory: () => new WebSocket(`ws://localhost:${PORT}/ws/websocket`),
  reconnectDelay: 0,
  debug: () => {},
});

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
const timeout = setTimeout(() => fail("timed out"), 20000);

let roomId = null;
let welcome = null;
let sawPlayingState = false;
let sawRoomDelta = false;
let sawNotFound = false; // 없는 방 입장 → ROOM_NOT_FOUND 에러 수신 확인
let roundEndsOk = false; // WELCOME.roundEndsAtMs가 미래 시각(라운드 타이머)인지 확인

client.onConnect = () => {
  console.log("connected to", PORT);

  client.subscribe("/topic/rooms", (m) => {
    const list = JSON.parse(m.body);
    console.log("ROOM LIST:", list.rooms.map((r) => `${r.name}(${r.state},${r.memberCount}/${r.maxMembers})`));
  });

  client.subscribe("/user/queue/roomJoined", (m) => {
    const rj = JSON.parse(m.body);
    console.log("ROOM JOINED:", rj.roomId, rj.name, rj.state, "members:", rj.members.map((x) => x.nickname));
    if (roomId) return;
    roomId = rj.roomId;
    client.subscribe(`/topic/room/${roomId}/world`, () => {
      if (!sawRoomDelta) console.log("ROOM DELTA received on /topic/room/" + roomId + "/world");
      sawRoomDelta = true;
    });
    client.subscribe(`/topic/room/${roomId}/state`, (mm) => {
      const s = JSON.parse(mm.body);
      if (s.reason) console.log("ROUND END:", s.reason, "winner:", s.winnerName);
      else {
        console.log("ROOM STATE:", s.state, "members:", s.members.map((x) => x.nickname));
        if (s.state === "PLAYING") sawPlayingState = true;
      }
    });
    setTimeout(() => {
      console.log("-> start round");
      client.publish({ destination: "/app/room/start", body: "{}" });
    }, 400);
  });

  client.subscribe("/user/queue/welcome", (m) => {
    welcome = JSON.parse(m.body);
    const myCell = welcome.ownerId.findIndex((o) => o === welcome.holderId);
    console.log(
      "WELCOME: roomId=", welcome.roomId, "holderId=", welcome.holderId, "myCell=", myCell,
      "cells=", welcome.ownerId.length, "roundEndsAtMs=", welcome.roundEndsAtMs,
    );
    if (welcome.roomId !== roomId) fail(`welcome.roomId(${welcome.roomId}) != joined room(${roomId})`);
    if (myCell === -1) fail("no owned cell in WELCOME snapshot");
    // 라운드 타이머: 제한 시각이 미래 epoch ms여야 한다(서버 ROUND_DURATION_SEC 기반).
    roundEndsOk = welcome.roundEndsAtMs > welcome.serverTimeMs;
  });

  client.subscribe("/user/queue/error", (m) => {
    const err = JSON.parse(m.body);
    console.log("ERROR:", err.code, "-", err.message);
    if (err.code === "ROOM_NOT_FOUND") sawNotFound = true;
  });

  client.publish({ destination: "/app/lobby/list", body: "{}" });
  // 없는 방 입장 시도 → ROOM_NOT_FOUND 에러가 와야 한다(무응답이면 클라가 멈춘다).
  setTimeout(() => {
    console.log("-> join bogus room (expect ROOM_NOT_FOUND)");
    client.publish({ destination: "/app/lobby/join", body: JSON.stringify({ roomId: "nope", nickname: "로비봇" }) });
  }, 150);
  setTimeout(() => {
    console.log("-> create room");
    client.publish({ destination: "/app/lobby/create", body: JSON.stringify({ name: "테스트방", nickname: "로비봇" }) });
  }, 400);

  setTimeout(() => {
    clearTimeout(timeout);
    const ok = roomId && welcome && sawPlayingState && sawRoomDelta && sawNotFound && roundEndsOk;
    console.log("--- RESULT ---", {
      roomId: !!roomId, welcome: !!welcome, sawPlayingState, sawRoomDelta, sawNotFound, roundEndsOk,
    });
    console.log(ok ? "LOBBY E2E OK" : "LOBBY E2E INCOMPLETE");
    client.deactivate();
    process.exit(ok ? 0 : 1);
  }, 6000);
};

client.onStompError = (f) => fail("STOMP error: " + f.body);
client.onWebSocketError = (e) => fail("WS error: " + (e.message || e));
client.activate();
