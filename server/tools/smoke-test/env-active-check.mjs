// 회귀 테스트: E(야만인)가 스폰 직후 영구히 얼어붙지 않는지 확인.
//
// 과거 버그: ENV_CLUSTER_COUNT*ENV_START_CELLS(=9)개로 스폰하는데 ENV_MIN_PRESENCE(당시 4)가
// 더 작아서, never-surpass 상한(max(ENV_MIN_PRESENCE, 최대 플레이어 점유 동 수))에 스폰
// 직후부터 걸려 EnvAi.maybeAct의 "envCells >= cap" 체크가 항상 참이 되고, E가 첫 행동도
// 못 해보고 영구히 방치되는 상태가 됐다("야만인이 가만히 있다").
//
// 라이브 타이밍에 기대는 대신(E는 기본 설정에서도 몇 초 안에 상한까지 다 커버려서 접속
// 시점에 이미 굳어있는 경우가 흔해 레이스가 됨) 근본 불변식을 직접 검증한다:
// ENV_MIN_PRESENCE >= ENV_CLUSTER_COUNT * ENV_START_CELLS 여야
// 스폰 직후 최소 한 번은 확장 여지가 있다.

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const client = new Client({
  webSocketFactory: () => new WebSocket("ws://localhost:8080/ws/websocket"),
  reconnectDelay: 0,
  debug: () => {},
});

const w = await new Promise((resolve) => {
  client.onConnect = () => {
    client.subscribe("/user/queue/welcome", (msg) => resolve(JSON.parse(msg.body)));
    client.publish({ destination: "/app/join", body: JSON.stringify({ nickname: "불변식확인" }) });
  };
  client.activate();
});
client.deactivate();

const { ENV_CLUSTER_COUNT, ENV_START_CELLS, ENV_MIN_PRESENCE } = w.config;
const spawnTotal = ENV_CLUSTER_COUNT * ENV_START_CELLS;
const envNow = w.ownerId.filter((o) => o === 255).length;

console.log(`ENV_CLUSTER_COUNT=${ENV_CLUSTER_COUNT} * ENV_START_CELLS=${ENV_START_CELLS} = 스폰 시 최대 ${spawnTotal}개`);
console.log(`ENV_MIN_PRESENCE=${ENV_MIN_PRESENCE}`);
console.log(`현재 E 보유 동: ${envNow}`);

if (ENV_MIN_PRESENCE < spawnTotal) {
  console.error(
    `FAIL: ENV_MIN_PRESENCE(${ENV_MIN_PRESENCE}) < 스폰 총량(${spawnTotal}) — 스폰 직후부터 상한에 막혀 E가 영구히 멈출 수 있음`
  );
  process.exit(1);
}
console.log("ENV ACTIVE CHECK OK (스폰 직후 얼어붙지 않을 불변식 충족)");
