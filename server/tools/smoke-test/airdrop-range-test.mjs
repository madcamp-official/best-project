// AIRDROP_MAX_RANGE_DEG 지도별 오버라이드 검증(MapCatalog.applyProfile) — 시군구/세계지도
// 기본값(법정동 0.35도 그대로 썼다면)으로는 실패했을 만큼 먼, 그러나 새 오버라이드 범위
// 안쪽인 목적지로 공수를 보내도 AIRDROP_RANGE 에러 없이 성공해야 한다.
// 사용법: node airdrop-range-test.mjs world|kr-sgg

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const PORT = process.env.TEST_PORT ?? "8080";
const WS_URL = `ws://localhost:${PORT}/ws/websocket`;
const mapId = process.argv[2] ?? "world";
// 옛 기본값(법정동 기준)보다는 훨씬 멀고, 새 오버라이드보다는 안쪽인 목표 거리(도).
const TARGET_DIST = mapId === "world" ? 20 : 1.5;

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  const state = { ownerId: null, myHolderId: -1, meta: null, n: 0, roomId: null };
  const client = new Client({ webSocketFactory: () => new WebSocket(WS_URL), reconnectDelay: 0, debug: () => {} });

  await new Promise((resolve, reject) => {
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        Object.assign(state, { myHolderId: w.holderId, ownerId: w.ownerId, meta: w.meta, n: w.ownerId.length, roomId: w.roomId });
        console.log(`WELCOME: roomId=${w.roomId} mapId=${w.mapId} holderId=${w.holderId} n=${w.ownerId.length}`);
        if (w.mapId !== mapId) { reject(new Error(`요청한 mapId(${mapId})와 다름: ${w.mapId}`)); return; }
        resolve();
      });
      client.subscribe("/user/queue/roomJoined", () => client.publish({ destination: "/app/room/start", body: "{}" }));
      client.subscribe("/user/queue/error", (msg) => reject(new Error(JSON.stringify(JSON.parse(msg.body)))));
      client.publish({ destination: "/app/lobby/create", body: JSON.stringify({ name: "공수사거리테스트", mapId, nickname: "공수테스터" }) });
    };
    client.activate();
  });

  let myCell = -1;
  for (let i = 0; i < state.n; i++) if (state.ownerId[i] === state.myHolderId) { myCell = i; break; }
  if (myCell < 0) fail("시작 동을 못 찾음");
  const origin = state.meta[myCell].centroid;
  console.log(`시작 동: ${state.meta[myCell].name} centroid=[${origin[0].toFixed(2)},${origin[1].toFixed(2)}]`);

  // TARGET_DIST에 가장 가까운 다른(중립) 동을 목적지로 고른다.
  const cosLat = Math.cos((origin[1] * Math.PI) / 180) || 1;
  let dest = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < state.n; i++) {
    if (i === myCell) continue;
    const c = state.meta[i].centroid;
    const dx = (c[0] - origin[0]) * cosLat;
    const dy = c[1] - origin[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    const diff = Math.abs(d - TARGET_DIST);
    if (diff < bestDiff) { bestDiff = diff; dest = i; }
  }
  const c = state.meta[dest].centroid;
  const dx = (c[0] - origin[0]) * cosLat;
  const dy = c[1] - origin[1];
  const actualDist = Math.sqrt(dx * dx + dy * dy);
  console.log(`목적지: ${state.meta[dest].name} (거리 ${actualDist.toFixed(2)}도, 목표 ${TARGET_DIST}도)`);

  let lastError = null;
  let sawOrder = false;
  client.subscribe(`/topic/room/${state.roomId}/world`, (msg) => {
    const d = JSON.parse(msg.body);
    for (const o of d.newOrders) if (o.holderId === state.myHolderId && o.airdrop === true) sawOrder = true;
  });
  const errSub = client.subscribe("/user/queue/error", (msg) => (lastError = JSON.parse(msg.body)));

  client.publish({ destination: "/app/airdrop", body: JSON.stringify({ sources: [myCell], dest }) });

  const deadline = Date.now() + 3000;
  while (!sawOrder && !lastError && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  errSub.unsubscribe();

  if (lastError) fail(`공수 거부됨: ${JSON.stringify(lastError)}`);
  if (!sawOrder) fail("공수 order가 안 옴(타임아웃)");
  console.log(`OK[${mapId}]: ${actualDist.toFixed(2)}도 거리 공수 성공 (사거리 오버라이드 확인됨)`);
  client.deactivate();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
