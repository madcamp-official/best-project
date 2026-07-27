// 시군구(약 250개) 경계 데이터를 admIndex 기반 meta + 인접그래프 JSON으로 추출해
// 서버 리소스(server/src/main/resources/data/kr-sgg-cells.json)로 저장한다.
// "한국지리" 지도(feat/korea-city-mode) — 법정동보다 훨씬 굵은 단위, 라운드가 짧고 빠르다.
//
// 클라(web/src/data/loadMapData.ts)와 "같은 web/public/kr-sgg.geojson 파일"을 "같은 필터·같은
// 순서"로 읽어 admIndex를 부여한다 — generate.mjs/loadDong.ts와 동일한 정합성 원칙.
//
// 소스: web/public/kr-sgg.geojson (fetch-sgg-geojson.mjs가 admdongkor에서 1회 추출한 정적 자산).
// sggcd/sggnm/sidocd/sidonm이 이미 채워져 있어 별도 이름 조회 테이블이 필요 없다.
//
// sggcd/sidocd 의미 재해석: 이 지도의 최소 단위 자체가 시군구이므로, World/GameCore의
// "sggcd 그룹 전체 장악=시장 계급" 판정 로직을 그대로 재사용하면(코드 변경 없음) 셀 하나만
// 가져도 즉시 참이 된다 — "동장" 계급이 자연히 생략되고 시장→도지사→대통령 순으로만 오른다.
// (GameCore.computeRank/StartCellAssigner 등 지도 무관 로직 재사용 원칙, 서버 리스트 참조.)

import { readFileSync, writeFileSync } from "node:fs";
import { buildCells, computeLabelPoint } from "./lib/buildCells.mjs";

const GEOJSON_PATH = new URL("../../../web/public/kr-sgg.geojson", import.meta.url);

async function main() {
  console.log(`시군구 경계 GeoJSON 로드: ${GEOJSON_PATH.pathname}`);
  const fc = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  console.log(`원본 feature 수: ${fc.features.length}`);

  const filtered = fc.features.filter((f) => f.properties?.sggcd);
  console.log(`필터 후(sggcd 존재): ${filtered.length}`);

  const metaList = filtered.map((f, admIndex) => ({
    admIndex,
    code: f.properties.sggcd,
    name: f.properties.sggnm,
    sggcd: f.properties.sggcd, // 이 지도의 최소 단위 자체 = 시군구
    sggnm: f.properties.sggnm,
    sidocd: f.properties.sidocd,
    sidonm: f.properties.sidonm,
    centroid: computeLabelPoint(f.geometry),
  }));
  const geometries = filtered.map((f) => f.geometry);

  console.log("TopoJSON 위상 계산 중 (인접 그래프 추출용)...");
  const cells = buildCells(metaList, geometries);

  const isolated = cells.filter((c) => c.neighbors.length === 0);
  console.log(`인접 차수 0(섬 후보): ${isolated.length}개`);
  if (isolated.length > 0) {
    console.log(isolated.map((c) => `  - ${c.name}`).join("\n"));
  }

  const out = {
    n: cells.length,
    generatedAt: new Date().toISOString(),
    sourceVersion: "admdongkor sgg 20230701",
    cells,
  };
  const outPath = new URL("../../src/main/resources/data/kr-sgg-cells.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname} (시군구 ${cells.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
