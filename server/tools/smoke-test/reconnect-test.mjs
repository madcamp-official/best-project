// plan.md Day 3 "게스트 토큰 재접속 복구", Day 4 "재접속 엣지 케이스" 검증.
// 1) 정상 토큰 재접속 → 같은 holderId·영토 복구
// 2) 유효하지 않은(가짜) 토큰 → 신규 참가자로 처리(에러 아님)
// 3) 연결이 끊긴 뒤 자동 재연결 시에도 서버가 계속 응답(healthz)

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";

function connectAndJoin(nickname, token) {
  return new Promise((resolve, reject) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(WS_URL),
      reconnectDelay: 0,
      debug: () => {},
    });
    const timeout = setTimeout(() => reject(new Error(`timeout waiting WELCOME for ${nickname}`)), 8000);
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        clearTimeout(timeout);
        resolve({ client, welcome: JSON.parse(msg.body) });
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname, token }) });
    };
    client.onWebSocketError = (e) => reject(e);
    client.activate();
  });
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log("[1] 최초 접속...");
  const first = await connectAndJoin("재접속테스트", undefined);
  const originalHolderId = first.welcome.holderId;
  const originalToken = first.welcome.token;
  const startCell = first.welcome.ownerId.findIndex((o) => o === originalHolderId);
  console.log(`  holderId=${originalHolderId} token=${originalToken.slice(0, 8)}... startCell=${startCell}`);
  if (startCell === -1) fail("최초 접속 WELCOME에 시작 동이 없음");

  // 정상 종료 없이 갑자기 끊는다(네트워크 드랍 시뮬레이션) — STOMP DISCONNECT 프레임 없이 소켓만 close.
  first.client.forceDisconnect();
  await new Promise((r) => setTimeout(r, 300));

  console.log("[2] 같은 토큰으로 재접속...");
  const restored = await connectAndJoin("무시될닉네임", originalToken);
  console.log(`  holderId=${restored.welcome.holderId} token=${restored.welcome.token.slice(0, 8)}...`);
  if (restored.welcome.holderId !== originalHolderId) {
    fail(`재접속 holderId 불일치: 기대=${originalHolderId} 실제=${restored.welcome.holderId}`);
  }
  if (restored.welcome.ownerId[startCell] !== originalHolderId) {
    fail("재접속 후 기존 시작 동 소유권이 사라짐");
  }
  const restoredHolderName = restored.welcome.holders.find((h) => h.id === originalHolderId)?.name;
  if (restoredHolderName !== "재접속테스트") {
    fail(`재접속 시 닉네임이 바뀌면 안 됨(무시 기대). 실제=${restoredHolderName}`);
  }
  console.log("  OK: holderId·영토·닉네임 모두 유지됨");
  restored.client.deactivate();

  console.log("[3] 유효하지 않은(가짜) 토큰으로 접속...");
  const fakeToken = "00000000-0000-0000-0000-000000000000";
  const asNew = await connectAndJoin("가짜토큰테스트", fakeToken);
  if (asNew.welcome.holderId === originalHolderId) {
    fail("가짜 토큰인데 기존 holderId를 복구해버림");
  }
  if (asNew.welcome.token === fakeToken) {
    fail("가짜 토큰을 그대로 재사용함(새 토큰을 발급해야 함)");
  }
  console.log(`  OK: 신규 holderId=${asNew.welcome.holderId} 로 새 토큰 발급됨(가짜 토큰 무시)`);
  asNew.client.deactivate();

  console.log("[4] 부하 이후 healthz 재확인...");
  const res = await fetch("http://localhost:8080/healthz");
  const text = await res.text();
  if (!res.ok || text !== "ok") fail("healthz 응답 이상");
  console.log("  OK");

  console.log("RECONNECT TEST OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
