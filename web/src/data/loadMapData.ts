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

// 아크(공유 경계선) 한 조각의 양쪽 셀. b = -1 이면 지도 바깥과 맞닿은 외곽선.
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
  dongArcs: number[][]; // admIndex → 그 셀에 접한 아크 인덱스 목록
  isolated: number[]; // 인접 차수 0인 셀(섬·월경지) admIndex 목록 (README §2.3)
  // 지도 바깥(바다·경계)에 직접 닿는 '경계 셀' 마스크(0/1). 포위 귀속 판정의 탈출구.
  borderMask: Uint8Array;
}

type DongFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
type MetaFields = Omit<DongStaticMeta, "admIndex" | "centroid">;

interface NameLookup {
  sggNames: Record<string, string>;
  sidoNames: Record<string, string>;
}

// 지도(mapId)별 자산 위치 + "원본 GeoJSON 속성 → DongStaticMeta 필드" 변환. 파이프라인(topology/
// 인접 그래프/아크 추출) 자체는 지도 무관이라 아래 로직에서 한 번만 구현하고 공유한다.
interface MapAsset {
  geojsonUrl: string;
  namesUrl?: string;
  // null을 반환하면 그 feature는 제외한다(코드 없는 행, SCOPE_SIDOCD 폴백 등).
  extractMeta: (props: Record<string, unknown>, names: NameLookup | null) => MetaFields | null;
}

const MAP_ASSETS: Record<string, MapAsset> = {
  // 전국 법정동(~5,065개). 소스: web/public/beopjeong-emd.geojson(README §2.1 참조).
  "kr-dong": {
    geojsonUrl: `${import.meta.env.BASE_URL}beopjeong-emd.geojson`,
    namesUrl: `${import.meta.env.BASE_URL}sgg-sido-names.json`,
    extractMeta: (props, names) => {
      const code = props.EMD_CD as string | undefined;
      if (!code) return null;
      if (SCOPE_SIDOCD !== null && code.slice(0, 2) !== SCOPE_SIDOCD) return null;
      return {
        code,
        name: props.EMD_KOR_NM as string,
        sggcd: code.slice(0, 5), // [시도2][시군구3] — core.computeRank 시장 판정용
        sggnm: names?.sggNames[code.slice(0, 5)] ?? "",
        sidocd: code.slice(0, 2),
        sidonm: names?.sidoNames[code.slice(0, 2)] ?? "",
      };
    },
  },
  // 시/군/구(~250개, "한국지리" 모드). 소스: web/public/kr-sgg.geojson(admdongkor sgg
  // level에서 fetch-sgg-geojson.mjs로 1회 추출 — sggcd/sggnm/sidocd/sidonm이 이미 채워져 있어
  // 별도 이름 조회 테이블이 필요 없다.
  //
  // 이 지도의 최소 단위 자체가 시군구이므로 sggcd=자기 자신 코드로 채운다 — GameCore.computeRank의
  // "sggcd 그룹 전체 장악=시장 계급" 판정이 셀 하나만 가져도 참이 되어, 최하위 계급(동장 상당)이
  // 자연히 생략되고 시장→도지사→대통령 순으로만 오른다(서버 generate-sgg.mjs와 동일한 설계).
  "kr-sgg": {
    geojsonUrl: `${import.meta.env.BASE_URL}kr-sgg.geojson`,
    extractMeta: (props) => {
      const code = props.sggcd as string | undefined;
      if (!code) return null;
      return {
        code,
        name: props.sggnm as string,
        sggcd: code,
        sggnm: props.sggnm as string,
        sidocd: props.sidocd as string,
        sidonm: props.sidonm as string,
      };
    },
  },
};

export const DEFAULT_MAP_ID = "kr-dong";

export const MAP_DISPLAY_NAMES: Record<string, string> = {
  "kr-dong": "전국 법정동",
  "kr-sgg": "시/군/구",
};

export function mapDisplayName(mapId: string): string {
  return MAP_DISPLAY_NAMES[mapId] ?? MAP_DISPLAY_NAMES[DEFAULT_MAP_ID];
}

