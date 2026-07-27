// 사용자가 실제로 겪은 문제 재현: 갓 접속한 플레이어(동 1개)가 미사일에 직격당해
// 소유 동 0개가 됐을 때 GAME OVER 흐름이 맞게 도는지 확인.
//
// 1) B(피해자) 접속 → 시작 동 Y 하나만 보유.
// 2) A(공격자)를 /admin/config로 잠깐 빠르게 확장시켜 미사일을 확보.
// 3) A가 정확히 Y를 겨냥해 발사 → Y 중립화 → B는 소유 동 0개.
// 4) 자동으로는 재시작되지 않아야 한다(예전엔 자동이었지만, GAME OVER 오버레이가 뜰 틈이
//    없어져서 유저 명시 요청(/app/restart)으로 바꿨다) — 몇 초 기다려도 그대로 0개인지 확인.
// 5) B가 /app/restart를 보내면 그때 새 동을 받는지 확인(로그 메시지 "재시작해" 포함).

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
  // 스폰 방어막(SPAWN_SHIELD_SEC, 기본 120초)이 있으면 갓 접속한 B가 이 테스트 내내
  // 보호받아 미사일이 안 먹는다 — 방어막 자체는 shield-test.mjs가 따로 검증하니,
  // 이 테스트(재시작 흐름)에서는 최소화해 무관하게 만든다.
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ SPAWN_SHIELD_SEC: 0.1 }),
  });

  console.log("[1] B(피해자) 접속...");
  const b = await connectAndJoin("피해자B");
  const Y = b.welcome.ownerId.findIndex((o) => o === b.welcome.holderId);
  const meta = b.welcome.meta;
  console.log(`  B holderId=${b.welcome.holderId}, 시작 동 Y=${Y}(${meta[Y].name})`);

  const bState = { ownerId: b.welcome.ownerId.slice() };
  const restartLogs = [];
  b.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) bState.ownerId[idx] = owner;
    for (const e of d.events) if (e.message.includes("재시작해")) restartLogs.push(e.message);
  });
  b.client.subscribe("/user/queue/error", () => {});

  console.log("[2] A(공격자) 접속 + 설정 임시 상향(FILL_TO_CAP_SEC=1)로 미사일 확보...");
  // ENV_ACT_INTERVAL_SEC를 잠깐 멈춰(사실상 무한대) 야만인 세력 확장/반격이 공격 봇의
  // BFS 확장을 방해하지 않게 한다 — 이 테스트는 E와 무관하고, 오직 A가 빨리 커지는 게 목적.
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, MISSILE_SPAWN_SEC: 0.1, MISSILE_MAX_TOTAL: 300, ENV_ACT_INTERVAL_SEC: 999 }),
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
  const deadline = Date.now() + 30000;
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

  console.log("[4] 자동으로는 재시작되지 않아야 함(3초 대기)...");
  await new Promise((r) => setTimeout(r, 3000));
  if (restartLogs.length > 0) fail("아직 재시작 요청 안 보냈는데 이미 재시작됨 — 자동 재배정이 남아있는 듯");
  if (bState.ownerId.some((o) => o === b.welcome.holderId)) fail("재시작 요청 전인데 B가 이미 동을 소유함");
  console.log("  확인: 자동 재시작 없음 — 소유 동 0개 유지됨(GAME OVER 상태)");

  console.log("[5] B가 재시작 요청(/app/restart) 전송...");
  b.client.publish({ destination: "/app/restart", body: "{}" });
  const wait2 = Date.now() + 3000;
  while (Date.now() < wait2 && restartLogs.length === 0) {
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, MISSILE_SPAWN_SEC: 5, MISSILE_MAX_TOTAL: 60, ENV_ACT_INTERVAL_SEC: 3, SPAWN_SHIELD_SEC: 120 }),
  });

  const bOwnsAny = bState.ownerId.some((o) => o === b.welcome.holderId);
  a.client.deactivate();
  b.client.deactivate();

  if (restartLogs.length === 0) fail("재시작 요청을 보냈는데 재시작 로그가 안 옴 — RestartController/respawnPlayer 확인 필요");
  if (!bOwnsAny) fail("재시작 로그는 왔는데 실제로 B가 소유한 동이 없음");

  console.log("  [LOG]", restartLogs[0]);
  console.log(`  확인: 재시작 요청 후 B가 다시 동을 소유하고 있음`);
  console.log("RESPAWN TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
