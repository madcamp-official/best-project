import { useEffect, useRef } from "react";
import { AttributionControl, Map as MaplibreMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PreparedMap } from "../data/loadSeoulDong";
import { game, tickProduction, tickOrders, drainDirty, trySortie } from "../game/state";
import { useUIStore } from "../store/uiStore";
import { MY_HOLDER_ID, PALETTE } from "../config";

interface Props {
  prepared: PreparedMap;
}

const BASEMAP_SOURCE = "basemap";
const BASEMAP_LAYER = "basemap-layer";
const SOURCE_ID = "dong";
const FILL_LAYER = "dong-fill";
const HOVER_LAYER = "dong-hover";
const SELECT_LAYER = "dong-select";
const ARC_SOURCE = "arcs";
const FRONTIER_GLOW = "frontier-glow";
const FRONTIER_LAYER = "frontier";
const BADGE_SOURCE = "troop-badges";
const BADGE_LAYER = "troop-badges-layer";
const NAME_LAYER = "dong-name-layer";
const UNIT_SOURCE = "units";
const UNIT_CIRCLE_LAYER = "unit-circle";
const UNIT_LABEL_LAYER = "unit-label";

// 키 없이 쓸 수 있는 CARTO 무료 래스터 베이스맵 (라벨 없는 다크 테마).
// 스테인드글라스처럼 동 폴리곤을 반투명하게 얹기 위한 바탕 지도.
const BASEMAP_TILES = ["a", "b", "c", "d"].map(
  (s) => `https://${s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png`
);

