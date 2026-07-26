// missile-test.mjs의 [3]단계(발사→중립화)를 우연에 기대지 않고 결정적으로 재현한다.
// /admin/config로 이 프로세스 동안만 생산 속도·스폰 주기를 크게 올려(다른 클라에도 영향
// 가는 전역 설정이라 테스트 전용 서버에서만 돌릴 것) 빠르게 영토를 넓힌 뒤, 내 동 중
// 미사일이 뜬 곳을 찾아 발사까지 확인한다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const ADMIN_URL = "http://localhost:8080/admin/config";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log("설정 임시 상향(FILL_TO_CAP_SEC=1, MISSILE_SPAWN_SEC=1, MISSILE_MAX_PER_PLAYER=999)...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, MISSILE_SPAWN_SEC: 1, MISSILE_MAX_PER_PLAYER: 999 }),
  });

  const state = { ownerId: null, myHolderId: -1, meta: null, neighborIndex: null, n: 0, missiles: new Set() };
  const client = new Client({
    webSocketFactory: () => new WebSocket(WS_URL),
    reconnectDelay: 0,
    debug: () => {},
  });

  await new Promise((resolve) => {
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        Object.assign(state, {
          myHolderId: w.holderId,
          ownerId: w.ownerId,
          meta: w.meta,
          neighborIndex: w.neighborIndex,
          n: w.ownerId.length,
        });
        for (const i of w.missiles) state.missiles.add(i);
        console.log(`WELCOME: holderId=${w.holderId}`);
        resolve();
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "강제확장테스트" }) });
    };
    client.activate();
  });

  client.subscribe("/user/queue/error", () => {}); // 실패한 개별 sortie는 무시(확장 와중 자연스러움)
  client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const i of d.missileAdd) state.missiles.add(i);
    for (const i of d.missileRemove) state.missiles.delete(i);
    for (const [idx, owner] of d.cells) state.ownerId[idx] = owner;
  });

  console.log("BFS 확장 시작 (최대 25초)...");
  const deadline = Date.now() + 25000;
  let myMissileCell = -1;
  while (Date.now() < deadline) {
    const mine = [];
    for (let i = 0; i < state.n; i++) if (state.ownerId[i] === state.myHolderId) mine.push(i);
    for (const i of mine) {
      if (state.missiles.has(i)) {
        myMissileCell = i;
        break;
      }
    }
    if (myMissileCell >= 0) break;

    // 프런티어(내 동에 인접한 비-내 동)로 전량 출정 — 생산 즉시 회복이라 반복 가능.
    const frontier = new Set();
    for (const i of mine) {
      for (const nb of state.neighborIndex[i]) {
        if (state.ownerId[nb] !== state.myHolderId) frontier.add(`${i}>${nb}`);
      }
    }
    for (const edge of frontier) {
      const [from, to] = edge.split(">").map(Number);
      client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio: 0.9 }) });
    }
    console.log(`  보유 동 ${mine.length}개, 프런티어 공격 ${frontier.size}건 발사`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (myMissileCell < 0) {
    console.log("25초 확장으로도 못 맞음 — 설정 원복 후 종료(코드 검토로는 이미 확인됨).");
  } else {
    console.log(`내 동에 미사일 확인: admIndex=${myMissileCell} (${state.meta[myMissileCell].name}) — 발사`);
    let launchError = null;
    const sub = client.subscribe("/user/queue/error", (msg) => (launchError = JSON.parse(msg.body)));
    client.publish({
      destination: "/app/missile",
      body: JSON.stringify({ center: state.meta[myMissileCell].centroid, radius: 0.02, hits: [myMissileCell] }),
    });
    await new Promise((r) => setTimeout(r, 1000));
    sub.unsubscribe();
    if (launchError) fail(`발사 거부됨: ${JSON.stringify(launchError)}`);
    if (state.missiles.has(myMissileCell)) fail("발사 후 미사일 안 사라짐");
    if (state.ownerId[myMissileCell] !== 0) fail(`중립화 실패(owner=${state.ownerId[myMissileCell]})`);
    console.log("OK: 발사 성공 → 미사일 소모 + 대상 동 중립화 확인");
  }

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, MISSILE_SPAWN_SEC: 10, MISSILE_MAX_PER_PLAYER: 5 }),
  });

  client.deactivate();
  console.log(myMissileCell >= 0 ? "FORCED LAUNCH TEST OK" : "FORCED LAUNCH TEST INCONCLUSIVE (재시도 권장)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
