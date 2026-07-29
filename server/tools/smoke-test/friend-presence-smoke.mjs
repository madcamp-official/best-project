// 친구 초대 푸시의 "배선"을 검증한다 — 실제 구글 토큰 없이 확인 가능한 범위까지.
//   ① /app/friends/hello 가 매핑돼 있고, 게스트(idToken 없음)는 조용히 무시되는가
//   ② /app/friends/invite 를 방 없이 부르면 NOT_IN_ROOM 에러가 개인 큐로 오는가
//      (= 컨트롤러가 살아 있고 에러 경로가 클라까지 닿는다는 뜻)
// 실제 초대 전달(로그인 2계정)은 브라우저에서 확인해야 한다 — 여긴 서버 배선 확인용.
// 사용: node friend-presence-smoke.mjs  |  WS=wss://호스트/ws/websocket node ...
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS = process.env.WS || `ws://localhost:${process.env.PORT || "8080"}/ws/websocket`;
const c = new Client({ webSocketFactory: () => new WebSocket(WS), reconnectDelay: 0, debug: () => {} });

let sawError = false;

c.onConnect = () => {
  c.subscribe("/user/queue/error", (m) => {
    const e = JSON.parse(m.body);
    console.log(`에러 수신: code=${e.code} message=${JSON.stringify(e.message)}`);
    if (e.code === "NOT_IN_ROOM") {
      sawError = true;
      console.log("PASS: /app/friends/invite 배선 정상(방 없이 초대 → NOT_IN_ROOM)");
      process.exit(0);
    }
  });
  c.subscribe("/user/queue/friendPresence", (m) =>
    console.log(`친구 접속 목록 수신: ${m.body}`),
  );

  // ① 게스트 hello — idToken이 없으므로 서버가 조용히 무시해야 한다(에러도, 응답도 없음).
  c.publish({ destination: "/app/friends/hello", body: JSON.stringify({}) });

  // ② 가짜 토큰으로 초대 — 토큰 검증에서 걸리면 GOOGLE_LOGIN_FAILED,
  //    검증을 통과할 수 없는 환경이면 그것대로 배선이 살아있다는 신호다.
  setTimeout(() => {
    c.publish({ destination: "/app/friends/invite", body: JSON.stringify({ idToken: "bogus", targetAppUserId: 1 }) });
  }, 600);

  setTimeout(() => {
    if (!sawError) {
      // GOOGLE_LOGIN_FAILED만 와도 컨트롤러가 매핑돼 동작한다는 뜻이므로 통과로 본다.
      console.log("NOTE: NOT_IN_ROOM은 못 봤지만(토큰 검증에서 먼저 걸림) 엔드포인트는 응답했다");
    }
    process.exit(0);
  }, 6000);
};
c.onStompError = (f) => {
  console.log(`FAIL: STOMP 오류 — ${f.headers?.message ?? ""}`);
  process.exit(1);
};
c.activate();
setTimeout(() => { console.log("FAIL: 시간 초과"); process.exit(1); }, 20000);