// README.md §1 핵심 제약 — 3,500(목업은 424)개 동 상태를 React state에 넣지 않는다.
// 이 컴포넌트는 마운트 시 MapLibre 인스턴스를 1회 생성하고, 이후 모든 갱신은
// game/state.ts 를 직접 읽어 setFeatureState로 명령형 반영한다. React는 재렌더링하지 않는다.
export function MapView({ prepared }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }],
      },
      center: averageCenter(prepared),
      zoom: 10.4,
      attributionControl: false,
      doubleClickZoom: false, // 더블클릭 확대 비활성화 (동을 빠르게 두 번 클릭할 때 오확대 방지)
    });
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: "© OpenStreetMap, © CARTO" })
    );
    // 우클릭을 병력 이동/공격에 쓰므로 우클릭 드래그 회전을 끈다 (평면 톱다운 유지).
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on("error", (e) => {
      console.error("[maplibre error]", e.error);
    });

    map.on("load", () => {
      // 실제 지도 위에 스테인드글라스를 얹은 느낌: 아래는 실지도, 위는 반투명 색유리 동.
      map.addSource(BASEMAP_SOURCE, {
        type: "raster",
        tiles: BASEMAP_TILES,
        tileSize: 256,
      });
      map.addLayer({
        id: BASEMAP_LAYER,
        type: "raster",
        source: BASEMAP_SOURCE,
        // 실지도를 조금 더 잘 보이게: 불투명도 최대 + 밝기 상한을 0.75→0.9로 올림.
        paint: { "raster-opacity": 1, "raster-brightness-max": 0.9 },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: prepared.geojson,
        promoteId: "admIndex",
      });

      // 채움: 옅고 투명한 색유리 틴트. 플레이어 구분은 아래 국경선(frontier)이 담당.
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": buildOwnerColorExpr("fill"),
          "fill-opacity": ["case", ["==", ["feature-state", "owner"], 0], 0.16, 0.42],
        },
      });

      // 국경선 소스 = TopoJSON 아크(공유 경계선). 같은 팀끼리 맞닿은 내부 경계는
      // frontier=false 로 두어 숨기고, 소유주가 다른 경계만 frontier=true 로 그린다.
      map.addSource(ARC_SOURCE, {
        type: "geojson",
        data: prepared.arcGeojson,
      });
      map.addLayer({
        id: FRONTIER_GLOW,
        type: "line",
        source: ARC_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], PALETTE[0].stroke],
          "line-width": 6,
          "line-blur": 4,
          "line-opacity": ["case", ["==", ["feature-state", "frontier"], true], 0.45, 0],
        },
      });
      map.addLayer({
        id: FRONTIER_LAYER,
        type: "line",
        source: ARC_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], PALETTE[0].stroke],
          "line-width": 1.8,
          "line-opacity": ["case", ["==", ["feature-state", "frontier"], true], 1, 0],
        },
      });

      // 커서 아래 동을 잠깐 드러내는 hover 윤곽 (상시 테두리 아님 — 마우스 위치 표시용).
      map.addLayer({
        id: HOVER_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-width": 1,
          "line-opacity": ["case", ["==", ["feature-state", "hover"], true], 0.35, 0],
        },
      });
      // 선택된 동(출정 시작점)만 흰색으로 강조.
      map.addLayer({
        id: SELECT_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-width": 2.5,
          "line-opacity": ["case", ["==", ["feature-state", "selected"], true], 1, 0],
        },
      });

      map.addSource(BADGE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // 동 이름 — 작은 흰 글자로 병력 숫자 위에 표시. (값과의 구분은 '크기'가 담당)
      map.addLayer({
        id: NAME_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: 12,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, -1.5], // 병력 숫자 위, 간격 넉넉히
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0b1220",
          "text-halo-width": 1.6,
        },
      });
      // 병력 수 — 핵심 값. 이름보다 훨씬 크고 두꺼운 외곽선으로 크게 강조.
      map.addLayer({
        id: BADGE_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: 12, // README.md §7.2 — 병력 숫자는 근접 줌에서만
        layout: {
          "text-field": ["get", "troops"],
          "text-size": 18,
          "text-offset": [0, 0.35], // 이름과 겹치지 않게 살짝 아래로
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 2.8,
          "text-halo-blur": 0.3,
        },
      });

      // 이동 중인 유닛: 원 하나 + 그 옆의 병력 숫자. (README.md §4.4 유닛 이동)
      map.addSource(UNIT_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: UNIT_CIRCLE_LAYER,
        type: "circle",
        source: UNIT_SOURCE,
        paint: {
          "circle-radius": 8,
          "circle-color": PALETTE[MY_HOLDER_ID].stroke,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: UNIT_LABEL_LAYER,
        type: "symbol",
        source: UNIT_SOURCE,
        layout: {
          "text-field": ["get", "amount"],
          "text-size": 13,
          "text-offset": [1.1, 0], // 원 오른쪽 옆에 숫자 표시
          "text-anchor": "left",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1.4,
        },
      });

      for (let i = 0; i < prepared.n; i++) {
        map.setFeatureState({ source: SOURCE_ID, id: i }, { owner: game.ownerId[i] });
      }
      for (let i = 0; i < prepared.arcSides.length; i++) {
        setArcState(map, prepared, i);
      }
      updateBadges(map, prepared);

      let hovered: number | null = null;
      map.on("mousemove", FILL_LAYER, (e) => {
        const f = e.features?.[0];
        if (!f || f.id === undefined) return;
        const id = Number(f.id);
        if (hovered === id) return;
        if (hovered !== null) map.setFeatureState({ source: SOURCE_ID, id: hovered }, { hover: false });
        hovered = id;
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", FILL_LAYER, () => {
        if (hovered !== null) map.setFeatureState({ source: SOURCE_ID, id: hovered }, { hover: false });
        hovered = null;
        map.getCanvas().style.cursor = "";
      });

      // 좌클릭 = 동 선택(출정 시작점). 빈 곳 좌클릭 = 선택 해제.
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const hit = hits[0];
        if (hit && hit.id !== undefined) handleSelect(Number(hit.id), map);
        else selectDong(map, null, useUIStore.getState().select);
      });

      // 우클릭 = 선택한 동에서 그 동으로 병력 이동/공격.
      map.getCanvas().addEventListener("contextmenu", (ev) => ev.preventDefault());
      map.on("contextmenu", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const hit = hits[0];
        if (hit && hit.id !== undefined) handleAction(Number(hit.id));
      });

      useUIStore.getState().setPhase("ready");
      useUIStore.getState().refreshSummary();
    });

    // README.md §4.5 — 물리 키(e.code) 사용, 한글 IME 조합 중에는 무시.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const step = 60;
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          map.panBy([0, -step]);
          break;
        case "KeyS":
        case "ArrowDown":
          map.panBy([0, step]);
          break;
        case "KeyA":
        case "ArrowLeft":
          map.panBy([-step, 0]);
          break;
        case "KeyD":
        case "ArrowRight":
          map.panBy([step, 0]);
          break;
        case "Equal":
        case "NumpadAdd":
        case "KeyE":
          map.zoomIn();
          break;
        case "Minus":
        case "NumpadSubtract":
        case "KeyQ":
          map.zoomOut();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // README.md §4.1, §7.3 — 생산 tick + 유닛 이동 + dirty Set 배치 리페인트를 rAF 루프에서.
    let raf = 0;
    let last = performance.now();
    let lastSummaryAt = 0;
    let hadUnits = false;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tickProduction(dt);
      tickOrders(now); // 도착한 유닛의 전투/증원 처리 (dirty 추가)

      const changed = drainDirty();
      if (changed.length > 0 && map.isStyleLoaded()) {
        // 소유권이 바뀐 동 + 그 동에 접한 아크만 다시 계산해 국경선을 갱신한다.
        const arcsToUpdate = new Set<number>();
        for (const idx of changed) {
          map.setFeatureState({ source: SOURCE_ID, id: idx }, { owner: game.ownerId[idx] });
          for (const ai of prepared.dongArcs[idx]) arcsToUpdate.add(ai);
        }
        for (const ai of arcsToUpdate) setArcState(map, prepared, ai);
        updateBadges(map, prepared);
      }

      // 이동 중인 유닛 원 위치를 매 프레임 갱신. 없으면 마지막에 한 번 비운다.
      if (game.orders.length > 0) {
        updateUnits(map, now);
        hadUnits = true;
      } else if (hadUnits) {
        updateUnits(map, now);
        hadUnits = false;
      }

      if (now - lastSummaryAt > 250) {
        lastSummaryAt = now;
        useUIStore.getState().refreshSummary();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      map.remove();
    };
    // prepared는 최초 로드 후 고정값이므로 마운트 시 1회만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  // maplibre-gl.css가 .maplibregl-map{position:relative}를 주입해 .map-view의
  // position:absolute를 캐스케이드 순서에 따라 덮어쓸 수 있어 인라인으로 고정한다.
  return (
    <div
      ref={containerRef}
      className="map-view"
      style={{ position: "absolute", inset: 0 }}
    />
  );
}

