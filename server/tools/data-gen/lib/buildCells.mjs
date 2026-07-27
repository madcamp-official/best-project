// generate.mjs/generate-sgg.mjs/generate-world.mjs가 공유하는 공통 파이프라인:
// (경계 폴리곤 배열 + admIndex 순서로 이미 배정된 meta 배열) → topojson 위상으로
// 인접 그래프 + border(지도 바깥에 닿는 셀) 마스크를 뽑아 최종 cells 배열을 만든다.
// 셀 하나가 법정동이든 시군구든 국가든 이 단계는 지리 위상 계산이라 완전히 동일하다.

import { topology } from "topojson-server";
import { neighbors } from "topojson-client";
import polylabel from "polylabel";

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

export function computeLabelPoint(geometry) {
  if (geometry.type === "Polygon") {
    return polylabel(geometry.coordinates, 1e-4);
  }
  let best = geometry.coordinates[0];
  let bestArea = -Infinity;
  for (const polygon of geometry.coordinates) {
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return polylabel(best, 1e-4);
}

// 아크(공유 경계선)를 정확히 1개 셀만 쓰면 그 아크는 지도 바깥(바다·지도 경계)에 닿는 외곽선
// → 그 셀은 "경계 셀"(포위 귀속 판정의 탈출구, GameCore.tickAnnex 참조).
function computeBorderMask(topo, geomCollection, n) {
  const arcCount = topo.arcs.length;
  const arcUsers = Array.from({ length: arcCount }, () => []);

  for (const g of geomCollection.geometries) {
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

/**
 * metaList[i]는 geometries[i]에 대응하는 정적 속성(admIndex/code/name/sggcd/sggnm/sidocd/sidonm/centroid).
 * 반환: neighbors(인접 admIndex 목록)·border(0/1)가 채워진 최종 cells 배열.
 */
export function buildCells(metaList, geometries) {
  const preparedFeatures = metaList.map((m, i) => ({
    type: "Feature",
    properties: { admIndex: i },
    geometry: geometries[i],
  }));
  const inputFc = { type: "FeatureCollection", features: preparedFeatures };

  const topo = topology({ cells: inputFc }, 1e5);
  const geomCollection = topo.objects.cells;
  const neighborIndex = neighbors(geomCollection.geometries);
  const border = computeBorderMask(topo, geomCollection, metaList.length);

  return metaList.map((m, i) => ({ ...m, neighbors: neighborIndex[i] ?? [], border: border[i] }));
}
