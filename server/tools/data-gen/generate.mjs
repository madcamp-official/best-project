// 전국 법정동 경계 데이터를 admIndex 기반 meta + 인접그래프 JSON으로 추출해
// 서버 리소스(server/src/main/resources/data/nationwide-dong.json)로 저장한다.
//
// ── 정합성 핵심 ──────────────────────────────────────────────────────
// 클라이언트(web/src/data/loadDong.ts)와 "같은 법정동 GeoJSON 파일"을
// "같은 필터(EMD_CD 존재)·같은 순서(파일 배열 순서)"로 읽어 admIndex를 부여한다.
// → 클라·서버 admIndex가 정확히 일치한다. (클릭 시 클라가 보내는 admIndex와
//    서버 DELTA의 admIndex가 반드시 같은 동을 가리켜야 하므로 이 정합성이 필수.)
// centroid(polylabel)·인접그래프(topojson 위상 1e5)도 클라 labelPoint.ts/loadDong.ts와
// 동일 로직·동일 입력이라 값이 일치한다.
//
// 소스: web/public/beopjeong-emd.geojson
//   (gisdeveloper 읍면동(법정동) SHP → mapshaper로 WGS84 GeoJSON 변환한 정적 자산)
//   속성: EMD_CD(8자리 법정동코드=[시도2][시군구3][읍면동3]), EMD_KOR_NM, EMD_ENG_NM.

import { topology } from "topojson-server";
import { neighbors } from "topojson-client";
import polylabel from "polylabel";
import { readFileSync, writeFileSync } from "node:fs";

// 클라와 공유하는 정본 법정동 경계 파일 (web/public). 이 한 파일이 클라 렌더 geometry와
// 서버 meta/neighbors의 공통 소스다 — 둘의 admIndex 정합성이 여기서 보장된다.
const GEOJSON_PATH = new URL("../../../web/public/beopjeong-emd.geojson", import.meta.url);
// 시군구/시도명 조회 테이블(generate-sgg-names.mjs 산출물) — beopjeong-emd.geojson엔
// EMD_CD(코드)만 있고 이름이 없어 이걸로 채운다. 클라(loadDong.ts)도 같은 파일을 쓴다.
const NAMES_PATH = new URL("../../../web/public/sgg-sido-names.json", import.meta.url);

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

// web/src/data/loadDong.ts의 borderMask와 동일 로직: 아크(공유 경계선)를 정확히 1개 동만
// 쓰면 그 아크는 지도 바깥(바다·국경)에 닿는 외곽선 → 그 동은 "경계 동". 포위 귀속(§tickAnnex)
// 판정에서 P가 완전히 둘러쌌는지 확인할 때 "바깥으로 새는 구멍이 없는지"의 기준이 된다.
function computeBorderMask(topo, geomCollection, n) {
  const arcCount = topo.arcs.length;
  const arcUsers = Array.from({ length: arcCount }, () => []);

  const geometries = geomCollection.geometries;
  for (const g of geometries) {
    const admIndex = g.properties.admIndex;
    const seen = new Set();
    const visit = (node) => {
      if (typeof node[0] === "number") {
        for (const raw of node) {
          const idx = raw < 0 ? ~raw : raw;
          if (!seen.has(idx)) {
            seen.add(idx);
            arcUsers[idx].push(admIndex);
          }
        }
      } else {
        for (const child of node) visit(child);
      }
    };
    if (g.arcs) visit(g.arcs);
  }

  const border = new Array(n).fill(false);
  for (const users of arcUsers) {
    if (users.length === 1) border[users[0]] = true;
  }
  return border;
}

function computeLabelPoint(feature) {
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    return polylabel(geom.coordinates, 1e-4);
  }
  let best = geom.coordinates[0];
  let bestArea = -Infinity;
  for (const polygon of geom.coordinates) {
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return polylabel(best, 1e-4);
}

async function main() {
  console.log(`법정동 경계 GeoJSON 로드: ${GEOJSON_PATH.pathname}`);
  const fc = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  console.log(`원본 feature 수: ${fc.features.length}`);

  const { sggNames, sidoNames } = JSON.parse(readFileSync(NAMES_PATH, "utf8"));

  // 클라 loadDong과 동일한 필터: EMD_CD 존재. (전국 대상 — 시도 필터 없음)
  const filtered = fc.features.filter((f) => f.properties?.EMD_CD);
  console.log(`필터 후(EMD_CD 존재): ${filtered.length}`);

  const meta = [];
  const preparedFeatures = [];

  filtered.forEach((f, admIndex) => {
    const code = f.properties.EMD_CD; // 법정동코드 8자리
    const centroid = computeLabelPoint(f);
    meta.push({
      admIndex,
      code,
      name: f.properties.EMD_KOR_NM,
      sggcd: code.slice(0, 5), // [시도2][시군구3] — 시장 계급 판정용
      sggnm: sggNames[code.slice(0, 5)] ?? "",
      sidocd: code.slice(0, 2),
      sidonm: sidoNames[code.slice(0, 2)] ?? "",
      centroid,
    });
    preparedFeatures.push({
      type: "Feature",
      properties: { admIndex },
      geometry: f.geometry,
    });
  });

  console.log("TopoJSON 위상 계산 중 (인접 그래프 추출용)...");
  const inputFc = { type: "FeatureCollection", features: preparedFeatures };
  const topo = topology({ dong: inputFc }, 1e5);
  const geomCollection = topo.objects.dong;
  const neighborIndex = neighbors(geomCollection.geometries);
  const border = computeBorderMask(topo, geomCollection, meta.length);

  const n = meta.length;
  const cells = meta.map((m, i) => ({ ...m, neighbors: neighborIndex[i] ?? [], border: border[i] }));

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
    n,
    generatedAt: new Date().toISOString(),
    sourceVersion: "beopjeong-emd (gisdeveloper 20230729 UMD/법정동)",
    cells,
  };
  const outPath = new URL(
    "../../src/main/resources/data/nationwide-dong.json",
    import.meta.url
  );
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname} (동 ${n}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