// 국경선 규칙: 아크 양쪽 동의 소유주가 다르면 frontier=true.
// 같은 팀끼리(중립-중립 포함) 맞닿은 내부 경계는 frontier=false 라 보이지 않는다.
function setArcState(map: MaplibreMap, prepared: PreparedMap, i: number) {
  const { a, b } = prepared.arcSides[i];
  const oa = a >= 0 ? game.ownerId[a] : -1;
  const ob = b >= 0 ? game.ownerId[b] : -1; // -1 = 지도 바깥
  const frontier = oa !== ob;
  const holder = borderHolder(oa, ob);
  map.setFeatureState(
    { source: ARC_SOURCE, id: i },
    { frontier, color: (PALETTE[holder] ?? PALETTE[0]).stroke }
  );
}

// 국경선 색은 소유한 쪽 색을 쓴다. 양쪽 다 플레이어면 편의상 큰 holderId 쪽.
function borderHolder(oa: number, ob: number): number {
  const aOwned = oa > 0;
  const bOwned = ob > 0;
  if (aOwned && bOwned) return Math.max(oa, ob);
  if (aOwned) return oa;
  if (bOwned) return ob;
  return 0; // 중립 vs 바깥 → 중립색 실루엣
}

// 좌클릭: 동 선택. 같은 동을 다시 누르면 해제. 어떤 소유주든 선택해 정보를 볼 수 있고,
// 내 동이면 우클릭 이동/공격의 시작점이 된다.
function handleSelect(idx: number, map: MaplibreMap) {
  const { selectedIndex, select } = useUIStore.getState();
  if (selectedIndex === idx) selectDong(map, null, select);
  else selectDong(map, idx, select);
}

