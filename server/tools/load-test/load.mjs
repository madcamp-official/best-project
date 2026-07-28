// 부하 테스트: 실제 클라이언트와 같은 로비 흐름(생성→입장→준비→시작)으로 방 N개 × 클라 M명을 띄우고,
// DELTA/리더보드 수신 대역폭·지연(serverTimeMs 대비)·서버 틱 소요시간(/admin/metrics)을 측정한다.
//
// 사용:  node load.mjs [--url ws://localhost:8080/ws/websocket] [--rooms 4] [--clients 8]
//                      [--duration 60] [--action-interval 3]
//   --action-interval N  각 클라가 N초마다 무작위 국경 출정(/app/sortie)을 보낸다. 0=관전만.
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const WS_URL = arg("url", "ws://localhost:8080/ws/websocket");
const ROOMS = Number(arg("rooms", 4));
const CLIENTS = Number(arg("clients", 8)); // 방당(호스트 포함). 서버 상한 8
const DURATION_SEC = Number(arg("duration", 60));
const ACTION_SEC = Number(arg("action-interval", 3));
const HTTP_BASE = WS_URL.replace(/^ws/, "http").replace(/\/ws\/websocket$/, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

// ── 측정치(전 클라 합산) ─────────────────────────────────────────────
const stats = {
  welcomeBytes: [],
  world: { count: 0, bytes: 0, maxBytes: 0, latencies: [] },
  leaderboard: { count: 0, bytes: 0, maxBytes: 0 },
  errors: 0,
  roundEnds: 0,
  actionsSent: 0,
};
let measuring = false;

const msgBytes = (m) => (m.binaryBody ? m.binaryBody.length : Buffer.byteLength(m.body ?? "", "utf8"));

// ── 가짜 클라이언트 ──────────────────────────────────────────────────
// 반환: { client, joined:Promise<roomId>, welcomed:Promise<void>, act() }
function spawnClient({ nickname, clientId, create, roomName, roomIdPromise }) {
  const client = new Client({
    webSocketFactory: () => new WebSocket(WS_URL),
    reconnectDelay: 0,
    debug: () => {},
  });
  let resolveJoined, resolveWelcomed;
  const joined = new Promise((r) => (resolveJoined = r));
  const welcomed = new Promise((r) => (resolveWelcomed = r));
  // 출정 대상 계산용 로컬 월드 뷰(소유주만 추적)
  const view = { holderId: -1, owner: null, neighbors: null };

  client.onConnect = () => {
    client.subscribe("/user/queue/roomJoined", (m) => {
      const r = JSON.parse(m.body);
      resolveJoined(r.roomId);
    });
    client.subscribe("/user/queue/error", () => {
      if (measuring) stats.errors++;
    });
    client.subscribe("/user/queue/welcome", (m) => {
      const w = JSON.parse(m.body);
      if (measuring || stats.welcomeBytes.length < ROOMS * CLIENTS) stats.welcomeBytes.push(msgBytes(m));
      view.holderId = w.holderId;
      view.owner = Int32Array.from(w.ownerId);
      view.neighbors = w.neighborIndex;
      client.subscribe(`/topic/room/${w.roomId}/world`, (dm) => {
        if (!measuring) return;
        const bytes = msgBytes(dm);
        stats.world.count++;
        stats.world.bytes += bytes;
        if (bytes > stats.world.maxBytes) stats.world.maxBytes = bytes;
        const d = JSON.parse(dm.body);
        stats.world.latencies.push(Date.now() - d.serverTimeMs);
        for (const c of d.cells) view.owner[c[0]] = c[1]; // [admIndex, ownerId, troops]
      });
      client.subscribe(`/topic/room/${w.roomId}/leaderboard`, (lm) => {
        if (!measuring) return;
        const bytes = msgBytes(lm);
        stats.leaderboard.count++;
        stats.leaderboard.bytes += bytes;
        if (bytes > stats.leaderboard.maxBytes) stats.leaderboard.maxBytes = bytes;
      });
      client.subscribe(`/topic/room/${w.roomId}/state`, (sm) => {
        const s = JSON.parse(sm.body);
        if (s.reason && measuring) stats.roundEnds++; // RoundEndMessage
      });
      resolveWelcomed();
    });

    if (create) {
      client.publish({
        destination: "/app/lobby/create",
        body: JSON.stringify({ name: roomName, nickname, clientId }),
      });
    } else {
      roomIdPromise.then((roomId) => {
        client.publish({
          destination: "/app/lobby/join",
          body: JSON.stringify({ roomId, nickname, clientId }),
        });
      });
    }
  };
  client.activate();

  return {
    client,
    joined,
    welcomed,
    // 무작위 국경 출정 1회: 내 소유이면서 비소유 이웃이 있는 동 하나를 골라 그 이웃으로 출정
    act() {
      if (!view.owner) return;
      const candidates = [];
      for (let i = 0; i < view.owner.length; i++) {
        if (view.owner[i] !== view.holderId) continue;
        for (const nb of view.neighbors[i]) {
          if (view.owner[nb] !== view.holderId) {
            candidates.push([i, nb]);
            break;
          }
        }
      }
      if (!candidates.length) return; // 전멸했거나 완전 고립
      const [from, to] = candidates[(Math.random() * candidates.length) | 0];
      client.publish({ destination: "/app/sortie", body: JSON.stringify({ from, to }) });
      stats.actionsSent++;
    },
  };
}

// ── 방 1개 구성: 호스트 생성 → 멤버 입장·준비 → 호스트가 시작 ─────────
async function setupRoom(r) {
  const all = [];
  const host = spawnClient({
    nickname: `부하${r}호스트`,
    clientId: `load-${r}-host`,
    create: true,
    roomName: `부하테스트${r}`,
  });
  all.push(host);
  const roomIdPromise = host.joined;
  const roomId = await roomIdPromise;

  for (let c = 1; c < CLIENTS; c++) {
    const member = spawnClient({
      nickname: `부하${r}-${c}`,
      clientId: `load-${r}-${c}`,
      create: false,
      roomIdPromise,
    });
    all.push(member);
    await member.joined;
    member.client.publish({ destination: "/app/room/ready", body: JSON.stringify({ ready: true }) });
    await sleep(30);
  }
  await sleep(300); // ready 반영 여유
  host.client.publish({ destination: "/app/room/start", body: "{}" });
  await Promise.all(all.map((c) => c.welcomed));
  return all;
}

async function scrapeMetrics(label) {
  try {
    const res = await fetch(`${HTTP_BASE}/admin/metrics`);
    if (!res.ok) return null;
    const m = await res.json();
    console.log(`[서버 metrics ${label}]`, JSON.stringify(m));
    return m;
  } catch {
    return null; // 엔드포인트 없는 구버전 서버여도 클라 측정은 계속
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────
console.log(`대상 ${WS_URL} — 방 ${ROOMS}개 × 클라 ${CLIENTS}명, ${DURATION_SEC}초 측정, 출정 주기 ${ACTION_SEC}초`);
const t0 = Date.now();
const rooms = [];
for (let r = 0; r < ROOMS; r++) rooms.push(await setupRoom(r));
const clients = rooms.flat();
console.log(`셋업 완료(${((Date.now() - t0) / 1000).toFixed(1)}초): 클라 ${clients.length}명 게임 중. 측정 시작`);

await scrapeMetrics("측정 전 리셋"); // 읽으면 리셋되므로 측정 구간 직전에 한 번 비운다
measuring = true;
const actionTimer = ACTION_SEC > 0
  ? setInterval(() => { for (const c of clients) c.act(); }, ACTION_SEC * 1000)
  : null;
await sleep(DURATION_SEC * 1000);
measuring = false;
if (actionTimer) clearInterval(actionTimer);
const serverMetrics = await scrapeMetrics("측정 구간");

// ── 결과 ─────────────────────────────────────────────────────────────
const lat = stats.world.latencies.sort((a, b) => a - b);
const perClientKBps = stats.world.bytes / DURATION_SEC / clients.length / 1024;
const totalKBps = (stats.world.bytes + stats.leaderboard.bytes) / DURATION_SEC / 1024;
const summary = {
  clients: clients.length,
  rooms: ROOMS,
  durationSec: DURATION_SEC,
  welcome: {
    avgKB: +(stats.welcomeBytes.reduce((a, b) => a + b, 0) / Math.max(1, stats.welcomeBytes.length) / 1024).toFixed(1),
  },
  world: {
    msgs: stats.world.count,
    msgsPerClientPerSec: +(stats.world.count / DURATION_SEC / clients.length).toFixed(2),
    avgBytes: Math.round(stats.world.bytes / Math.max(1, stats.world.count)),
    maxBytes: stats.world.maxBytes,
    perClientKBps: +perClientKBps.toFixed(2),
    latencyMs: {
      p50: quantile(lat, 0.5),
      p95: quantile(lat, 0.95),
      p99: quantile(lat, 0.99),
      max: lat[lat.length - 1] ?? 0,
    },
  },
  leaderboard: {
    msgs: stats.leaderboard.count,
    avgBytes: Math.round(stats.leaderboard.bytes / Math.max(1, stats.leaderboard.count)),
    maxBytes: stats.leaderboard.maxBytes,
  },
  serverEgressApproxKBps: +totalKBps.toFixed(1),
  actionsSent: stats.actionsSent,
  errors: stats.errors,
  roundEnds: stats.roundEnds,
  serverMetrics,
};
console.log("\n===== 부하 테스트 결과 =====");
console.log(JSON.stringify(summary, null, 2));

for (const c of clients) c.client.deactivate();
setTimeout(() => process.exit(0), 1500);
