// 방장/준비 시스템 E2E (2클라이언트):
//  A가 방 생성(방장) → B 참가 → B가 시작 시도(NOT_HOST 기대) → A가 시작 시도(NOT_READY 기대)
//  → B 준비 → A 시작 → 둘 다 WELCOME 수신 + state PLAYING. 방장 승계는 별도 수동 확인.
// 사용: PORT=8081 node host-ready-smoke.mjs
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const PORT = process.env.PORT || "8080";

function makeClient() {
  return new Client({
    webSocketFactory: () => new WebSocket(`ws://localhost:${PORT}/ws/websocket`),
    reconnectDelay: 0,
    debug: () => {},
  });
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
const timeout = setTimeout(() => fail("timed out"), 25000);

const flags = {
  aIsHost: false, // A의 roomJoined.youAreHost === true
  bIsNotHost: false, // B의 roomJoined.youAreHost === false
  bStartRejected: false, // B의 시작 시도 → NOT_HOST
  aStartNotReady: false, // 준비 전 A의 시작 시도 → NOT_READY
  readySeen: false, // B 준비 후 state 멤버에 ready=true 반영
  aWelcome: false,
  bWelcome: false,
};
let roomId = null;

const a = makeClient();
const b = makeClient();

function subCommon(client, tag, onJoined, onError) {
  client.subscribe("/user/queue/roomJoined", (m) => onJoined(JSON.parse(m.body)));
  client.subscribe("/user/queue/error", (m) => {
    const err = JSON.parse(m.body);
    console.log(`${tag} ERROR:`, err.code);
    onError(err);
  });
  client.subscribe("/user/queue/welcome", (m) => {
    const w = JSON.parse(m.body);
    console.log(`${tag} WELCOME roomId=${w.roomId} holderId=${w.holderId}`);
    if (tag === "A") flags.aWelcome = true;
    else flags.bWelcome = true;
    maybeFinish();
  });
}

function maybeFinish() {
  if (!(flags.aWelcome && flags.bWelcome)) return;
  clearTimeout(timeout);
  setTimeout(() => {
    const ok = Object.values(flags).every(Boolean);
    console.log("--- RESULT ---", flags);
    console.log(ok ? "HOST/READY E2E OK" : "HOST/READY E2E INCOMPLETE");
    a.deactivate();
    b.deactivate();
    process.exit(ok ? 0 : 1);
  }, 500);
}

a.onConnect = () => {
  subCommon(a, "A", (rj) => {
    if (roomId) return;
    roomId = rj.roomId;
    flags.aIsHost = rj.youAreHost === true;
    console.log("A created room", roomId, "youAreHost=", rj.youAreHost);
    a.subscribe(`/topic/room/${roomId}/state`, (m) => {
      const s = JSON.parse(m.body);
      if (s.members && s.members.some((mm) => !mm.host && mm.ready)) flags.readySeen = true;
    });
    b.activate(); // 방이 생겼으니 B 시작
  }, (err) => {
    if (err.code === "NOT_READY") {
      flags.aStartNotReady = true;
      console.log("-> B ready");
      b.publish({ destination: "/app/room/ready", body: JSON.stringify({ ready: true }) });
      setTimeout(() => {
        console.log("-> A start (after ready, expect success)");
        a.publish({ destination: "/app/room/start", body: "{}" });
      }, 400);
    }
  });
  console.log("-> A create room");
  a.publish({ destination: "/app/lobby/create", body: JSON.stringify({ name: "권한테스트", nickname: "방장A" }) });
};

b.onConnect = () => {
  subCommon(b, "B", (rj) => {
    flags.bIsNotHost = rj.youAreHost === false;
    console.log("B joined, youAreHost=", rj.youAreHost);
    console.log("-> B start (expect NOT_HOST)");
    b.publish({ destination: "/app/room/start", body: "{}" });
  }, (err) => {
    if (err.code === "NOT_HOST") {
      flags.bStartRejected = true;
      console.log("-> A start before ready (expect NOT_READY)");
      a.publish({ destination: "/app/room/start", body: "{}" });
    }
  });
  b.publish({ destination: "/app/lobby/join", body: JSON.stringify({ roomId, nickname: "손님B" }) });
};

a.onStompError = (f) => fail("A STOMP error: " + f.body);
b.onStompError = (f) => fail("B STOMP error: " + f.body);
a.onWebSocketError = (e) => fail("A WS error: " + (e.message || e));
b.onWebSocketError = (e) => fail("B WS error: " + (e.message || e));

a.activate();
