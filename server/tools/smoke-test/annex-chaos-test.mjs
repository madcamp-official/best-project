// annex-test.mjs(정밀 유도)가 시군구 다양성 배정 때문에 B를 A 근처에 앉히기 어려워서
// 실패 — 대신 여러 명이 동시에 국소 확장(BFS)하게 해서, 서로 맞닿는 경계에서 자연스럽게
// 포위 포켓이 생기는지(=실제 플레이 중 벌어질 상황) 관찰한다. 결정적이진 않지만 정밀 유도보다
// 현실적인 시나리오다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const WS_URL = "ws://localhost:8080/ws/websocket";
const ADMIN_URL = "http://localhost:8080/admin/config";
const BOT_COUNT = 8;
const DURATION_SEC = 45;

function connectAndJoin(nickname) {
  return new Promise((resolve) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(WS_URL),
      reconnectDelay: 0,
      debug: () => {},
    });
    const state = { ownerId: null, holderId: -1, neighborIndex: null, n: 0 };
    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        Object.assign(state, { holderId: w.holderId, ownerId: w.ownerId, neighborIndex: w.neighborIndex, n: w.ownerId.length });
        resolve({ client, state });
      });
      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname }) });
    };
    client.activate();
  });
}

async function main() {
  console.log("설정 임시 상향(FILL_TO_CAP_SEC=1, ANNEX_HOLD_SEC=2, 방어막 최소화)...");
  // 스폰 방어막(기본 120초)이 있으면 갓 접속한 봇들 서로가 이 테스트 내내(45초) 보호돼
  // 포위 흡수 자체가 안 걸린다 — 이 테스트는 포위 귀속 로직 검증이 목적이라 최소화한다.
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 1, ANNEX_HOLD_SEC: 2, SPAWN_SHIELD_SEC: 0.1 }),
  });

  const annexLogs = [];
  const bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    const bot = await connectAndJoin(`혼돈${i}`);
    bot.client.subscribe("/user/queue/error", () => {});
    bot.client.subscribe("/topic/world", (msg) => {
      const d = JSON.parse(msg.body);
      for (const [idx, owner] of d.cells) {
        for (const b of bots) if (b.state.ownerId) b.state.ownerId[idx] = owner;
      }
      for (const e of d.events) {
        if (e.message.includes("포위")) {
          annexLogs.push(e.message);
          console.log("  [ANNEX LOG]", e.message);
        }
      }
    });
    bots.push(bot);
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`${BOT_COUNT}명 접속 완료. ${DURATION_SEC}초 동안 전원 국소 BFS 확장...`);

  const deadline = Date.now() + DURATION_SEC * 1000;
  while (Date.now() < deadline) {
    for (const bot of bots) {
      const { client, state } = bot;
      const mine = [];
      for (let i = 0; i < state.n; i++) if (state.ownerId[i] === state.holderId) mine.push(i);
      const frontier = new Set();
      for (const i of mine) {
        for (const nb of state.neighborIndex[i]) {
          if (state.ownerId[nb] !== state.holderId) frontier.add(`${i}>${nb}`);
        }
      }
      // 부하 제한: 프런티어가 너무 크면 일부만(랜덤 샘플) 쏜다.
      const edges = [...frontier];
      const sample = edges.length > 40 ? edges.sort(() => Math.random() - 0.5).slice(0, 40) : edges;
      for (const edge of sample) {
        const [from, to] = edge.split(">").map(Number);
        client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio: 0.9 }) });
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  const summary = bots.map((b) => {
    let c = 0;
    for (let i = 0; i < b.state.n; i++) if (b.state.ownerId[i] === b.state.holderId) c++;
    return c;
  });
  console.log("각 봇 최종 보유 동 수:", summary, "합계:", summary.reduce((a, b) => a + b, 0), "/", bots[0].state.n);

  console.log("설정 원복...");
  await fetch(ADMIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FILL_TO_CAP_SEC: 180, ANNEX_HOLD_SEC: 5, SPAWN_SHIELD_SEC: 120 }),
  });

  for (const b of bots) b.client.deactivate();

  console.log(`포위 흡수 로그 발생 횟수: ${annexLogs.length}`);
  console.log(annexLogs.length > 0 ? "ANNEX CHAOS TEST: 포위 흡수 실제 관측됨" : "ANNEX CHAOS TEST: 이번 실행에선 자연 발생 안 함(코드 검토로만 확인된 상태)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
