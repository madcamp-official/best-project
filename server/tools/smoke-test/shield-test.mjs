// 스폰 방어막(SPAWN_SHIELD_SEC) 검증.
// [1] 방금 접속한 피해자 B — WELCOME.shields에 자기 방어막이 활성 상태로 잡혀 있는지 확인.
// [2] 공격 봇 A가 미사일을 확보해 B의 유일한 동을 겨냥해 발사 — 방어막이 살아있는 동안이라
//     중립화되면 안 된다(미사일 자체는 소모돼야 함 — "방어막에 막힘"이지 "무효 명령"이 아니다).
// [3] SPAWN_SHIELD_SEC을 아주 짧게(2초) 바꾼 뒤 새 피해자 C를 접속시키고 2.5초 대기(방어막
//     자연 만료) — 이번엔 A가 남은 미사일로 C를 쏘면 정상적으로 중립화돼야 한다.

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
  console.log("[1] B(피해자) 접속 — 기본 SPAWN_SHIELD_SEC(길게)로 방어막 확인...");
  const b = await connectAndJoin("방패피해자B");
  const Y = b.welcome.ownerId.findIndex((o) => o === b.welcome.holderId);
  const meta = b.welcome.meta;
  const now = Date.now();
  const bShield = b.welcome.shields.find((s) => s.holderId === b.welcome.holderId);
  if (!bShield) fail("WELCOME.shields에 B의 방어막이 없음");
  if (bShield.until <= now) fail(`B의 방어막이 이미 만료됨(until=${bShield.until}, now=${now})`);
  console.log(`  B holderId=${b.welcome.holderId}, Y=${Y}(${meta[Y].name}), 방어막 ${Math.round((bShield.until - now) / 1000)}초 남음`);

  const bState = { ownerId: b.welcome.ownerId.slice() };
  b.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) bState.ownerId[idx] = owner;
  });

  console.log("[2] A(공격 봇) 접속 + 설정 임시 상향으로 미사일 확보(ENV 정지, B 공격 무관)...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, MISSILE_SPAWN_SEC: 0.1, MISSILE_MAX_TOTAL: 300, ENV_ACT_INTERVAL_SEC: 999 }),
  });
  const a = await connectAndJoin("방패공격봇A");
  const aState = { ownerId: a.welcome.ownerId.slice(), neighborIndex: a.welcome.neighborIndex, n: a.welcome.ownerId.length, missiles: new Set() };
  a.client.subscribe("/user/queue/error", () => {}); // BFS 확장 중 실패한 개별 sortie는 무시(자연스러움)
  a.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) aState.ownerId[idx] = owner;
    for (const i of d.missileAdd) aState.missiles.add(i);
    for (const i of d.missileRemove) aState.missiles.delete(i);
  });

  const acquireDeadline = Date.now() + 40000;
  let firstMissile = -1;
  while (Date.now() < acquireDeadline) {
    for (const i of aState.missiles) {
      if (aState.ownerId[i] === a.welcome.holderId) { firstMissile = i; break; }
    }
    if (firstMissile >= 0) break;
    const mine = [];
    for (let i = 0; i < aState.n; i++) if (aState.ownerId[i] === a.welcome.holderId) mine.push(i);
    const frontier = new Set();
    for (const i of mine) for (const nb of aState.neighborIndex[i]) if (aState.ownerId[nb] !== a.welcome.holderId) frontier.add(`${i}>${nb}`);
    for (const edge of frontier) {
      const [from, to] = edge.split(">").map(Number);
      a.client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio: 0.9 }) });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (firstMissile < 0) fail("A가 미사일을 못 구함(40초 초과)");
  console.log(`  A 미사일 확보: admIndex=${firstMissile}`);

  console.log(`[3] A가 방어막 살아있는 B의 유일한 동(Y=${Y})을 겨냥해 발사 — 막혀야 함...`);
  let launchError = null;
  const sub1 = a.client.subscribe("/user/queue/error", (msg) => (launchError = JSON.parse(msg.body)));
  a.client.publish({
    destination: "/app/missile",
    body: JSON.stringify({ center: meta[Y].centroid, radius: 0.01, hits: [Y] }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  sub1.unsubscribe();
  if (launchError) fail(`발사 자체가 거부됨(방어막과 무관한 문제일 수 있음): ${JSON.stringify(launchError)}`);
  if (bState.ownerId[Y] !== b.welcome.holderId) fail(`방어막이 안 막음 — Y의 owner=${bState.ownerId[Y]}(기대: B=${b.welcome.holderId})`);
  console.log("  확인: 방어막이 막아서 Y는 여전히 B 소유");

  console.log("[4] SPAWN_SHIELD_SEC=2로 낮추고 새 피해자 C 접속 후 2.5초 대기(자연 만료)...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ SPAWN_SHIELD_SEC: 2 }),
  });
  const c = await connectAndJoin("방패피해자C");
  const Z = c.welcome.ownerId.findIndex((o) => o === c.welcome.holderId);
  const cState = { ownerId: c.welcome.ownerId.slice() };
  c.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const [idx, owner] of d.cells) cState.ownerId[idx] = owner;
  });
  await new Promise((r) => setTimeout(r, 2500));

  console.log(`[5] A가 방어막 만료된 C의 유일한 동(Z=${Z})을 겨냥해 발사 — 이번엔 중립화돼야 함...`);
  let launchError2 = null;
  const sub2 = a.client.subscribe("/user/queue/error", (msg) => (launchError2 = JSON.parse(msg.body)));
  a.client.publish({
    destination: "/app/missile",
    body: JSON.stringify({ center: meta[Z].centroid, radius: 0.01, hits: [Z] }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  sub2.unsubscribe();

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, MISSILE_SPAWN_SEC: 5, MISSILE_MAX_TOTAL: 60, ENV_ACT_INTERVAL_SEC: 3, SPAWN_SHIELD_SEC: 120 }),
  });

  a.client.deactivate();
  b.client.deactivate();
  c.client.deactivate();

  if (launchError2) fail(`두 번째 발사 거부됨: ${JSON.stringify(launchError2)}`);
  if (cState.ownerId[Z] !== 0) fail(`만료된 방어막인데도 중립화 안 됨 — Z의 owner=${cState.ownerId[Z]}`);
  console.log("  확인: 방어막 만료 후엔 정상적으로 중립화됨");

  console.log("SHIELD TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
