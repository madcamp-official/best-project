// web/src/net/stompConnection.ts의 실제 로직(reconnectDelay + onConnect에서 재구독·재JOIN)을
// 그대로 재현해, stompjs의 자동 재연결까지 포함한 전체 경로가 holderId를 유지하는지 검증한다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  let token;
  let nickname = "자동재연결테스트";
  let connectCount = 0;
  let lastWelcome = null;

  const client = new Client({
    webSocketFactory: () => new WebSocket(WS_URL),
    reconnectDelay: 500, // stompConnection.ts와 다른 값(테스트 시간 단축)이지만 메커니즘은 동일
    debug: () => {},
  });

  const welcomeReceived = () =>
    new Promise((resolve) => {
      const sub = client.subscribe("/user/queue/welcome", (msg) => {
        sub.unsubscribe();
        resolve(JSON.parse(msg.body));
      });
    });

  client.onConnect = () => {
    connectCount++;
    console.log(`onConnect #${connectCount}`);
    const p = welcomeReceived();
    client.publish({ destination: "/app/join", body: JSON.stringify({ nickname, token }) });
    p.then((w) => {
      token = w.token; // stompConnection.ts handleWelcome과 동일하게 최신 토큰을 계속 갱신
      lastWelcome = w;
    });
  };

  client.activate();

  console.log("[1] 최초 연결 대기...");
  await new Promise((r) => setTimeout(r, 1500));
  if (connectCount !== 1) fail(`최초 onConnect 횟수 이상: ${connectCount}`);
  if (!lastWelcome) fail("최초 WELCOME 못 받음");
  const holderId = lastWelcome.holderId;
  console.log(`  holderId=${holderId} token=${token.slice(0, 8)}...`);

  console.log("[2] 강제 연결 끊기(forceDisconnect) — stompjs 자동 재연결 대기...");
  client.forceDisconnect();
  await new Promise((r) => setTimeout(r, 2500)); // reconnectDelay(500ms) + WELCOME 왕복 여유

  if (connectCount < 2) fail(`자동 재연결 후 onConnect가 다시 안 불림(count=${connectCount})`);
  if (lastWelcome.holderId !== holderId) {
    fail(`자동 재연결 후 holderId 바뀜: ${holderId} -> ${lastWelcome.holderId}`);
  }
  console.log(`  OK: onConnect ${connectCount}회, holderId 유지(${lastWelcome.holderId})`);

  client.deactivate();
  console.log("AUTO-RECONNECT TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
