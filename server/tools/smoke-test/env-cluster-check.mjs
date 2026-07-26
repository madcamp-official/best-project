// E 다중 클러스터 스폰이 실제로 "여러 곳에 흩어져" 나오는지 확인.
// WELCOME의 ownerId에서 E(255) 소유 동을 모아 인접 그래프로 연결요소(cluster)를 세면
// ENV_CLUSTER_COUNT(기본 3)개의 서로 떨어진 무리가 나와야 한다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const ENV_HOLDER_ID = 255;

const client = new Client({
  webSocketFactory: () => new WebSocket(WS_URL),
  reconnectDelay: 0,
  debug: () => {},
});

client.onConnect = () => {
  client.subscribe("/user/queue/welcome", (msg) => {
    const w = JSON.parse(msg.body);
    const envCells = [];
    for (let i = 0; i < w.ownerId.length; i++) if (w.ownerId[i] === ENV_HOLDER_ID) envCells.push(i);
    console.log(`E 보유 동 수: ${envCells.length}`);

    // 연결요소(클러스터) 세기 — E 동끼리만 연결된 그래프에서 BFS.
    const envSet = new Set(envCells);
    const visited = new Set();
    const clusters = [];
    for (const start of envCells) {
      if (visited.has(start)) continue;
      const comp = [];
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const c = stack.pop();
        comp.push(c);
        for (const nb of w.neighborIndex[c]) {
          if (envSet.has(nb) && !visited.has(nb)) {
            visited.add(nb);
            stack.push(nb);
          }
        }
      }
      clusters.push(comp);
    }
    console.log(`클러스터(연결요소) 수: ${clusters.length}`);
    for (const c of clusters) {
      console.log(`  - ${c.length}개 동: ${c.map((i) => w.meta[i].name).join(", ")}`);
    }
    if (clusters.length < 2) {
      console.log("WARN: 클러스터가 1개 이하 — ENV_CLUSTER_COUNT가 제대로 반영 안 됐을 수 있음");
    } else {
      console.log("OK: 다중 클러스터 확인됨");
    }
    client.deactivate();
    process.exit(0);
  });
  client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "클러스터확인" }) });
};
client.activate();