export async function loadMapData(mapId: string): Promise<PreparedMap> {
  const asset = MAP_ASSETS[mapId] ?? MAP_ASSETS[DEFAULT_MAP_ID];

  const [res, namesRes] = await Promise.all([
    fetch(asset.geojsonUrl),
    asset.namesUrl ? fetch(asset.namesUrl) : Promise.resolve(null),
  ]);
  if (!res.ok) throw new Error(`지도 경계 로드 실패 (${res.status}) — ${asset.geojsonUrl}`);
  if (asset.namesUrl && (!namesRes || !namesRes.ok)) {
    throw new Error(`시군구/시도명 로드 실패 (${namesRes?.status}) — ${asset.namesUrl}`);
  }
  const fc = (await res.json()) as FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
  const names: NameLookup | null = namesRes ? ((await namesRes.json()) as NameLookup) : null;

  const meta: DongStaticMeta[] = [];
  const preparedFeatures: DongFeature[] = [];

  for (const f of fc.features) {
    const m = asset.extractMeta(f.properties ?? {}, names);
    if (!m) continue;
    const admIndex = meta.length;
    const centroid = computeLabelPoint(f as Feature<Polygon | MultiPolygon>);
    meta.push({ admIndex, ...m, centroid });
    preparedFeatures.push({
      type: "Feature",
      properties: { admIndex },
      geometry: f.geometry,
    });
  }

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
  const { arcGeojson, arcSides, dongArcs } = extractArcs(topo, geomCollection, n, meta);

  // 경계 셀 마스크: arcSides[i].b === -1 이면 그 아크는 셀 하나(a)만 쓰는 외곽선 →
  // a는 지도 바깥(바다·경계)에 닿는 경계 셀. 포위 귀속에서 '탈출구'로 쓰인다.
  const borderMask = new Uint8Array(n);
  for (const { a, b } of arcSides) {
    if (b === -1 && a >= 0) borderMask[a] = 1;
  }

  // README §2.3 — 인접 차수 0(섬·월경지) 실측.
  const isolated: number[] = [];
  for (let i = 0; i < n; i++) if (neighborIndex[i].length === 0) isolated.push(i);
  if (isolated.length > 0) {
    const names_ = isolated.slice(0, 20).map((i) => meta[i].name).join(", ");
    console.warn(
      `[loadMapData:${mapId}] 인접 차수 0인 셀 ${isolated.length}개 (섬·월경지): ${names_}` +
        (isolated.length > 20 ? " …" : "")
    );
  }

  return { n, geojson, meta, neighborIndex, arcGeojson, arcSides, dongArcs, isolated, borderMask };
}

// TopoJSON 아크는 인접한 두 폴리곤이 하나로 공유한다. 각 아크가 어떤 셀들에
// 쓰이는지 집계하면 "공유 경계선" 단위의 인접 정보를 얻는다.
function extractArcs(
  topo: Topology,
  geomCollection: GeometryCollection,
  n: number,
  meta: DongStaticMeta[]
) {
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

  // 행정구역 경계 하이라이트(소유권과 무관한 정적 속성): 아크 양쪽 셀의 시군구/시도 코드가
  // 다르면 그 경계선을 표시 대상으로 표시한다. 지도 바깥과 맞닿은 외곽선(b=-1)은 대상 아님.
  // outer(외곽선 여부)도 속성으로 실어, 렌더러가 해안선에는 글로우를 빼는 등 달리 그릴 수 있게 한다.
  const features: Feature<LineString>[] = [];
  for (let i = 0; i < arcCount; i++) {
    const { a, b } = arcSides[i];
    let sggBoundary = false;
    let sidoBoundary = false;
    if (a >= 0 && b >= 0) {
      sggBoundary = meta[a].sggcd !== meta[b].sggcd;
      sidoBoundary = meta[a].sidocd !== meta[b].sidocd;
    }
    features.push({
      type: "Feature",
      id: i,
      properties: { sggBoundary, sidoBoundary, outer: b === -1 },
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
