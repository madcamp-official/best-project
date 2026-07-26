// 시군구명/시도명 조회 테이블을 만들어 web/public/sgg-sido-names.json으로 저장한다.
// beopjeong-emd.geojson(법정동, EMD_CD만 있고 이름 없음)에는 시군구/시도명이 없어서
// (README.md §2.1, docs/plan.md) sggnm/sidonm이 빈 문자열이었다 — 이 파일로 채운다.
//
// admdongkor의 sgg/sido 레벨(행정동 코드 체계)에서 이름만 뽑아 쓴다. admIndex 정렬처럼
// "배열 순서"에 의존하지 않고 단순 code→name 딕셔너리라서, admdongkor 버전이 달라져도
// 안전하다(시군구/시도명은 사실상 안 바뀜) — 그래도 정적 파일로 한 번 구워서 커밋해
// 클라·서버 둘 다 런타임에 admdongkor를 호출할 필요가 없게 한다.
//
// 법정동코드(EMD_CD)와 admdongkor 행정동코드가 시군구/시도 레벨에서 항상 1:1 대응한다는
// 보장은 없어(세종시 등 예외 가능) — 매칭 안 되는 코드는 generate.mjs/loadDong.ts에서
// 빈 문자열로 그대로 두고 경고만 낸다.

import * as adk from "admdongkor";
import { writeFileSync } from "node:fs";

// beopjeong-emd.geojson 원본(gisdeveloper 20230729)과 같은 시기 스냅샷을 쓴다 — "latest"(2026)는
// 그 사이 있었던 행정구역 개편(예: 전북특별자치도 출범, 광주·전남 통합 등)이 반영돼 있어
// 시군구/시도 코드 체계가 달라서 매칭이 안 되는 코드가 대량 발생한다(실측: sido 3개/sgg 47개 누락).
const NAME_SNAPSHOT_VERSION = "20230701";
console.log(`admdongkor 버전: ${NAME_SNAPSHOT_VERSION} (법정동 원본과 같은 시기 스냅샷 — 코드 체계 맞춤)`);

const [sggFc, sidoFc] = await Promise.all([
  adk.get(NAME_SNAPSHOT_VERSION, "sgg"),
  adk.get(NAME_SNAPSHOT_VERSION, "sido"),
]);

const sggNames = {};
for (const f of sggFc.features) {
  const { sggcd, sggnm } = f.properties;
  if (sggcd) sggNames[sggcd] = sggnm;
}

const sidoNames = {};
for (const f of sidoFc.features) {
  const { sidocd, sidonm } = f.properties;
  if (sidocd) sidoNames[sidocd] = sidonm;
}

console.log(`시군구 ${Object.keys(sggNames).length}개, 시도 ${Object.keys(sidoNames).length}개`);

const outPath = new URL("../../../web/public/sgg-sido-names.json", import.meta.url);
writeFileSync(outPath, JSON.stringify({ sggNames, sidoNames }));
console.log(`저장 완료: ${outPath.pathname}`);
