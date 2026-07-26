// 클라(web/src/data/loadDong.ts)와 서버(nationwide-dong.json) 사이에 admIndex 정렬이
// 실제로 일치하는지 검증한다. 둘 다 같은 PINNED_VERSION + 같은 필터/순회 순서를 쓰므로
// code(emd8) 시퀀스가 동일해야 한다. 다르면 두 파일의 버전 상수가 어긋난 것 — 맞추고 재생성.
import * as adk from "../../../web/node_modules/admdongkor/dist/index.js";
import { readFileSync } from "node:fs";

const PINNED_VERSION = "20260701"; // web/src/data/loadDong.ts ADMDONGKOR_VERSION과 동일해야 함
console.log("pinned version:", PINNED_VERSION);

const fc = await adk.get(PINNED_VERSION, "emd");
const clientCodes = fc.features.filter((f) => f.properties.emd8).map((f) => f.properties.emd8);

const server = JSON.parse(readFileSync(new URL("../../src/main/resources/data/nationwide-dong.json", import.meta.url)));
console.log("server sourceVersion:", server.sourceVersion, "n:", server.n);
const serverCodes = server.cells.map((c) => c.code);

console.log("client n:", clientCodes.length, "server n:", serverCodes.length);

let mismatches = 0;
for (let i = 0; i < Math.min(clientCodes.length, serverCodes.length); i++) {
  if (clientCodes[i] !== serverCodes[i]) {
    mismatches++;
    if (mismatches <= 5) console.log(`mismatch at ${i}: client=${clientCodes[i]} server=${serverCodes[i]}`);
  }
}
console.log(mismatches === 0 && clientCodes.length === serverCodes.length ? "MATCH: admIndex sequences identical" : `MISMATCH: ${mismatches} differences`);
