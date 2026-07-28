// 전국 법정동 경계 데이터를 admIndex 기반 meta + 인접그래프 JSON으로 추출해
// 서버 리소스(server/src/main/resources/data/nationwide-dong.json)로 저장한다.
//
// ── 정합성 핵심 ──────────────────────────────────────────────────────
// 클라이언트(web/src/data/loadMapData.ts)와 "같은 법정동 GeoJSON 파일"을
// "같은 필터(EMD_CD 존재)·같은 순서(파일 배열 순서)"로 읽어 admIndex를 부여한다.
// → 클라·서버 admIndex가 정확히 일치한다. (클릭 시 클라가 보내는 admIndex와
//    서버 DELTA의 admIndex가 반드시 같은 동을 가리켜야 하므로 이 정합성이 필수.)
// centroid(polylabel)·인접그래프(topojson 위상 1e5)도 클라 labelPoint.ts/loadMapData.ts와
// 동일 로직·동일 입력이라 값이 일치한다(공통 파이프라인은 lib/buildCells.mjs).
//
// 소스: web/public/beopjeong-emd.geojson
//   (gisdeveloper 읍면동(법정동) SHP → mapshaper로 WGS84 GeoJSON 변환한 정적 자산)
//   속성: EMD_CD(8자리 법정동코드=[시도2][시군구3][읍면동3]), EMD_KOR_NM, EMD_ENG_NM.

import { readFileSync, writeFileSync } from "node:fs";
import { buildCells, computeLabelPoint } from "./lib/buildCells.mjs";

// 클라와 공유하는 정본 법정동 경계 파일 (web/public). 이 한 파일이 클라 렌더 geometry와
// 서버 meta/neighbors의 공통 소스다 — 둘의 admIndex 정합성이 여기서 보장된다.
const GEOJSON_PATH = new URL("../../../web/public/beopjeong-emd.geojson", import.meta.url);
// 시군구/시도명 조회 테이블(generate-sgg-names.mjs 산출물) — beopjeong-emd.geojson엔
// EMD_CD(코드)만 있고 이름이 없어 이걸로 채운다. 클라(loadMapData.ts)도 같은 파일을 쓴다.
const NAMES_PATH = new URL("../../../web/public/sgg-sido-names.json", import.meta.url);

async function main() {
  console.log(`법정동 경계 GeoJSON 로드: ${GEOJSON_PATH.pathname}`);
  const fc = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  console.log(`원본 feature 수: ${fc.features.length}`);

  const { sggNames, sidoNames } = JSON.parse(readFileSync(NAMES_PATH, "utf8"));

  // 클라 loadMapData와 동일한 필터: EMD_CD 존재. (전국 대상 — 시도 필터 없음)
  const filtered = fc.features.filter((f) => f.properties?.EMD_CD);
  console.log(`필터 후(EMD_CD 존재): ${filtered.length}`);

  const metaList = filtered.map((f, admIndex) => {
    const code = f.properties.EMD_CD; // 법정동코드 8자리
    return {
      admIndex,
      code,
      name: f.properties.EMD_KOR_NM,
      sggcd: code.slice(0, 5), // [시도2][시군구3] — 시장 계급 판정용
      sggnm: sggNames[code.slice(0, 5)] ?? "",
      sidocd: code.slice(0, 2),
      sidonm: sidoNames[code.slice(0, 2)] ?? "",
      centroid: computeLabelPoint(f.geometry),
    };
  });
  const geometries = filtered.map((f) => f.geometry);

  console.log("TopoJSON 위상 계산 중 (인접 그래프 추출용)...");
  const cells = buildCells(metaList, geometries);

  const missingNames = cells.filter((c) => !c.sggnm || !c.sidonm);
  if (missingNames.length > 0) {
    console.warn(`시군구/시도명 조회 실패 ${missingNames.length}개 — sgg-sido-names.json을 재생성해야 할 수 있음`);
    console.warn(missingNames.slice(0, 10).map((c) => `  - ${c.name}(${c.code})`).join("\n"));
  }

  const isolated = cells.filter((c) => c.neighbors.length === 0);
  console.log(`인접 차수 0(섬/월경지 후보): ${isolated.length}개`);
  if (isolated.length > 0) {
    console.log(isolated.slice(0, 20).map((c) => `  - ${c.name}`).join("\n"));
    if (isolated.length > 20) console.log(`  ... 외 ${isolated.length - 20}개`);
  }

  const out = {
    n: cells.length,
    generatedAt: new Date().toISOString(),
    sourceVersion: "beopjeong-emd (gisdeveloper 20230729 UMD/법정동)",
    cells,
  };
  const outPath = new URL(
    "../../src/main/resources/data/nationwide-dong.json",
    import.meta.url
  );
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname} (동 ${cells.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
