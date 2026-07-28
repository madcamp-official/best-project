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

// 셀의 대략적인 "반지름"(경위도 도 단위) — bounding box 대각선의 절반, 경도는 centroid
// 위도의 cosLat로 보정(위도가 높을수록 같은 경도차가 실제로는 더 좁은 거리라서). 법정동처럼
// 작은 셀에서는 거의 0에 가깝지만, 시군구·특히 세계지도 국가/주(러시아 등)처럼 셀 자체가
// 광범위하면 무시할 수 없는 크기 — 미사일/전술핵 명중 판정(MissileController.withinRadius 등)이
// "클릭 지점↔centroid" 거리만으로 검증하면 큰 셀 가장자리를 클릭했을 때 폴리곤은 맞았는데도
// centroid가 멀어 거부되는 문제가 생긴다. 그 보정값으로 쓴다(World.radiusDeg).
function computeRadiusDeg(geometry, centroid) {
  const cosLat = Math.cos((centroid[1] * Math.PI) / 180) || 1;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const visitRing = (ring) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polygons) for (const ring of poly) visitRing(ring);
  let lngSpan = maxLng - minLng;
  // 날짜변경선(±180°)을 걸치는 지역(피지·알래스카 등)은 minLng≈-180, maxLng≈180이 돼
  // 실제 폭이 아니라 지구를 한 바퀴 두른 값(~360°)으로 잘못 계산된다 — 반대쪽(짧은 호)이
  // 진짜 폭이므로 그쪽을 취한다.
  if (lngSpan > 180) lngSpan = 360 - lngSpan;
  const dx = lngSpan * cosLat;
  const dy = maxLat - minLat;
  return Math.sqrt(dx * dx + dy * dy) / 2;
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

  return metaList.map((m, i) => ({
    ...m,
    neighbors: neighborIndex[i] ?? [],
    border: border[i],
    radiusDeg: computeRadiusDeg(geometries[i], m.centroid),
  }));
}
