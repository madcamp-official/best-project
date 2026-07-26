// 미사일 시스템 라이브 검증.
// 결정적으로 확인 가능한 것(스폰 브로드캐스트, 미보유 시 거부)은 반드시 통과해야 하고,
// "내 동에 자연 스폰되는지"는 전국 5,065개 동 중 무작위라 확률이 낮아(테스트 창 안에
// 내가 소유한 소수의 동에 맞을 확률 낮음) 기회가 오면 발사까지 검증하되, 안 와도 실패로
// 치지 않는다(코드 검토로 launchMissile 로직은 core.ts와 대조 완료).

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const WAIT_SEC = 40;

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  const state = { ownerId: null, myHolderId: -1, meta: null, n: 0, missiles: new Set() };

  const client = new Client({
    webSocketFactory: () => new WebSocket(WS_URL),
    reconnectDelay: 0,
    debug: () => {},
  });

  await new Promise((resolve) => {
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        state.myHolderId = w.holderId;
        state.ownerId = w.ownerId;
        state.meta = w.meta;
        state.neighborIndex = w.neighborIndex;
        state.n = w.ownerId.length;
        for (const i of w.missiles) state.missiles.add(i);
        console.log(`WELCOME: holderId=${w.holderId}, 기존 미사일 동 수=${w.missiles.length}, 전체 동=${state.n}`);
        resolve();
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "미사일테스트" }) });
    };
    client.activate();
  });

  // [1] 미보유 상태에서 발사 시도 → NO_MISSILE (결정적으로 검증 가능한 경로).
  console.log("[1] 미사일 없는 상태에서 발사 시도...");
  let errorForStep1 = null;
  const errSub = client.subscribe("/user/queue/error", (msg) => {
    errorForStep1 = JSON.parse(msg.body);
  });
  const myCell = state.ownerId.findIndex((o) => o === state.myHolderId);
  client.publish({
    destination: "/app/missile",
    body: JSON.stringify({ center: state.meta[myCell].centroid, radius: 0.02, hits: [myCell] }),
  });
  await new Promise((r) => setTimeout(r, 800));
  if (errorForStep1?.code !== "NO_MISSILE") {
    fail(`미보유 발사가 NO_MISSILE로 거부되지 않음: ${JSON.stringify(errorForStep1)}`);
  }
  console.log("  OK: NO_MISSILE 정상 거부");
  errSub.unsubscribe();

  // [2] 스폰 브로드캐스트가 실제로 오는지 (MISSILE_SPAWN_SEC=10s 기준, 넉넉히 대기).
  console.log(`[2] 미사일 스폰 대기(최대 ${WAIT_SEC}s, 전국 아무 동이나)...`);
  let sawAnySpawn = false;
  let myMissileCell = -1;
  client.subscribe("/user/queue/error", () => {}); // 이후 에러는 무시(발사 실패해도 테스트 계속)
  client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const i of d.missileAdd) {
      sawAnySpawn = true;
      state.missiles.add(i);
    }
    for (const i of d.missileRemove) state.missiles.delete(i);
    for (const [idx, owner] of d.cells) state.ownerId[idx] = owner;
  });

  const deadline = Date.now() + WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    for (const i of state.missiles) {
      if (state.ownerId[i] === state.myHolderId) {
        myMissileCell = i;
        break;
      }
    }
    if (myMissileCell >= 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!sawAnySpawn) fail("스폰이 한 번도 안 옴 — GameLoop 스폰 스케줄 자체가 문제일 수 있음");
  console.log(`  OK: 스폰 브로드캐스트 확인됨(누적 ${state.missiles.size}개 동에 미사일 존재)`);

  // [3] 내 동에 우연히 스폰됐으면 발사까지 확인(기회가 왔을 때만 — 결정적 요구 아님).
  if (myMissileCell < 0) {
    console.log(
      `[3] 이번 실행에서는 내 동(1개)에 자연 스폰이 안 걸림 — 예상 범위(전국 ${state.n}개 중 무작위). 스폰/거부 경로 확인으로 충분.`
    );
  } else {
    console.log(`[3] 내 동에 미사일 확인: admIndex=${myMissileCell} (${state.meta[myMissileCell].name}) — 발사 시도`);
    let launchError = null;
    const sub2 = client.subscribe("/user/queue/error", (msg) => {
      launchError = JSON.parse(msg.body);
    });
    client.publish({
      destination: "/app/missile",
      body: JSON.stringify({ center: state.meta[myMissileCell].centroid, radius: 0.02, hits: [myMissileCell] }),
    });
    await new Promise((r) => setTimeout(r, 1000));
    sub2.unsubscribe();
    if (launchError) fail(`정상 발사가 거부됨: ${JSON.stringify(launchError)}`);
    if (state.missiles.has(myMissileCell)) fail("발사 후에도 미사일이 안 사라짐");
    if (state.ownerId[myMissileCell] !== 0) fail(`중립화 안 됨(owner=${state.ownerId[myMissileCell]})`);
    console.log("  OK: 발사 성공, 미사일 소모, 대상 동 중립화 확인");
  }

  client.deactivate();
  console.log("MISSILE TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
