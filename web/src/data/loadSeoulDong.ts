import * as adk from "admdongkor";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Polygon,
} from "geojson";
import { topology } from "topojson-server";
import { feature, neighbors } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { computeLabelPoint } from "./labelPoint";
import { SCOPE_SIDOCD } from "../config";
import type { DongStaticMeta } from "../game/types";

// 아크(공유 경계선) 한 조각의 양쪽 동. b = -1 이면 지도 바깥과 맞닿은 외곽선.
export interface ArcSide {
  a: number;
  b: number;
}

export interface PreparedMap {
  n: number;
  geojson: FeatureCollection<Polygon | MultiPolygon>;
  meta: DongStaticMeta[];
  neighborIndex: number[][];
  // 국경(소유주가 다른 경계)만 그리기 위한 아크 단위 경계선 데이터.
  arcGeojson: FeatureCollection<LineString>;
  arcSides: ArcSide[];
  dongArcs: number[][]; // admIndex → 그 동에 접한 아크 인덱스 목록
}

type DongFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;

// README.md §2 데이터 절 — admdongkor light emd → 서울 스코프로 필터 →
// TopoJSON 위상으로 인접 그래프 + 아크(공유 경계선) 추출 → polylabel 라벨 지점 계산.
export async function loadSeoulDong(): Promise<PreparedMap> {
  const versions = adk.versions();
  const latest = versions[versions.length - 1];
  const fc = (await adk.get(latest, "emd")) as unknown as FeatureCollection<
    Polygon | MultiPolygon,
    {
      emd8: string | null;
      emdnm: string;
      sggcd: string | null;
      sggnm: string | null;
      sidocd: string | null;
      sidonm: string;
    }
  >;

  const filtered = fc.features.filter(
    (f) => f.properties.sidocd === SCOPE_SIDOCD && f.properties.emd8
  );

  const meta: DongStaticMeta[] = [];
  const preparedFeatures: DongFeature[] = [];

  filtered.forEach((f, admIndex) => {
    const centroid = computeLabelPoint(f as Feature<Polygon | MultiPolygon>);
    meta.push({
      admIndex,
      code: f.properties.emd8 as string,
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

  const inputFc: FeatureCollection<Polygon | MultiPolygon> = {
    type: "FeatureCollection",
    features: preparedFeatures,
  };

  // quantization: 부동소수점 미세 오차로 공유 경계가 끊기는 것을 방지 + 아크 델타 인코딩.
  const topo = topology({ dong: inputFc }, 1e5) as Topology;
  const geomCollection = topo.objects.dong as GeometryCollection;
  const neighborIndex = neighbors(geomCollection.geometries);

  // 채움 폴리곤은 topology를 되돌린 좌표로 그려, 아래 아크 경계선과 완벽히 정렬시킨다.
  const geojson = feature(
    topo,
    geomCollection
  ) as unknown as FeatureCollection<Polygon | MultiPolygon>;

  const n = meta.length;
  const { arcGeojson, arcSides, dongArcs } = extractArcs(topo, geomCollection, n);

  return { n, geojson, meta, neighborIndex, arcGeojson, arcSides, dongArcs };
}

// TopoJSON 아크는 인접한 두 폴리곤이 하나로 공유한다. 각 아크가 어떤 동들에
// 쓰이는지 집계하면 "공유 경계선" 단위의 인접 정보를 얻는다.
function extractArcs(topo: Topology, geomCollection: GeometryCollection, n: number) {
  const arcCount = topo.arcs.length;
  const arcUsers: number[][] = Array.from({ length: arcCount }, () => []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geometries = geomCollection.geometries as any[];
  for (const g of geometries) {
    const admIndex = g.properties.admIndex as number;
    const seen = new Set<number>();
    // g.arcs 는 (Polygon) 링 배열 또는 (MultiPolygon) 링 배열의 배열. 말단은 아크 인덱스 숫자.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visit = (node: any) => {
      if (typeof node[0] === "number") {
        for (const raw of node as number[]) {
          const idx = raw < 0 ? ~raw : raw; // 음수는 방향만 반대인 같은 아크
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

  const arcSides: ArcSide[] = arcUsers.map((u) => ({ a: u[0] ?? -1, b: u[1] ?? -1 }));

  const dongArcs: number[][] = Array.from({ length: n }, () => []);
  arcUsers.forEach((users, arcIdx) => {
    for (const d of users) dongArcs[d].push(arcIdx);
  });

  const features: Feature<LineString>[] = [];
  for (let i = 0; i < arcCount; i++) {
    features.push({
      type: "Feature",
      id: i,
      properties: {},
      geometry: { type: "LineString", coordinates: decodeArc(topo, i) },
    });
  }

  const arcGeojson: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features,
  };

  return { arcGeojson, arcSides, dongArcs };
}

// 델타 인코딩 + transform(scale/translate)된 아크를 절대 경위도 좌표로 복원.
function decodeArc(topo: Topology, index: number): number[][] {
  const arc = topo.arcs[index];
  const transform = topo.transform;
  if (!transform) return arc.map((p) => [p[0], p[1]]);

  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
}
