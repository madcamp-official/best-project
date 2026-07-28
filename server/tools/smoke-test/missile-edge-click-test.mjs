// World.radiusDeg 보정 검증: 큰 셀(세계지도 국가/주, 시군구)의 centroid에서 멀리 떨어진 —
// 그러나 그 셀 bounding box 안쪽인 — 지점을 미사일 중심으로 보내도(폴리곤 위 클릭을 흉내)
// 서버가 거부하지 않아야 한다(수정 전에는 centroid 근접만 보다가 거부했다).
// 사용법: node missile-edge-click-test.mjs world|kr-sgg

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";
import { readFileSync } from "node:fs";

const PORT = process.env.TEST_PORT ?? "8080";
const WS_URL = `ws://localhost:${PORT}/ws/websocket`;
const ADMIN_URL = `http://localhost:${PORT}/admin/config`;
const mapId = process.argv[2] ?? "world";
const cellsFile = mapId === "world" ? "world-cells.json" : "kr-sgg-cells.json";
const cellsPath = new URL(`../../src/main/resources/data/${cellsFile}`, import.meta.url);
const cellsData = JSON.parse(readFileSync(cellsPath, "utf8"));

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log(`[${mapId}] 설정 임시 상향(생산·미사일스폰 가속, 방어막/야만인 정지)...`);
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, MISSILE_SPAWN_SEC: 0.1, MISSILE_MAX_TOTAL: 300, ENV_ACT_INTERVAL_SEC: 999, SPAWN_SHIELD_SEC: 0.1 }),
  });

  const state = { ownerId: null, myHolderId: -1, meta: null, neighborIndex: null, n: 0, roomId: null, missiles: new Set() };
  const client = new Client({ webSocketFactory: () => new WebSocket(WS_URL), reconnectDelay: 0, debug: () => {} });

  await new Promise((resolve, reject) => {
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        Object.assign(state, { myHolderId: w.holderId, ownerId: w.ownerId, meta: w.meta, neighborIndex: w.neighborIndex, n: w.ownerId.length, roomId: w.roomId });
        for (const i of w.missiles) state.missiles.add(i);
        console.log(`WELCOME: roomId=${w.roomId} mapId=${w.mapId} holderId=${w.holderId} n=${w.ownerId.length}`);
        if (w.mapId !== mapId) { reject(new Error(`요청한 mapId(${mapId})와 WELCOME.mapId(${w.mapId})가 다름`)); return; }
        resolve();
      });
      client.subscribe("/user/queue/roomJoined", () => client.publish({ destination: "/app/room/start", body: "{}" }));
      client.subscribe("/user/queue/error", (msg) => reject(new Error(JSON.stringify(JSON.parse(msg.body)))));
      client.publish({ destination: "/app/lobby/create", body: JSON.stringify({ name: "엣지클릭테스트", mapId, nickname: "엣지테스터" }) });
    };
    client.activate();
  });

  let impactDelta = null;
  client.subscribe(`/topic/room/${state.roomId}/world`, (msg) => {
    const d = JSON.parse(msg.body);
    for (const i of d.missileAdd) state.missiles.add(i);
    for (const i of d.missileRemove) state.missiles.delete(i);
    for (const [idx, owner] of d.cells) state.ownerId[idx] = owner;
    if (!impactDelta && d.events.some((e) => e.message.includes("착탄"))) impactDelta = d;
  });
  client.subscribe("/user/queue/error", () => {}); // 확장 중 개별 sortie 실패는 무시

  console.log("BFS 확장 시작 (최대 25초, 내 동에 미사일이 뜰 때까지)...");
  const deadline = Date.now() + 25000;
  let myMissileCell = -1;
  while (Date.now() < deadline) {
    const mine = [];
    for (let i = 0; i < state.n; i++) if (state.ownerId[i] === state.myHolderId) mine.push(i);
    for (const i of mine) if (state.missiles.has(i)) { myMissileCell = i; break; }
    if (myMissileCell >= 0) break;

    const frontier = new Set();
    for (const i of mine) for (const nb of state.neighborIndex[i]) if (state.ownerId[nb] !== state.myHolderId) frontier.add(`${i}>${nb}`);
    for (const edge of frontier) {
      const [from, to] = edge.split(">").map(Number);
      client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio: 0.9 }) });
    }
    console.log(`  보유 동 ${mine.length}개, 프런티어 공격 ${frontier.size}건`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (myMissileCell < 0) fail("25초 안에 내 동에 미사일이 안 뜸 — 재시도 필요");

  const code = state.meta[myMissileCell].code;
  const cellMeta = cellsData.cells.find((c) => c.code === code);
  if (!cellMeta) fail(`data-gen 산출물에서 code=${code} 못 찾음`);
  const [clng, clat] = cellMeta.centroid;
  const r = cellMeta.radiusDeg;
  console.log(`미사일 보유 동: ${state.meta[myMissileCell].name} (${code}), radiusDeg=${r.toFixed(3)}`);

  // centroid에서 그 셀 반지름의 70%만큼 떨어진 지점 = "폴리곤 위이지만 centroid는 아닌" 클릭을
  // 흉내낸다 — 수정 전 코드라면 이미 명중 판정에서 거부됐을 거리다.
  const offset = r * 0.7;
  const clickCenter = [clng + offset, clat + offset];
  const dist = Math.sqrt(2) * offset;
  console.log(`클릭 지점(centroid에서 ${dist.toFixed(3)}도 떨어짐)로 발사`);

  let launchError = null;
  const errSub = client.subscribe("/user/queue/error", (msg) => (launchError = JSON.parse(msg.body)));
  impactDelta = null;
  client.publish({ destination: "/app/missile", body: JSON.stringify({ center: clickCenter, radius: 999, hits: [myMissileCell] }) });

  const waitDeadline = Date.now() + 3000;
  while (!impactDelta && !launchError && Date.now() < waitDeadline) await new Promise((r) => setTimeout(r, 100));
  errSub.unsubscribe();

  if (launchError) fail(`발사 거부됨: ${JSON.stringify(launchError)}`);
  if (!impactDelta) fail("착탄 이벤트가 안 옴(타임아웃) — hits가 서버 검증을 통과 못 했을 가능성");
  const hitCell = impactDelta.cells.find(([idx]) => idx === myMissileCell);
  if (!hitCell || hitCell[1] !== 0) fail(`착탄은 왔는데 목표 동이 중립화 안 됨: ${JSON.stringify(impactDelta.cells)}`);

  console.log(`OK[${mapId}]: centroid에서 ${dist.toFixed(3)}도 떨어진 클릭도 명중 판정 통과 (radiusDeg 보정 확인됨)`);

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, MISSILE_SPAWN_SEC: 5, MISSILE_MAX_TOTAL: 60, ENV_ACT_INTERVAL_SEC: 3, SPAWN_SHIELD_SEC: 120 }),
  });
  client.deactivate();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
