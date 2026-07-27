// 진단용: 방 목록을 받아서 그대로 찍고 5초 뒤 종료.
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const PORT = process.env.PORT || "8080";
const client = new Client({
  webSocketFactory: () => new WebSocket(`ws://localhost:${PORT}/ws/websocket`),
  reconnectDelay: 0,
  debug: () => {},
});

client.onConnect = () => {
  client.subscribe("/topic/rooms", (m) => {
    const list = JSON.parse(m.body);
    console.log(`ROOM COUNT: ${list.rooms.length}`);
    for (const r of list.rooms) {
      console.log(`  ${r.roomId} name=${JSON.stringify(r.name)} state=${r.state} members=${r.memberCount}/${r.maxMembers}`);
    }
  });
  client.publish({ destination: "/app/lobby/list", body: "{}" });
  setTimeout(() => process.exit(0), 4000);
};
client.activate();
