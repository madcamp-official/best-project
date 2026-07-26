// 미사일 스폰이 특정 시도(서울·부산 등)에 쏠리지 않고 전국에 고르게 퍼지는지 확인.
// /admin/config로 스폰 주기를 잠깐 아주 짧게 줄여 여러 번 빠르게 관측한다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const ADMIN_URL = "http://localhost:8080/admin/config";
const SAMPLE_SIZE = 40;

async function main() {
  console.log(`설정 임시 상향(MISSILE_SPAWN_SEC=0.3, MISSILE_MAX_TOTAL=999)로 ${SAMPLE_SIZE}개 표본 수집...`);
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ MISSILE_SPAWN_SEC: 0.3, MISSILE_MAX_TOTAL: 999, MISSILE_MAX_PER_PLAYER: 999 }),
  });

  const client = new Client({
    webSocketFactory: () => new WebSocket(WS_URL),
    reconnectDelay: 0,
    debug: () => {},
  });

  const sidoCounts = new Map();
  let meta = null;
  let total = 0;

  await new Promise((resolve) => {
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        meta = w.meta;
        for (const i of w.missiles) {
          const sido = meta[i].sidonm || meta[i].sidocd;
          sidoCounts.set(sido, (sidoCounts.get(sido) ?? 0) + 1);
          total++;
        }
        resolve();
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "분포확인" }) });
    };
    client.activate();
  });

  client.subscribe("/topic/world", (msg) => {
    const d = JSON.parse(msg.body);
    for (const i of d.missileAdd) {
      const sido = meta[i].sidonm || meta[i].sidocd;
      sidoCounts.set(sido, (sidoCounts.get(sido) ?? 0) + 1);
      total++;
    }
  });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && total < SAMPLE_SIZE) {
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ MISSILE_SPAWN_SEC: 5, MISSILE_MAX_TOTAL: 60, MISSILE_MAX_PER_PLAYER: 8 }),
  });
  client.deactivate();

  console.log(`총 표본: ${total}`);
  const sorted = [...sidoCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [sido, count] of sorted) {
    console.log(`  ${sido}: ${count}개 (${((count / total) * 100).toFixed(1)}%)`);
  }
  console.log(`서로 다른 시도 수: ${sidoCounts.size} / 17`);

  const top = sorted[0];
  if (top && top[1] / total > 0.35) {
    console.log(`WARN: ${top[0]}에 ${((top[1] / total) * 100).toFixed(0)}% 쏠림 — 여전히 편중일 수 있음`);
  } else {
    console.log("OK: 특정 시도에 심하게 쏠리지 않음");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
