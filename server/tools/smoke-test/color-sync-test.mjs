// 색상 불일치 버그 재현+수정 확인: A가 먼저 접속해 있는 상태에서 B가 나중에 접속하면,
// A의 클라이언트가 B의 holder 정보(paletteIdx)를 DELTA.newHolders로 받아
// world.holders에 채우는지 확인한다(이전엔 몰라서 땅이 회색(fallback)으로 나왔음).

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";

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

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log("[1] A 먼저 접속...");
  const a = await connectAndJoin("색상A");
  console.log(`  A holderId=${a.welcome.holderId}, paletteIdx=${a.welcome.paletteIdx}`);

  // A는 world.holders를 시뮬레이션 — WELCOME 시점 holders만 반영(이후는 DELTA.newHolders로만 갱신).
  const aHolders = new Map(a.welcome.holders.map((h) => [h.id, h]));
  a.client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const h of d.newHolders) aHolders.set(h.id, h); // 이게 고친 핵심 로직
  });

  console.log("[2] A가 이미 접속 중인 상태에서 B 접속...");
  const b = await connectAndJoin("색상B");
  console.log(`  B holderId=${b.welcome.holderId}, paletteIdx(서버 기준)=${b.welcome.paletteIdx}`);

  await new Promise((r) => setTimeout(r, 1000)); // DELTA 한 틱 이상 대기

  const bSeenByA = aHolders.get(b.welcome.holderId);
  if (!bSeenByA) fail("A의 world.holders에 B가 전혀 없음 — newHolders가 안 옴");
  if (bSeenByA.paletteIdx !== b.welcome.paletteIdx) {
    fail(`A가 아는 B의 paletteIdx(${bSeenByA.paletteIdx})가 B 실제 paletteIdx(${b.welcome.paletteIdx})와 다름`);
  }
  console.log(`  확인: A가 B의 정확한 paletteIdx(${bSeenByA.paletteIdx})를 즉시 알고 있음`);

  a.client.deactivate();
  b.client.deactivate();
  console.log("COLOR SYNC TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
