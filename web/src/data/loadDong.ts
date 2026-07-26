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
  isolated: number[]; // 인접 차수 0인 동(섬·월경지) admIndex 목록 (README §2.3)
}

type DongFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;

// 법정동 경계 GeoJSON (web/public). gisdeveloper 읍면동(법정동) SHP를 mapshaper로
// WGS84 변환한 정적 자산. 속성: EMD_CD(8자리 법정동코드=[시도2][시군구3][읍면동3]),
// EMD_KOR_NM(한글명), EMD_ENG_NM(영문명).
// 재현: mapshaper emd.shp encoding=euc-kr -clean -simplify 8% keep-shapes \
//         -proj wgs84 -o format=geojson precision=0.00001 beopjeong-emd.geojson
//   ※ -clean을 simplify 前에 둔다 — 원본 SHP의 자기교차를 재노딩해 렌더 시 생기는
//     "좁고 긴 회랑"(얇은 삼각 슬래시) 아티팩트를 방지. (clean을 뒤에 두면 안 고쳐짐)
//   경계 데이터를 바꾸면 server/tools/data-gen/generate.mjs도 다시 돌려 admIndex를 맞출 것.
// 로드 후 TopoJSON 위상으로 인접 그래프 + 아크(공유 경계선) 추출 → polylabel 라벨 지점 계산.
// SCOPE_SIDOCD = null 이면 전국 전체(~5,065 법정동), 시도 코드면 해당 시도만(성능 폴백).
const DONG_GEOJSON_URL = `${import.meta.env.BASE_URL}beopjeong-emd.geojson`;

interface EmdProps {
  EMD_CD: string;
  EMD_KOR_NM: string;
  EMD_ENG_NM?: string;
}

export async function loadDong(): Promise<PreparedMap> {
  const res = await fetch(DONG_GEOJSON_URL);
  if (!res.ok) throw new Error(`법정동 경계 로드 실패 (${res.status}) — ${DONG_GEOJSON_URL}`);
  const fc = (await res.json()) as FeatureCollection<Polygon | MultiPolygon, EmdProps>;

  const filtered = fc.features.filter(
    (f) =>
      f.properties?.EMD_CD &&
      (SCOPE_SIDOCD === null || f.properties.EMD_CD.slice(0, 2) === SCOPE_SIDOCD)
  );

  const meta: DongStaticMeta[] = [];
  const preparedFeatures: DongFeature[] = [];

  filtered.forEach((f, admIndex) => {
    const code = f.properties.EMD_CD; // 법정동코드 8자리
    const centroid = computeLabelPoint(f as Feature<Polygon | MultiPolygon>);
    meta.push({
      admIndex,
      code,
      name: f.properties.EMD_KOR_NM,
      sggcd: code.slice(0, 5), // [시도2][시군구3] — core.computeRank 시장 판정용
      sggnm: "", // 이 파일엔 시군구명이 없다(코드만). 필요 시 sig 데이터로 보강.
      sidocd: code.slice(0, 2),
      sidonm: "",
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

  // README §2.3 — 인접 차수 0(섬·월경지) 실측. 전국 전환 시 처리 방침 판단 자료.
  const isolated: number[] = [];
  for (let i = 0; i < n; i++) if (neighborIndex[i].length === 0) isolated.push(i);
  if (isolated.length > 0) {
    const names = isolated.slice(0, 20).map((i) => meta[i].name).join(", ");
    console.warn(
      `[loadDong] 인접 차수 0인 동 ${isolated.length}개 (섬·월경지): ${names}` +
        (isolated.length > 20 ? " …" : "")
    );
  }

  return { n, geojson, meta, neighborIndex, arcGeojson, arcSides, dongArcs, isolated };
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
