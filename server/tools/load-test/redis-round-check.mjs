// Redis 명예의 전당 검증: 25초 라운드(AI 0명)를 실제로 돌려 TIMEOUT 우승자가 기록되는지 확인
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const HTTP = "http://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 짧은 라운드·AI 없음으로 설정
const cfg = await fetch(`${HTTP}/admin/config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ROUND_DURATION_SEC: 25, AI_FILL_TARGET: 0 }),
}).then((r) => r.json());
console.log("config 적용:", JSON.stringify({ round: cfg.ROUND_DURATION_SEC, ai: cfg.AI_FILL_TARGET }));

const mkClient = () =>
  new Client({ webSocketFactory: () => new WebSocket(WS_URL), reconnectDelay: 0, debug: () => {} });

// 2) 호스트: 방 생성 → roomId 획득
const host = mkClient();
let roundEnd = null;
const hostJoined = new Promise((resolve) => {
  host.onConnect = () => {
    host.subscribe("/user/queue/roomJoined", (m) => resolve(JSON.parse(m.body).roomId));
    host.subscribe("/user/queue/welcome", (m) => {
      const w = JSON.parse(m.body);
      console.log("라운드 시작 — 호스트 holderId:", w.holderId);
    });
    host.publish({
      destination: "/app/lobby/create",
      body: JSON.stringify({ name: "레디스검증방", nickname: "레디스검증승자", clientId: "rv-host" }),
    });
  };
});
host.activate();
const roomId = await hostJoined;
const ended = new Promise((resolve) => {
  host.subscribe(`/topic/room/${roomId}/state`, (m) => {
    const s = JSON.parse(m.body);
    if (s.reason) { roundEnd = s; resolve(); }
  });
});

// 3) 멤버: 입장 → 준비
const member = mkClient();
member.onConnect = () => {
  member.subscribe("/user/queue/roomJoined", () => {
    member.publish({ destination: "/app/room/ready", body: JSON.stringify({ ready: true }) });
  });
  member.publish({
    destination: "/app/lobby/join",
    body: JSON.stringify({ roomId, nickname: "레디스검증2", clientId: "rv-member" }),
  });
};
member.activate();

// 4) 시작 → 라운드 종료 대기(TIMEOUT 25초)
await sleep(1200);
host.publish({ destination: "/app/room/start", body: "{}" });
await Promise.race([ended, sleep(60000)]);
if (!roundEnd) { console.log("FAIL: 60초 내 라운드 종료 없음"); process.exit(1); }
console.log("라운드 종료:", roundEnd.reason, "— 승자:", roundEnd.winnerName, `(holder ${roundEnd.winnerHolderId})`);

// 5) 랭킹 확인
await sleep(1500); // 비동기 기록 여유
const top = await fetch(`${HTTP}/ranking/top`).then((r) => r.json());
console.log("명예의 전당:", JSON.stringify(top));
const found = top.find((r) => r.name === roundEnd.winnerName);
console.log(found ? `OK: "${found.name}" wins=${found.wins} 기록됨` : "FAIL: 우승자가 랭킹에 없음");
host.deactivate(); member.deactivate();
setTimeout(() => process.exit(found ? 0 : 1), 1000);
