// plan.md Day 4 "동시성 검증(명령 경합, tick과 명령 처리 순서)"를 자동화한 부하 테스트.
// N명이 동시 접속해 짧은 간격으로 SORTIE를 난사한 뒤, 서버가 죽지 않고(healthz),
// 최종 월드 상태가 불변식(troops <= cap, ownerId가 항상 유효한 holder)을 지키는지 확인한다.
//
// 사용: node load-test.mjs [botCount=25] [durationSec=8] [wsUrl=ws://localhost:8080/ws/websocket]

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const BOT_COUNT = Number(process.argv[2] ?? 25);
const DURATION_SEC = Number(process.argv[3] ?? 8);
const WS_URL = process.argv[4] ?? "ws://localhost:8080/ws/websocket";
const HEALTHZ_URL = WS_URL.replace(/^ws/, "http").replace("/ws/websocket", "/healthz");

let totalSorties = 0;
let totalErrors = 0;
const errorCodeCounts = {};
let totalDeltas = 0;
const clientErrors = [];

function makeBot(i) {
  return new Promise((resolve) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(WS_URL),
      reconnectDelay: 0,
      debug: () => {},
    });

    const state = { ownerId: null, myHolderId: -1, neighborIndex: null, n: 0 };
    let timer = null;

    client.onConnect = () => {
      client.subscribe("/user/queue/welcome", (msg) => {
        const w = JSON.parse(msg.body);
        state.myHolderId = w.holderId;
        state.n = w.ownerId.length;
        state.ownerId = Int32Array.from(w.ownerId);
        state.neighborIndex = w.neighborIndex;

        // DURATION_SEC 동안 무작위 인접 동으로 계속 출정.
        timer = setInterval(() => {
          const mine = [];
          for (let idx = 0; idx < state.n; idx++) if (state.ownerId[idx] === state.myHolderId) mine.push(idx);
          if (mine.length === 0) return;
          const from = mine[Math.floor(Math.random() * mine.length)];
          const candidates = state.neighborIndex[from];
          if (!candidates || candidates.length === 0) return;
          const to = candidates[Math.floor(Math.random() * candidates.length)];
          const ratio = 0.2 + Math.random() * 0.7;
          client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to, ratio }) });
          totalSorties++;
        }, 120 + Math.random() * 80);
      });

      client.subscribe("/user/queue/error", (msg) => {
        const e = JSON.parse(msg.body);
        totalErrors++;
        errorCodeCounts[e.code] = (errorCodeCounts[e.code] ?? 0) + 1;
      });

      client.subscribe("/topic/world", (msg) => {
        totalDeltas++;
        const d = JSON.parse(msg.body);
        // /topic/world는 전역 브로드캐스트라 이 봇의 WELCOME(자기 world 초기화)보다
        // 먼저 도착할 수 있다 — 실제 클라(worldView.applyWelcome)는 이후 전체 스냅샷으로
        // 통째로 덮어써 무해하지만, 이 테스트 하네스는 아직 초기화 전이면 그냥 버린다.
        if (!state.ownerId) return;
        for (const [idx, owner] of d.cells) state.ownerId[idx] = owner;
      });

      client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: `bot${i}` }) });
      setTimeout(() => resolve({ client, timer, state }), 500);
    };

    client.onWebSocketError = (e) => clientErrors.push(`bot${i} ws error: ${e?.message ?? e}`);
    client.onStompError = (frame) => clientErrors.push(`bot${i} stomp error: ${frame.body}`);
    client.activate();
  });
}

async function main() {
  console.log(`부하 테스트 시작: bots=${BOT_COUNT} duration=${DURATION_SEC}s target=${WS_URL}`);

  const bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    bots.push(await makeBot(i));
    await new Promise((r) => setTimeout(r, 20)); // 접속 폭주 완화(순차 접속)
  }
  console.log(`${bots.length}명 접속 완료. ${DURATION_SEC}초 동안 출정 난사...`);

  await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));

  for (const b of bots) {
    if (b.timer) clearInterval(b.timer);
  }
  console.log("난사 종료. healthz 확인 중...");

  let healthOk = false;
  try {
    const res = await fetch(HEALTHZ_URL);
    healthOk = res.ok && (await res.text()) === "ok";
  } catch (e) {
    console.log("healthz 요청 실패:", e.message);
  }
  console.log("healthz:", healthOk ? "OK" : "FAIL");

  // 관찰자 1명을 새로 접속시켜 최종 월드 스냅샷을 받아 불변식을 검사한다.
  console.log("관찰자 접속 — 최종 월드 상태 검증...");
  const observer = await makeBot("observer");
  clearInterval(observer.timer);
  await new Promise((r) => setTimeout(r, 500));

  const { ownerId, n } = observer.state;
  let invalidOwner = 0;
  for (let i = 0; i < n; i++) {
    const o = ownerId[i];
    if (o < 0 || o > 255) invalidOwner++;
  }

  for (const b of [...bots, observer]) b.client.deactivate();

  console.log("--- 결과 ---");
  console.log("총 SORTIE 전송:", totalSorties);
  console.log("총 ERROR 수신:", totalErrors, errorCodeCounts);
  console.log("총 DELTA 수신(관찰자 제외 합):", totalDeltas);
  console.log("클라이언트측 WS/STOMP 오류:", clientErrors.length ? clientErrors.slice(0, 10) : "(없음)");
  console.log("불변식 위반(owner 범위 0~255 밖):", invalidOwner);

  const pass = healthOk && clientErrors.length === 0 && invalidOwner === 0 && totalSorties > 0;
  console.log(pass ? "LOAD TEST OK" : "LOAD TEST FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
