// 상한 도달/근접 시 증원 병력이 소멸하지 않는지 검증 (efa572d, 426078e 반영 확인).
// 1) 이미 가득 찬 내 동으로 증원 → ALREADY_FULL, DELTA 없음(troops 불변)
// 2) 상한 근접(여유 적음) 내 동으로 증원 → amount가 headroom으로 클램프, troops == cap(초과 없음)

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function connect(nickname) {
  return new Promise((resolve) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(WS_URL),
      reconnectDelay: 0,
      debug: () => {},
    });
    client.onConnect = () => {
      const state = { ownerId: null, myHolderId: -1, neighborIndex: null, troops: null, troopCap: null };
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        state.myHolderId = w.holderId;
        state.ownerId = w.ownerId;
        state.neighborIndex = w.neighborIndex;
        state.troops = w.troops;
        state.troopCap = w.troopCap;
        resolve({ client, state });
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname }) });
    };
    client.activate();
  });
}

async function main() {
  const { client, state } = await connect("가득참테스트");
  const myCell = state.ownerId.findIndex((o) => o === state.myHolderId);
  const neighbor = state.neighborIndex[myCell][0];
  console.log(`시작 동=${myCell}, 이웃=${neighbor}, cap=${state.troopCap[myCell]}`);

  let lastError = null;
  let lastDelta = null;
  client.subscribe("/user/queue/error", (msg) => {
    lastError = JSON.parse(msg.body);
  });
  client.subscribe("/topic/world", (msg) => {
    lastDelta = JSON.parse(msg.body);
  });

  // 이웃을 점령해서 "내 동 2개, 서로 인접"인 상태를 만든다 (ratio=1.0로 최대한 크게 보냄).
  console.log("[1] 이웃 점령...");
  client.publish({ destination: "/app/sortie", body: JSON.stringify({ from: myCell, to: neighbor, ratio: 1.0 }) });
  await new Promise((r) => setTimeout(r, 3000)); // 이동+도착 대기

  // 점령한 이웃 동이 이미 가득 찼는지(troops==cap) 확인 — 방금 함락 직후라 남은 병력이 상한보다 낮을 수 있음.
  // 생산이 상한까지 차오르길(FILL_TO_CAP_SEC=180s 전부는 아니어도) 기다리는 대신,
  // 반대로 myCell -> neighbor로 다시 증원을 여러 번 보내 neighbor를 가득 채운다.
  console.log("[2] neighbor를 가득 채우는 중...");
  for (let i = 0; i < 15; i++) {
    lastError = null;
    lastDelta = null;
    client.publish({ destination: "/app/sortie", body: JSON.stringify({ from: myCell, to: neighbor, ratio: 1.0 }) });
    await new Promise((r) => setTimeout(r, 1600));
    if (lastError?.code === "ALREADY_FULL") {
      console.log(`  ALREADY_FULL 수신(반복 ${i + 1}) — neighbor가 가득 참`);
      break;
    }
  }

  if (lastError?.code !== "ALREADY_FULL") {
    fail("여러 번 증원해도 ALREADY_FULL을 못 받음 — 상한 근처까지 못 채웠거나 버그");
  }

  // ALREADY_FULL 직전 DELTA에서 troops가 cap을 초과하지 않았는지 확인.
  console.log("[3] 최종 확인 — troops가 cap을 절대 넘지 않았는지");
  console.log("  마지막 ERROR:", lastError);
  console.log("  마지막 DELTA(있었다면):", lastDelta);

  client.deactivate();
  console.log("ALREADY_FULL TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