// 우클릭: 선택한 내 동에서 인접한 대상 동으로 병력 파견.
//  · 적/중립 → 전투    · 내 동 → 증원(영토 내 병력 이동)
function handleAction(idx: number) {
  const { selectedIndex, showToast } = useUIStore.getState();

  if (selectedIndex === null || game.ownerId[selectedIndex] !== MY_HOLDER_ID) {
    showToast("먼저 내 동을 좌클릭으로 선택하세요.");
    return;
  }
  if (selectedIndex === idx) return;

  if (!game.neighborIndex[selectedIndex]?.includes(idx)) {
    showToast("인접한 동으로만 이동/공격할 수 있습니다.");
    return;
  }

  const result = trySortie(selectedIndex, idx, MY_HOLDER_ID);
  if (!result.ok) showToast(result.reason);
  // 소유권 변경분(채움색·국경선)은 rAF 루프가 dirty set을 보고 반영한다.
  useUIStore.getState().refreshSummary();
}

function selectDong(map: MaplibreMap, idx: number | null, select: (i: number | null) => void) {
  const prev = useUIStore.getState().selectedIndex;
  if (prev !== null) {
    map.setFeatureState({ source: SOURCE_ID, id: prev }, { selected: false });
  }
  if (idx !== null) {
    map.setFeatureState({ source: SOURCE_ID, id: idx }, { selected: true });
  }
  select(idx);
}

function updateBadges(map: MaplibreMap, prepared: PreparedMap) {
  const src = map.getSource(BADGE_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: prepared.meta.map((m) => ({
      type: "Feature",
      properties: { troops: game.troops[m.admIndex], name: m.name },
      geometry: { type: "Point", coordinates: m.centroid },
    })),
  });
}

// 이동 중인 유닛 원을 출발지→목적지 사이 보간 위치에 그린다 (원 하나 + 옆에 병력 수).
function updateUnits(map: MaplibreMap, now: number) {
  const src = map.getSource(UNIT_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  const features = game.orders.map((o) => {
    const span = o.arriveTick - o.departTick;
    const t = span > 0 ? Math.min(1, Math.max(0, (now - o.departTick) / span)) : 1;
    const a = game.meta[o.from].centroid;
    const b = game.meta[o.to].centroid;
    return {
      type: "Feature" as const,
      properties: { amount: o.amount },
      geometry: {
        type: "Point" as const,
        coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      },
    };
  });
  src.setData({ type: "FeatureCollection", features });
}

function averageCenter(prepared: PreparedMap): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const m of prepared.meta) {
    sx += m.centroid[0];
    sy += m.centroid[1];
  }
  return [sx / prepared.meta.length, sy / prepared.meta.length];
}

// owner(feature-state, holderId) → PALETTE 색 매칭 expression. 매칭 실패 시 중립색 fallback.
function buildOwnerColorExpr(kind: "fill" | "stroke") {
  const expr: unknown[] = ["match", ["feature-state", "owner"]];
  PALETTE.forEach((c, idx) => {
    expr.push(idx, kind === "fill" ? c.fill : c.stroke);
  });
  expr.push(kind === "fill" ? PALETTE[0].fill : PALETTE[0].stroke);
  return expr as never;
}
