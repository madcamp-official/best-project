// 방장 재접속 유지 E2E: 같은 clientId·다른 연결(=재접속, 새 principal)로 방에 재입장해도
// 방장(youAreHost=true)이 유지되고, 유령 멤버가 dedup으로 제거되는지(members=1) 확인한다.
// (버그였던 것: 방장 신원이 연결별 principal에 묶여 재접속 시 방장 자리를 잃음.)
// 사용: PORT=8081 node host-reconnect-smoke.mjs
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const PORT = process.env.PORT || "8080";
const CID = "reconnect-fixed-client-id"; // 두 연결이 같은 clientId = 같은 사람

function mk() {
  return new Client({
    webSocketFactory: () => new WebSocket(`ws://localhost:${PORT}/ws/websocket`),
    reconnectDelay: 0,
    debug: () => {},
  });
}
function fail(m) {
  console.error("FAIL:", m);
  process.exit(1);
}
const timeout = setTimeout(() => fail("timeout"), 20000);

let roomId = null;
const flags = { a1Host: false, a2HostAfterReconnect: false, singleMember: false };

const a1 = mk();
const a2 = mk();

a1.onConnect = () => {
  a1.subscribe("/user/queue/roomJoined", (m) => {
    const rj = JSON.parse(m.body);
    if (roomId) return;
    roomId = rj.roomId;
    flags.a1Host = rj.youAreHost === true;
    console.log("A1 created room", roomId, "host=", rj.youAreHost, "members=", rj.members.length);
    a2.activate(); // 같은 clientId로 '재접속'(새 principal)
  });
  a1.subscribe("/user/queue/error", (m) => console.log("A1 ERR", JSON.parse(m.body).code));
  a1.publish({
    destination: "/app/lobby/create",
    body: JSON.stringify({ name: "재접속테스트", nickname: "방장", clientId: CID }),
  });
};

a2.onConnect = () => {
  a2.subscribe("/user/queue/roomJoined", (m) => {
    const rj = JSON.parse(m.body);
    flags.a2HostAfterReconnect = rj.youAreHost === true;
    flags.singleMember = rj.members.length === 1; // dedup: 유령(옛 principal) 제거로 1명
    const host = rj.members.find((x) => x.host);
    console.log("A2 reconnect-join, host=", rj.youAreHost, "members=", rj.members.length, "hostBadge=", host?.host);
    clearTimeout(timeout);
    setTimeout(() => {
      const ok = flags.a1Host && flags.a2HostAfterReconnect && flags.singleMember;
      console.log("--- RESULT ---", flags);
      console.log(ok ? "HOST-RECONNECT E2E OK" : "HOST-RECONNECT E2E FAIL");
      a1.deactivate();
      a2.deactivate();
      process.exit(ok ? 0 : 1);
    }, 300);
  });
  a2.subscribe("/user/queue/error", (m) => console.log("A2 ERR", JSON.parse(m.body).code));
  a2.publish({
    destination: "/app/lobby/join",
    body: JSON.stringify({ roomId, nickname: "방장", clientId: CID }),
  });
};

a1.onStompError = (f) => fail("A1 stomp " + f.body);
a2.onStompError = (f) => fail("A2 stomp " + f.body);
a1.onWebSocketError = (e) => fail("A1 ws " + (e.message || e));
a2.onWebSocketError = (e) => fail("A2 ws " + (e.message || e));
a1.activate();
