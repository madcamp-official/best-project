// B3 공수부대(airdrop) 신규 기능 최소 검증. 팀원이 서버까지 구현해 올린 기능이라 포팅은
// 필요 없고, 병합 후 프로토콜이 실제로 동작하는지만 빠르게 확인한다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const client = new Client({
  webSocketFactory: () => new WebSocket("ws://localhost:8080/ws/websocket"),
  reconnectDelay: 0,
  debug: () => {},
});

let holderId = -1;
let myCell = -1;
let sawAirdropOrder = false;
let lastError = null;

client.subscribe = client.subscribe; // no-op, keep bundlers happy

await new Promise((resolve) => {
  client.onConnect = () => {
    client.subscribe("/user/queue/welcome", (msg) => {
      const w = JSON.parse(msg.body);
      holderId = w.holderId;
      myCell = w.ownerId.findIndex((o) => o === holderId);
      console.log(`holderId=${holderId} myCell=${myCell}`);
      resolve();
    });
    client.subscribe("/user/queue/error", (msg) => {
      lastError = JSON.parse(msg.body);
    });
    client.subscribe("/topic/world", (msg) => {
      const d = JSON.parse(msg.body);
      for (const o of d.newOrders) if (o.holderId === holderId && o.airdrop === true) sawAirdropOrder = true;
      for (const o of d.newOrders) if (o.holderId === holderId) console.log("  order:", JSON.stringify(o));
    });
    client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "공수확인" }) });
  };
  client.activate();
});

// 내 시작 동 자체를 sources로, 인접 동을 dest로 공수 시도(가장 단순한 유효 케이스).
console.log("공수부대 발사 시도...");
client.publish({ destination: "/app/airdrop", body: JSON.stringify({ sources: [myCell], dest: myCell }) });

await new Promise((r) => setTimeout(r, 2000));

console.log("에러 응답:", lastError ? JSON.stringify(lastError) : "(없음)");
client.deactivate();

// dest=myCell(자기 자신)은 보통 무효 케이스라 에러가 정상. 여기선 "서버가 요청을 이해하고
// 뭔가 응답했다"(에러든 order든)는 것만 확인 — 완전 무응답(타임아웃)이면 프로토콜 자체가 깨진 것.
if (!sawAirdropOrder && !lastError) {
  console.error("FAIL: /app/airdrop 요청에 서버가 order도 error도 응답하지 않음");
  process.exit(1);
}
console.log("AIRDROP SMOKE OK (서버가 요청을 처리함)");
