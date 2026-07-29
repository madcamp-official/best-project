// 친구 초대 흐름 검증 — 클라 FriendsPanel "초대" 버튼이 타는 서버 경로 그대로 확인한다.
//   ① 비공개 방 생성(private=true) → roomJoined에 joinCode가 실려 오는가
//   ② 그 방이 공개 목록(/topic/rooms)에서 빠지는가 (코드를 아는 사람만 입장)
//   ③ 다른 클라가 그 코드로 /app/lobby/joinByCode 입장에 성공하는가
// 사용: node friend-invite-smoke.mjs            (로컬 8080)
//       WS=wss://호스트/ws/websocket node ...   (배포 서버)
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS = process.env.WS || `ws://localhost:${process.env.PORT || "8080"}/ws/websocket`;
const mk = () => new Client({ webSocketFactory: () => new WebSocket(WS), reconnectDelay: 0, debug: () => {} });
const fail = (m) => { console.log(`FAIL: ${m}`); process.exit(1); };

const host = mk();
let joinCode = null;
let roomId = null;

host.onConnect = () => {
  host.subscribe("/user/queue/roomJoined", (m) => {
    const r = JSON.parse(m.body);
    if (joinCode) return;
    roomId = r.roomId;
    joinCode = r.joinCode;
    console.log(`① 방 생성: roomId=${r.roomId} joinCode=${r.joinCode ?? "(없음)"}`);
    if (!r.joinCode) fail("비공개 방인데 joinCode가 안 왔다");

    // ② 공개 목록에서 빠졌는지
    host.subscribe("/topic/rooms", (lm) => {
      const list = JSON.parse(lm.body);
      const leaked = list.rooms.some((x) => x.roomId === roomId);
      console.log(`② 공개 목록 노출: ${leaked ? "노출됨(문제)" : "숨겨짐(정상)"}`);
      if (leaked) fail("비공개 방이 공개 목록에 노출됐다");
      joinByCode();
    });
    host.publish({ destination: "/app/lobby/list", body: "{}" });
  });

  host.publish({
    destination: "/app/lobby/create",
    body: JSON.stringify({ name: "초대테스트", nickname: "호스트", clientId: "smoke-host", private: true }),
  });
};

function joinByCode() {
  const guest = mk();
  guest.onConnect = () => {
    guest.subscribe("/user/queue/roomJoined", (m) => {
      const r = JSON.parse(m.body);
      console.log(`③ 코드로 입장: roomId=${r.roomId} members=${r.members.length}`);
      if (r.roomId !== roomId) fail("다른 방에 들어갔다");
      console.log("PASS: 친구 초대 경로(비공개 방 생성 → 코드 발급 → 코드 입장) 정상");
      process.exit(0);
    });
    guest.subscribe("/user/queue/error", (m) => fail(`입장 거부: ${m.body}`));
    guest.publish({
      destination: "/app/lobby/joinByCode",
      body: JSON.stringify({ code: joinCode, nickname: "초대받은친구", clientId: "smoke-guest" }),
    });
  };
  guest.activate();
}

host.activate();
setTimeout(() => fail("시간 초과"), 20000);
