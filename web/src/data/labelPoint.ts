import polylabel from "polylabel";
import type { Feature, Polygon, MultiPolygon } from "geojson";

// README.md §3.3 — centroid(기하 중심)이 아니라 polylabel(도달 극점)로 계산.
// 오목한 모양이거나 MultiPolygon(섬 등)일 때 도형 밖으로 라벨이 튀는 것을 방지.
export function computeLabelPoint(
  feature: Feature<Polygon | MultiPolygon>
): [number, number] {
  const geom = feature.geometry;

  if (geom.type === "Polygon") {
    // GeoJSON Position[][] → polylabel 타입([number,number][][]) 캐스트.
    return polylabel(geom.coordinates as [number, number][][], 1e-4) as [number, number];
  }

  // MultiPolygon: 가장 면적이 큰 파트에서 라벨 지점을 계산한다.
  let best = geom.coordinates[0];
  let bestArea = -Infinity;
  for (const polygon of geom.coordinates) {
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return polylabel(best as [number, number][][], 1e-4) as [number, number];
}

// 부호 없는 슈레이스 공식 근사치 (파트 비교용이므로 정밀도는 불필요).
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}
