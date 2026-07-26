// 전국 행정동 경계 데이터를 admIndex 기반 meta + 인접그래프 JSON으로 추출해
// 서버 리소스(server/src/main/resources/data/nationwide-dong.json)로 저장한다.
//
// 로직은 web/src/data/loadSeoulDong.ts, web/src/data/labelPoint.ts 와 동일하게 맞춘다
// (인접 그래프는 topojson 위상 기반, 라벨 지점은 polylabel) — 단, 시도 필터를 걷어내
// 전국(README §2.3)을 대상으로 한다. plan.md Day 1 "S: 전국 경계 데이터 서버 로드" 대응.

import * as adk from "admdongkor";
import { topology } from "topojson-server";
import { neighbors } from "topojson-client";
import polylabel from "polylabel";
import { writeFileSync } from "node:fs";

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
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
  console.log("admdongkor 버전 목록 조회 중...");
  const versions = adk.versions();
  const latest = versions[versions.length - 1];
  console.log(`사용 버전: ${latest}`);

  console.log("전국 emd(읍면동) GeoJSON 다운로드 중... (수십 MB, 시간이 걸릴 수 있음)");
  const fc = await adk.get(latest, "emd");
  console.log(`원본 feature 수: ${fc.features.length}`);

  // README §2.3 — 전국 전체(~3,500동). emd8 없는 feature 제외(비정상 데이터).
  const filtered = fc.features.filter((f) => f.properties.emd8);
  console.log(`필터 후(emd8 존재): ${filtered.length}`);

  const meta = [];
  const preparedFeatures = [];

  filtered.forEach((f, admIndex) => {
    const centroid = computeLabelPoint(f);
    meta.push({
      admIndex,
      code: f.properties.emd8,
      name: f.properties.emdnm,
      sggcd: f.properties.sggcd ?? "",
      sggnm: f.properties.sggnm ?? "",
      sidocd: f.properties.sidocd ?? "",
      sidonm: f.properties.sidonm,
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

  const n = meta.length;
  const cells = meta.map((m, i) => ({ ...m, neighbors: neighborIndex[i] ?? [] }));

  const isolated = cells.filter((c) => c.neighbors.length === 0);
  console.log(`인접 차수 0(섬/월경지 후보): ${isolated.length}개`);
  if (isolated.length > 0) {
    console.log(isolated.slice(0, 20).map((c) => `  - ${c.sidonm} ${c.name}`).join("\n"));
    if (isolated.length > 20) console.log(`  ... 외 ${isolated.length - 20}개`);
  }

  const out = { n, generatedAt: new Date().toISOString(), sourceVersion: latest, cells };
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
