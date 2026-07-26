import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const client = new Client({
  webSocketFactory: () => new WebSocket("ws://localhost:8080/ws/websocket"),
  reconnectDelay: 0,
  debug: () => {},
});

let welcome = null;

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const timeout = setTimeout(() => fail("timed out waiting for WELCOME"), 8000);

client.onConnect = () => {
  console.log("STOMP connected");

  client.subscribe("/user/queue/welcome", (msg) => {
    welcome = JSON.parse(msg.body);
    clearTimeout(timeout);
    console.log("WELCOME received:", {
      holderId: welcome.holderId,
      paletteIdx: welcome.paletteIdx,
      cellCount: welcome.ownerId.length,
      holders: welcome.holders,
      neighborSample: welcome.neighborIndex[0],
    });

    const myCell = welcome.ownerId.findIndex((o) => o === welcome.holderId);
    if (myCell === -1) fail("no cell owned by my holderId in WELCOME snapshot");
    console.log("my start cell admIndex:", myCell, welcome.meta[myCell]);

    client.subscribe("/topic/world", (m) => {
      const delta = JSON.parse(m.body);
      console.log("DELTA:", delta);
    });
    client.subscribe("/user/queue/error", (m) => {
      console.log("ERROR:", JSON.parse(m.body));
    });

    // 1) 인접하지 않은 동으로 출정 → ERROR(NOT_ADJACENT) 기대
    const notNeighbor = welcome.ownerId.findIndex((_, i) => i !== myCell && !welcome.neighborIndex[myCell].includes(i));
    client.publish({ destination: "/app/sortie", body: JSON.stringify({ from: myCell, to: notNeighbor }) });

    // 2) 실제 인접 동으로 ratio=0.9 출정 → DELTA(내 동 troops가 90% 감소) 기대
    setTimeout(() => {
      const neighbor = welcome.neighborIndex[myCell][0];
      console.log("sortie(ratio=0.9) to real neighbor:", neighbor);
      client.publish({
        destination: "/app/sortie",
        body: JSON.stringify({ from: myCell, to: neighbor, ratio: 0.9 }),
      });
    }, 500);

    setTimeout(() => {
      console.log("SMOKE TEST OK");
      client.deactivate();
      process.exit(0);
    }, 4000);
  });

  client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "스모크테스트" }) });
};

client.onStompError = (frame) => fail("STOMP error: " + frame.body);
client.onWebSocketError = (e) => fail("WS error: " + e.message);

client.activate();
