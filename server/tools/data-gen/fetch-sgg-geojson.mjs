// 1회성 준비 스크립트: admdongkor의 시군구(sgg) 경계를 web/public/kr-sgg.geojson으로 저장한다.
// beopjeong-emd.geojson과 같은 역할 — 클라(loadMapData)와 서버(generate-sgg.mjs)가 이 "같은 파일"을
// "같은 필터·같은 배열 순서"로 읽어야 admIndex가 일치한다(README §2.1 원칙과 동일).
//
// admdongkor의 sgg level은 sggcd/sggnm/sidocd/sidonm이 이미 다 채워져 있어 별도 이름 조회
// 테이블(sgg-sido-names.json 같은)이 필요 없다.

import * as adk from "admdongkor";
import { writeFileSync } from "node:fs";

// generate-sgg-names.mjs와 같은 스냅샷 시점을 쓴다(법정동 원본과 시기 일치 — 코드 체계 정합용 관례 유지).
const VERSION = "20230701";

async function main() {
  console.log(`admdongkor sgg 경계 로드 (${VERSION})...`);
  const fc = await adk.get(VERSION, "sgg");
  console.log(`시군구 ${fc.features.length}개`);

  const outPath = new URL("../../../web/public/kr-sgg.geojson", import.meta.url);
  writeFileSync(outPath, JSON.stringify(fc));
  console.log(`저장 완료: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
