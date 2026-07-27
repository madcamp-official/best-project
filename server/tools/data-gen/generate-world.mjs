// 세계 국가(177개) 경계 데이터를 admIndex 기반 meta + 인접그래프 JSON으로 추출해
// 서버 리소스(server/src/main/resources/data/world-cells.json)로 저장한다.
// "세계지도" 지도(feat/world-expansion) — 국가 단위, 전 지구 위경도 범위를 쓴다.
//
// 클라(web/src/data/loadMapData.ts)와 "같은 web/public/world-countries.geojson 파일"을
// "같은 필터·같은 순서"로 읽어 admIndex를 부여한다 — generate.mjs/generate-sgg.mjs와 동일한
// 정합성 원칙.
//
// 소스: web/public/world-countries.geojson (fetch-world-geojson.mjs가 world-atlas +
// world-countries에서 1회 추출한 정적 자산). code=국가 3자리 코드, name=한국어 국가명,
// region=대륙(Africa/Americas/Asia/Europe/Oceania/Antarctic 등).
//
// sggcd/sidocd 의미 재해석(kr-sgg와 같은 설계): 이 지도의 최소 단위 자체가 국가이므로
// sggcd=자기 자신 코드로 채운다 — "sggcd 그룹 전체 장악=계급 승급" 판정이 셀 하나만 가져도
// 참이 되어 최하위 계급이 자연히 생략된다. sidocd=대륙 코드로 채워 "대륙 하나 통째로 장악"이
// 그 다음 계급(도지사 상당) 판정으로 재사용된다 — GameCore.computeRank 코드 변경 없음.

import { readFileSync, writeFileSync } from "node:fs";
import { buildCells, computeLabelPoint } from "./lib/buildCells.mjs";

const GEOJSON_PATH = new URL("../../../web/public/world-countries.geojson", import.meta.url);

async function main() {
  console.log(`세계 국가 경계 GeoJSON 로드: ${GEOJSON_PATH.pathname}`);
  const fc = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  console.log(`원본 feature 수: ${fc.features.length}`);

  const filtered = fc.features.filter((f) => f.properties?.code);
  console.log(`필터 후(code 존재): ${filtered.length}`);

  const metaList = filtered.map((f, admIndex) => ({
    admIndex,
    code: f.properties.code,
    name: f.properties.name,
    sggcd: f.properties.code, // 이 지도의 최소 단위 자체 = 국가
    sggnm: f.properties.name,
    sidocd: f.properties.region, // 대륙(영문 키) — "도" 상당의 상위 그룹
    sidonm: f.properties.regionKo,
    centroid: computeLabelPoint(f.geometry),
  }));
  const geometries = filtered.map((f) => f.geometry);

  console.log("TopoJSON 위상 계산 중 (인접 그래프 추출용)...");
  const cells = buildCells(metaList, geometries);

  const isolated = cells.filter((c) => c.neighbors.length === 0);
  console.log(`인접 차수 0(섬나라·대륙 간 국경 없음 후보): ${isolated.length}개`);
  if (isolated.length > 0) {
    console.log(isolated.map((c) => `  - ${c.name}`).join("\n"));
  }

  const out = {
    n: cells.length,
    generatedAt: new Date().toISOString(),
    sourceVersion: "world-atlas countries-110m + world-countries(ccn3 join)",
    cells,
  };
  const outPath = new URL("../../src/main/resources/data/world-cells.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname} (국가 ${cells.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
