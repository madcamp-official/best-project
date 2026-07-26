// 사용자가 실제로 겪은 문제 재현: 갓 접속한 플레이어(동 1개)가 미사일에 직격당해
// 소유 동 0개가 됐을 때, 서버가 자동으로 새 시작 동을 배정해 계속 플레이 가능한지 확인.
//
// 1) B(피해자) 접속 → 시작 동 Y 하나만 보유.
// 2) A(공격자)를 /admin/config로 잠깐 빠르게 확장시켜 미사일을 확보.
// 3) A가 정확히 Y를 겨냥해 발사 → Y 중립화 → B는 소유 동 0개.
// 4) 서버가 다음 tick(들) 안에 B에게 새 동을 자동 배정하는지 확인(로그 메시지 "궤멸" 포함).

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const ADMIN_URL = "http://localhost:8080/admin/config";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function connectAndJoin(nickname) {
  return new Promise((resolve) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(WS_URL),
      reconnectDelay: 0,
      debug: () => {},
    });
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        resolve({ client, welcome: JSON.parse(msg.body) });
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname }) });
    };
    client.activate();
  });
}

async function main() {
  console.log("[1] B(피해자) 접속...");
  const b = await connectAndJoin("피해자B");
  const Y = b.welcome.ownerId.findIndex((o) => o === b.welcome.holderId);
  const meta = b.welcome.meta;
  console.log(`  B holderId=${b.welcome.holderId}, 시작 동 Y=${Y}(${meta[Y].name})`);

  const bState = { ownerId: b.welcome.ownerId.slice() };
  const respawnLogs = [];
  b.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) bState.ownerId[idx] = owner;
    for (const e of d.events) if (e.message.includes("궤멸")) respawnLogs.push(e.message);
  });
  b.client.subscribe("/user/queue/error", () => {});

  console.log("[2] A(공격자) 접속 + 설정 임시 상향(FILL_TO_CAP_SEC=1)로 미사일 확보...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, MISSILE_SPAWN_SEC: 1, MISSILE_MAX_PER_PLAYER: 999 }),
  });
  const a = await connectAndJoin("공격자A");
  const aState = { ownerId: a.welcome.ownerId.slice(), neighborIndex: a.welcome.neighborIndex, n: a.welcome.ownerId.length, missiles: new Set() };
  a.client.subscribe("/user/queue/error", () => {});
  a.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) aState.ownerId[idx] = owner;
    for (const i of d.missileAdd) aState.missiles.add(i);
    for (const i of d.missileRemove) aState.missiles.delete(i);
  });

  let myMissileCell = -1;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const i of aState.missiles) {
      if (aState.ownerId[i] === a.welcome.holderId) {
        myMissileCell = i;
        break;
      }
    }
    if (myMissileCell >= 0) break;
    const mine = [];
    for (let i = 0; i < aState.n; i++) if (aState.ownerId[i] === a.welcome.holderId) mine.push(i);
    const frontier = new Set();
    for (const i of mine) {
      for (const nb of aState.neighborIndex[i]) if (aState.ownerId[nb] !== a.welcome.holderId) frontier.add(`${i}>${nb}`);
    }
    for (const edge of frontier) {
      const [from, to] = edge.split(">").map(Number);
      a.client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio: 0.9 }) });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (myMissileCell < 0) fail("A가 미사일을 못 구함");
  console.log(`  A 미사일 확보: admIndex=${myMissileCell}`);

  console.log(`[3] A가 B의 유일한 동(Y=${Y})을 정확히 겨냥해 발사...`);
  a.client.publish({
    destination: "/app/missile",
    body: JSON.stringify({ center: meta[Y].centroid, radius: 0.01, hits: [Y] }),
  });
  await new Promise((r) => setTimeout(r, 1500));

  if (bState.ownerId[Y] !== 0) fail(`Y가 중립화 안 됨(owner=${bState.ownerId[Y]})`);
  console.log(`  확인: Y(${Y}) 중립화됨 — B는 이제 소유 동 0개`);

  console.log("[4] 자동 재시작 대기(최대 5초, 다음 tick 안에 일어나야 함)...");
  const wait2 = Date.now() + 5000;
  while (Date.now() < wait2 && respawnLogs.length === 0) {
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, MISSILE_SPAWN_SEC: 10, MISSILE_MAX_PER_PLAYER: 5 }),
  });

  const bOwnsAny = bState.ownerId.some((o) => o === b.welcome.holderId);
  a.client.deactivate();
  b.client.deactivate();

  if (respawnLogs.length === 0) fail("궤멸 재시작 로그가 안 옴 — respawnEliminatedPlayers가 안 도는 듯");
  if (!bOwnsAny) fail("재시작 로그는 왔는데 실제로 B가 소유한 동이 없음");

  console.log("  [LOG]", respawnLogs[0]);
  console.log(`  확인: B가 다시 동을 소유하고 있음`);
  console.log("RESPAWN TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
