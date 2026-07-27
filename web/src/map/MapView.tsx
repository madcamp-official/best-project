import { useEffect, useRef } from "react";
import { AttributionControl, Map as MaplibreMap, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PreparedMap } from "../data/loadDong";
import {
  world,
  airdropInRange,
  airdropOrigin,
  drainDirty,
  pruneArrivedOrders,
  drainCaptureFlashes,
  drainMissilesTouched,
  drainMissileImpacts,
  drainRallyTouched,
  drainRespawnCell,
  setMyRally,
} from "../world/worldView";
import type { Connection } from "../net/connection";
import { useUIStore } from "../store/uiStore";
import { CONFIG, PALETTE } from "../config";

interface Props {
  prepared: PreparedMap;
  connection: Connection;
}

const BASEMAP_SOURCE = "basemap";
const BASEMAP_LAYER = "basemap-layer";
const SOURCE_ID = "dong";
const FILL_LAYER = "dong-fill";
const HOVER_LAYER = "dong-hover";
const SELECT_LAYER = "dong-select";
const FLASH_LAYER = "dong-flash";
const FLASH_MS = 600; // 함락 플래시 지속 시간
const ARC_SOURCE = "arcs";
const FRONTIER_GLOW = "frontier-glow";
const FRONTIER_LAYER = "frontier";
const BADGE_SOURCE = "troop-badges";
const BADGE_LAYER = "troop-badges-layer";
const NAME_LAYER = "dong-name-layer";
const UNIT_SOURCE = "units";
const UNIT_CIRCLE_LAYER = "unit-circle";
const UNIT_LABEL_LAYER = "unit-label";
const MISSILE_SOURCE = "missiles";
const MISSILE_LAYER = "missiles-layer";
const MISSILE_IMAGE_ID = "missile-icon"; // addImage로 얹는 🚀 아이콘 이름
const MISSILE_EMOJI = "🚀"; // 미사일 마커 이모지 (Unicode에 전용 미사일 이모지가 없어 로켓 사용)
const RALLY_SOURCE = "rally"; // B2 집결지 깃발 마커
const RALLY_LAYER = "rally-layer";
const RALLY_IMAGE_ID = "rally-icon"; // addImage로 얹는 🚩 아이콘 이름
const RALLY_EMOJI = "🚩";
const AIM_CIRCLE_SOURCE = "aim-circle";
const AIM_CIRCLE_FILL = "aim-circle-fill";
const AIM_CIRCLE_LINE = "aim-circle-line";
const AIRDROP_RANGE_SOURCE = "airdrop-range"; // 공수 사거리 원(목적지 선택 단계)
const AIRDROP_RANGE_FILL = "airdrop-range-fill";
const AIRDROP_RANGE_LINE = "airdrop-range-line";
const AIM_BLINK_LAYER = "dong-aim-blink"; // 조준에 걸린 동의 하얀 반짝 테두리
const EXPLOSION_SOURCE = "explosions";
const EXPLOSION_FILL = "explosions-fill";
const EXPLOSION_RING = "explosions-ring";
const EXPLOSION_MS = 650; // 폭발 충격파 지속(ms)
const AIRDROP_UNIT_SOURCE = "airdrop-units"; // 공수부대 삼각형 유닛(일반 원 유닛과 구분)
const AIRDROP_UNIT_LAYER = "airdrop-unit-icon";
const AIRDROP_UNIT_LABEL = "airdrop-unit-label";
const TRIANGLE_IMAGE_ID = "airdrop-triangle";
const ATTACK_ARROW_SOURCE = "attack-arrow"; // 우클릭 드래그 공격 화살표(HOI 스타일 블록 화살표)
const ATTACK_ARROW_FILL = "attack-arrow-fill";
const ATTACK_ARROW_LINE = "attack-arrow-line";

// 키 없이 쓸 수 있는 CARTO 무료 래스터 베이스맵 (라벨 없는 다크 테마).
// 스테인드글라스처럼 동 폴리곤을 반투명하게 얹기 위한 바탕 지도.
const BASEMAP_TILES = ["a", "b", "c", "d"].map(
  (s) => `https://${s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png`
);

// README.md §1 핵심 제약 — 3,500개 동 상태를 React state에 넣지 않는다.
// 이 컴포넌트는 마운트 시 MapLibre 인스턴스를 1회 생성하고, 이후 모든 갱신은
// world(서버 상태 사본)를 직접 읽어 setFeatureState로 명령형 반영한다. React는 재렌더링하지 않는다.
// 입력은 connection.sendSortie로 서버에 보낼 뿐, 클라가 직접 게임 로직을 돌리지 않는다(plan.md §3).
export function MapView({ prepared, connection }: Props) {
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
      center: myStartCenter(prepared), // 시작 시 내 영토로 카메라 이동
      zoom: 11,
      attributionControl: false,
      doubleClickZoom: false, // 더블클릭 확대 비활성화 (동을 빠르게 두 번 클릭할 때 오확대 방지)
    });
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: "© OpenStreetMap, © CARTO" })
    );
    // 우클릭을 병력 이동/공격에 쓰므로 우클릭 드래그 회전을 끈다 (평면 톱다운 유지).
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    // Shift는 공수부대 토글 단축키로 쓰므로 Shift+드래그 박스줌을 끈다(충돌 방지).
    map.boxZoom.disable();
    // 개발 편의용 디버그 훅 (프로덕션 빌드에선 제외됨).
    if (import.meta.env.DEV) {
      Object.assign(window, { __map: map, __world: world });
    }

    map.on("error", (e) => {
      console.error("[maplibre error]", e.error);
    });

    // ── 미사일 조준 상태(이 이펙트 수명 동안 유지되는 명령형 상태) ──
    const RADIUS = CONFIG.MISSILE_RADIUS_DEG;
    let lastMouseLngLat: [number, number] | null = null;
    let aimDirty = false; // 마우스가 움직였거나 조준을 막 시작 → 다음 프레임에 원/타격 재계산
    let wasAiming = false;
    const aimedSet = new Set<number>(); // 지금 원에 걸린 동(하얀 반짝 대상)
    const explosions: { cx: number; cy: number; r: number; start: number }[] = []; // 진행 중 폭발
    // 공수부대(B3) 조준 상태 — source 단계는 원으로 내 동 선택, dest 단계는 목적지 선택(2클릭).
    let airdropPhase: "source" | "dest" = "source";
    let airdropSources: number[] = [];
    let destHover = -1; // dest 단계에서 커서 아래 동(하이라이트 대상)
    let wasTransporting = false;
    const airdropSet = new Set<number>(); // source 단계에서 원에 걸린 내 동

    // 미사일이 얹힌 동 centroid에 마커를 다시 그린다.
    const updateMissileMarkers = (m: MaplibreMap) => {
      const src = m.getSource(MISSILE_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      const idxs: number[] = [];
      for (let i = 0; i < world.n; i++) if (world.missiles[i]) idxs.push(i);
      src.setData({
        type: "FeatureCollection",
        features: idxs.map((i) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: world.meta[i].centroid },
        })),
      });
    };

    // 내 집결지(B2)에 깃발 마커를 그린다. 없으면(myRally<0) 비운다.
    const updateRallyMarker = (m: MaplibreMap) => {
      const src = m.getSource(RALLY_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      const idx = world.myRally;
      const features =
        idx >= 0 && idx < world.n
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "Point" as const, coordinates: world.meta[idx].centroid },
              },
            ]
          : [];
      src.setData({ type: "FeatureCollection", features });
    };

    // 우클릭 드래그 공격 상태. 우클릭 누른 지점(rightDownPoint)에서 임계(px) 이상 움직이면 드래그로
    // 확정하고(dragging), 그 미만이면 '클릭'으로 보고 옛 방식(좌클릭 선택 동 → 대상)으로 처리한다.
    const DRAG_THRESHOLD_PX = 6;
    let rightDownPoint: { x: number; y: number } | null = null;
    let rightDownDong = -1; // 우클릭이 눌린 동(내 동일 때만 드래그 출발지가 된다)
    let dragging = false;
    let dragSource = -1;
    let dragTargets: number[] = []; // 이번 드래그에서 갈 수 있는 동들(드래그 확정 시 1회 계산)
    let dragTargetSet = new Set<number>();

    // 출발지(from)에서 커서로 이어지는 공격 화살표(본선 + 화살촉)를 그린다. from<0이면 비운다.
    const updateArrow = (from: number, cursor: [number, number] | null) => {
      const src = map.getSource(ATTACK_ARROW_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      if (from < 0 || from >= world.n || !cursor) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      src.setData({
        type: "FeatureCollection",
        features: arrowPolygon(world.meta[from].centroid as [number, number], cursor),
      });
    };

    // 드래그 중 화살표가 가리킬(= 놓았을 때 실제로 보낼) 대상 동을 정한다.
    //  · 커서 아래 동이 갈 수 있는 대상이면 그 동
    //  · 아니면(그 방향으로 더 멀거나 불가한 곳) 갈 수 있는 동 중 커서에 가장 가까운 동 = 그 방향 최대치
    //  · 출발지 위이거나 갈 수 있는 동이 없으면 -1(화살표 없음)
    const resolveDragTarget = (point: { x: number; y: number }, lngLat: [number, number]): number => {
      if (!dragging || dragTargets.length === 0) return -1;
      const hits = map.queryRenderedFeatures([point.x, point.y], { layers: [FILL_LAYER] });
      const over = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
      if (over === dragSource) return -1;
      if (over >= 0 && dragTargetSet.has(over)) return over;
      const [cx, cy] = lngLat;
      const cosLat = Math.cos((cy * Math.PI) / 180);
      let best = -1;
      let bestD = Infinity;
      for (const c of dragTargets) {
        const m = world.meta[c].centroid;
        const dx = (m[0] - cx) * cosLat;
        const dy = m[1] - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    };

    // 마우스 위치를 중심으로 조준 원을 그리고, 원에 걸친 동을 targetSet에 담는다.
    // ownedOnly=true면 내 소유 동만(공수 source 단계), false면 모든 동(미사일 조준).
    const updateAim = (center: [number, number], targetSet: Set<number>, ownedOnly: boolean) => {
      const [cx, cy] = center;
      const cosLat = Math.cos((cy * Math.PI) / 180);
      const rLng = RADIUS / cosLat; // 경도는 위도에 따라 실제 거리가 달라 보정(원처럼 보이게)

      const ring: [number, number][] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * 2 * Math.PI;
        ring.push([cx + Math.cos(a) * rLng, cy + Math.sin(a) * RADIUS]);
      }
      const circleSrc = map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined;
      circleSrc?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
      });

      // 원의 경위도 bbox를 화면 좌표로 변환해 후보 동만 질의 → 폴리곤-원 교차로 확정.
      const sw = map.project([cx - rLng, cy - RADIUS]);
      const ne = map.project([cx + rLng, cy + RADIUS]);
      const bbox: [[number, number], [number, number]] = [
        [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
        [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)],
      ];
      const feats = map.queryRenderedFeatures(bbox, { layers: [FILL_LAYER] });
      const hit = new Set<number>();
      for (const f of feats) {
        if (f.id === undefined) continue;
        const id = Number(f.id);
        if (hit.has(id)) continue;
        if (ownedOnly && world.ownerId[id] !== world.myHolderId) continue; // 공수 source는 내 동만
        if (circleHitsPoly(cx, cy, RADIUS, cosLat, f.geometry)) hit.add(id);
      }
      for (const idx of targetSet) {
        if (!hit.has(idx)) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: 0 });
      }
      targetSet.clear();
      for (const idx of hit) targetSet.add(idx);
    };

    const clearAim = (targetSet: Set<number>) => {
      for (const idx of targetSet) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: 0 });
      targetSet.clear();
      const circleSrc = map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined;
      circleSrc?.setData({ type: "FeatureCollection", features: [] });
    };

    // 발사: 지금 원에 걸린 동 목록을 서버로 보내고 조준 모드를 끝낸다. 서버가 중립화 후 DELTA.
    const fireMissile = (center: [number, number]) => {
      connection.sendMissile(center, RADIUS, Array.from(aimedSet));
      clearAim(aimedSet);
      useUIStore.getState().setAiming(false);
    };

    // 공수 사거리 원(반경 = AIRDROP_MAX_RANGE_DEG)을 origin 중심으로 그린다. 거리 판정은 raw 도
    // (centroidDistance)지만, 표시는 화면상 원형이 자연스러워 경도를 cosLat로 보정해 그린다
    // (미사일 조준 원과 동일 방식 — Mercator 위도 늘어남 상쇄). 판정 경계와 미세하게 다를 수 있다.
    const drawAirdropRange = (center: [number, number]) => {
      const r = CONFIG.AIRDROP_MAX_RANGE_DEG;
      const rLng = r / Math.cos((center[1] * Math.PI) / 180); // 경도 반경 보정 → 화면상 원형
      const ring: [number, number][] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * 2 * Math.PI;
        ring.push([center[0] + Math.cos(a) * rLng, center[1] + Math.sin(a) * r]);
      }
      (map.getSource(AIRDROP_RANGE_SOURCE) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
      });
    };
    const clearAirdropRange = () => {
      (map.getSource(AIRDROP_RANGE_SOURCE) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: [],
      });
    };

    // 공수 조준 종료 — 소스/목적지 하이라이트·원(선택 원·사거리 원)을 비우고 단계를 리셋한다.
    const clearAirdrop = () => {
      for (const idx of airdropSet) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: 0 });
      airdropSet.clear();
      if (destHover >= 0) {
        map.setFeatureState({ source: SOURCE_ID, id: destHover }, { aim: 0 });
        destHover = -1;
      }
      airdropSources = [];
      airdropPhase = "source";
      const circleSrc = map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined;
      circleSrc?.setData({ type: "FeatureCollection", features: [] });
      clearAirdropRange();
    };

    // 공수 클릭: source 단계면 원 안 내 동을 출발지로 확정(→dest 단계), dest 단계면 목적지로 발송.
    const handleAirdropClick = (e: MapMouseEvent) => {
      const st = useUIStore.getState();
      if (airdropPhase === "source") {
        if (airdropSet.size === 0) {
          st.showToast("원 안에 내 동이 없습니다.");
          return;
        }
        airdropSources = Array.from(airdropSet);
        airdropPhase = "dest";
        (map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: [],
        });
        const origin = airdropOrigin(airdropSources); // 사거리 원 중심 = 삼각형 출발 동
        if (origin >= 0) drawAirdropRange(world.meta[origin].centroid);
        st.showToast(`출발 ${airdropSources.length}개 동 — 사거리 원 안 목적지를 클릭하세요`);
      } else {
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const dest = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
        if (dest < 0) return;
        if (!airdropInRange(airdropSources, dest)) {
          st.showToast("공수 사거리를 벗어났습니다 — 더 가까운 목적지를 선택하세요.");
          return; // 사거리 밖 — 모드 유지, 쿨타임 소모 안 함
        }
        connection.sendAirdrop(airdropSources, dest);
        st.startAirdropCooldown(CONFIG.AIRDROP_COOLDOWN_SEC * 1000);
        clearAirdrop();
        st.setTransporting(false);
      }
    };

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
          // feature-state "owner"에는 holder의 paletteIdx(색 슬롯)를 넣는다.
          "fill-color": buildPaletteMatchExpr(["feature-state", "owner"], "fill"),
          // 내 영토(mine)는 더 진하게 강조 → 한눈에 구분.
          "fill-opacity": [
            "case",
            ["==", ["feature-state", "owner"], 0], 0.16,
            ["==", ["feature-state", "mine"], true], 0.55,
            0.4,
          ],
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
      // 함락 순간 흰색 플래시(짧게 번쩍이고 사라진다). feature-state "flash"(0~1)를 rAF가 페이드.
      map.addLayer({
        id: FLASH_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": ["coalesce", ["feature-state", "flash"], 0],
        },
      });

      map.addSource(BADGE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // 동 이름 — 작은 흰 글자로 병력 숫자 위에 표시. (값과의 구분은 '크기'가 담당)
      // 전국 스케일에선 저줌에서도 라벨이 필요하므로 minzoom을 낮추되(10), allow-overlap을
      // 끄고 MapLibre 충돌 배치에 맡겨 밀집 지역(서울 등)에서 라벨이 뭉치지 않게 한다.
      map.addLayer({
        id: NAME_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, -1.5], // 병력 숫자 위, 간격 넉넉히
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0b1220",
          "text-halo-width": 1.6,
        },
      });
      // 병력 수 — 핵심 값. 이름보다 훨씬 크고 두꺼운 외곽선으로 크게 강조.
      // 저줌에서 라벨이 겹치면 병력이 많은(=중요한) 동을 우선 배치한다.
      map.addLayer({
        id: BADGE_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: 10, // 전국 스케일: 접속·이동 줌(10~11)에서도 병력 숫자가 보이도록
        layout: {
          "text-field": ["get", "troops"],
          "text-size": 18,
          "text-offset": [0, 0.35], // 이름과 겹치지 않게 살짝 아래로
          "symbol-sort-key": ["*", -1, ["to-number", ["get", "troops"]]],
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
          "circle-color": buildPaletteMatchExpr(["get", "paletteIdx"], "stroke"),
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

      // 공수부대(B3) 삼각형 유닛 — 흰 삼각형 아이콘 + 병력 수. (일반 원 유닛과 구분되게 삼각형.)
      map.addSource(AIRDROP_UNIT_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      const triangleIcon = makeTriangleIcon(22);
      if (triangleIcon) {
        if (!map.hasImage(TRIANGLE_IMAGE_ID)) {
          map.addImage(TRIANGLE_IMAGE_ID, triangleIcon.data, { pixelRatio: triangleIcon.pixelRatio });
        }
        map.addLayer({
          id: AIRDROP_UNIT_LAYER,
          type: "symbol",
          source: AIRDROP_UNIT_SOURCE,
          layout: {
            "icon-image": TRIANGLE_IMAGE_ID,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      } else {
        // 캔버스 렌더 실패 시 폴백: 노란 원.
        map.addLayer({
          id: AIRDROP_UNIT_LAYER,
          type: "circle",
          source: AIRDROP_UNIT_SOURCE,
          paint: {
            "circle-radius": 8,
            "circle-color": "#ffd24a",
            "circle-stroke-color": "#1b2430",
            "circle-stroke-width": 2,
          },
        });
      }
      map.addLayer({
        id: AIRDROP_UNIT_LABEL,
        type: "symbol",
        source: AIRDROP_UNIT_SOURCE,
        layout: {
          "text-field": ["get", "amount"],
          "text-size": 13,
          "text-offset": [0, 1.2], // 삼각형 아래에 병력 수
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1.4,
        },
      });

      // 미사일 마커 — 미사일이 얹힌 동 centroid에 🚀 이모지 아이콘.
      // (스타일에 glyphs 서버가 없어 text-field로는 컬러 이모지를 못 그리므로, 이모지를
      //  캔버스에 렌더해 래스터 아이콘으로 addImage 후 symbol 레이어로 얹는다.)
      map.addSource(MISSILE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      const missileIcon = makeEmojiIcon(MISSILE_EMOJI, 28);
      if (missileIcon) {
        if (!map.hasImage(MISSILE_IMAGE_ID)) {
          map.addImage(MISSILE_IMAGE_ID, missileIcon.data, { pixelRatio: missileIcon.pixelRatio });
        }
        map.addLayer({
          id: MISSILE_LAYER,
          type: "symbol",
          source: MISSILE_SOURCE,
          layout: {
            "icon-image": MISSILE_IMAGE_ID,
            "icon-size": 1,
            "icon-allow-overlap": true, // 밀집해도 미사일은 항상 보이게
            "icon-ignore-placement": true,
          },
        });
      } else {
        // 캔버스 렌더 실패(구형 환경 등) 시 폴백: 기존 앰버 원.
        map.addLayer({
          id: MISSILE_LAYER,
          type: "circle",
          source: MISSILE_SOURCE,
          paint: {
            "circle-radius": 5,
            "circle-color": "#ffcc33",
            "circle-stroke-color": "#4a2f00",
            "circle-stroke-width": 1.5,
          },
        });
      }

      // B2 집결지 깃발 마커 — 내 집결지 centroid에 🚩. (미사일 마커와 같은 이모지-아이콘 방식.)
      map.addSource(RALLY_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      const rallyIcon = makeEmojiIcon(RALLY_EMOJI, 30);
      if (rallyIcon) {
        if (!map.hasImage(RALLY_IMAGE_ID)) {
          map.addImage(RALLY_IMAGE_ID, rallyIcon.data, { pixelRatio: rallyIcon.pixelRatio });
        }
        map.addLayer({
          id: RALLY_LAYER,
          type: "symbol",
          source: RALLY_SOURCE,
          layout: {
            "icon-image": RALLY_IMAGE_ID,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "bottom", // 깃발 밑동이 동을 가리키게
          },
        });
      } else {
        map.addLayer({
          id: RALLY_LAYER,
          type: "circle",
          source: RALLY_SOURCE,
          paint: {
            "circle-radius": 6,
            "circle-color": "#2ecc71",
            "circle-stroke-color": "#0b3d1f",
            "circle-stroke-width": 2,
          },
        });
      }

      // 미사일 조준 원(마우스 따라다님) — 반투명 흰 채움 + 흰 점선 테두리.
      map.addSource(AIM_CIRCLE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: AIM_CIRCLE_FILL,
        type: "fill",
        source: AIM_CIRCLE_SOURCE,
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: AIM_CIRCLE_LINE,
        type: "line",
        source: AIM_CIRCLE_SOURCE,
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });

      // 공수 사거리 원(목적지 선택 단계) — 출발점 중심, 반경 AIRDROP_MAX_RANGE_DEG. 앰버 옅은 채움 +
      // 점선 테두리. 이 원 밖의 동은 투하 불가(하이라이트도 안 되고 클릭 시 사거리 밖 안내).
      map.addSource(AIRDROP_RANGE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: AIRDROP_RANGE_FILL,
        type: "fill",
        source: AIRDROP_RANGE_SOURCE,
        paint: { "fill-color": "#ffd24a", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: AIRDROP_RANGE_LINE,
        type: "line",
        source: AIRDROP_RANGE_SOURCE,
        paint: {
          "line-color": "#ffd24a",
          "line-width": 2,
          "line-dasharray": [3, 2],
          "line-opacity": 0.9,
        },
      });
      // 조준에 걸린 동의 하얀 반짝 테두리 — feature-state "aim"(0~1)을 rAF가 펄스로 흔든다.
      map.addLayer({
        id: AIM_BLINK_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-width": 3,
          "line-opacity": ["coalesce", ["feature-state", "aim"], 0],
        },
      });

      // 미사일 폭발 충격파 — 주황 플래시(fill) + 확장하는 밝은 링(line). 값은 feature 속성으로 구동.
      map.addSource(EXPLOSION_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: EXPLOSION_FILL,
        type: "fill",
        source: EXPLOSION_SOURCE,
        paint: {
          "fill-color": "#ff7a1a",
          "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0],
        },
      });
      map.addLayer({
        id: EXPLOSION_RING,
        type: "line",
        source: EXPLOSION_SOURCE,
        paint: {
          "line-color": "#fff3c4",
          "line-width": 3,
          "line-blur": 1,
          "line-opacity": ["coalesce", ["get", "opacity"], 0],
        },
      });

      // 우클릭 드래그 공격 화살표 — HOI 스타일 블록 화살표(반투명 주황 채움 + 밝은 테두리). 맨 위에 그린다.
      map.addSource(ATTACK_ARROW_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ATTACK_ARROW_FILL,
        type: "fill",
        source: ATTACK_ARROW_SOURCE,
        paint: { "fill-color": "#ff5a2b", "fill-opacity": 0.55 },
      });
      map.addLayer({
        id: ATTACK_ARROW_LINE,
        type: "line",
        source: ATTACK_ARROW_SOURCE,
        layout: { "line-join": "round" },
        paint: { "line-color": "#ffd9a8", "line-width": 1.5, "line-opacity": 0.95 },
      });

      for (let i = 0; i < prepared.n; i++) {
        map.setFeatureState(
          { source: SOURCE_ID, id: i },
          { owner: paletteIdxOf(world.ownerId[i]), mine: world.ownerId[i] === world.myHolderId }
        );
      }
      for (let i = 0; i < prepared.arcSides.length; i++) {
        setArcState(map, prepared, i);
      }
      updateBadges(map, prepared);
      updateMissileMarkers(map);
      drainMissilesTouched();
      updateRallyMarker(map);
      drainRallyTouched();
      drainDirty(); // applyWelcome이 표시한 all-dirty를 위 초기 페인트로 이미 소진했으므로 비운다.

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

      // 조준용 마우스 추적(맵 전역). 실제 원/타격 계산은 rAF에서 프레임당 1회.
      map.on("mousemove", (e) => {
        lastMouseLngLat = [e.lngLat.lng, e.lngLat.lat];
        const st = useUIStore.getState();
        if (st.isAiming) aimDirty = true;
        if (st.isTransporting && airdropPhase === "source") aimDirty = true;
        // 우클릭을 누른 채 임계 이상 움직이면 드래그 공격으로 확정(내 동에서 시작한 경우만).
        if (rightDownPoint && (e.originalEvent.buttons & 2) !== 0) {
          if (!dragging) {
            const moved = Math.hypot(e.point.x - rightDownPoint.x, e.point.y - rightDownPoint.y);
            if (moved > DRAG_THRESHOLD_PX && rightDownDong >= 0 && world.ownerId[rightDownDong] === world.myHolderId) {
              dragging = true;
              dragSource = rightDownDong;
              dragTargets = reachableTargets(dragSource); // 갈 수 있는 동을 이번 드래그 시작 시 1회 계산
              dragTargetSet = new Set(dragTargets);
              selectDong(map, dragSource, useUIStore.getState().select); // 출발지 강조
            }
          }
          // 갈 수 있는 대상 위면 그 동, 아니면 그 방향으로 갈 수 있는 최대치 동을 가리킨다(resolveDragTarget).
          if (dragging) {
            const t = resolveDragTarget(e.point, [e.lngLat.lng, e.lngLat.lat]);
            if (t >= 0) updateArrow(dragSource, world.meta[t].centroid as [number, number]);
            else updateArrow(-1, null);
          }
        }
      });

      // 좌클릭 = 동 선택. 조준 중이면 = 미사일 발사, 공수 중이면 = 공수 클릭.
      map.on("click", (e) => {
        if (useUIStore.getState().isAiming) {
          fireMissile([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        if (useUIStore.getState().isTransporting) {
          handleAirdropClick(e);
          return;
        }
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const hit = hits[0];
        if (hit && hit.id !== undefined) handleSelect(Number(hit.id), map);
        else selectDong(map, null, useUIStore.getState().select);
      });

      // 우클릭 공격 — 두 방식 공존:
      //  (새) 내 동에서 우클릭을 눌러 화살표를 끌어 대상 동에서 떼면 그 동으로 공격/증원/행군.
      //  (옛) 좌클릭으로 내 동을 선택해 두고 대상 동을 그냥 우클릭해도 동일하게 파견.
      // 임계(px) 미만 움직임이면 '클릭'(옛), 이상이면 '드래그'(새)로 갈린다. 기본 컨텍스트 메뉴는 막는다.
      map.getCanvas().addEventListener("contextmenu", (ev) => ev.preventDefault());
      map.on("contextmenu", () => {
        // 우클릭 = 공수 취소(그 외 공격은 mousedown/mouseup 드래그가 처리하므로 여기선 안 함).
        const st = useUIStore.getState();
        if (st.isTransporting) st.setTransporting(false);
      });

      map.on("mousedown", (e) => {
        if (e.originalEvent.button !== 2) return; // 우클릭만
        const st = useUIStore.getState();
        if (st.isAiming || st.isTransporting) return; // 특수 모드 중엔 우클릭 공격 비활성
        // 누른 지점·동만 기록해 둔다. 드래그 확정은 mousemove의 임계 판정이 한다.
        rightDownPoint = { x: e.point.x, y: e.point.y };
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        rightDownDong = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
        dragging = false;
        dragSource = -1;
      });

      map.on("mouseup", (e) => {
        if (e.originalEvent.button !== 2 || !rightDownPoint) return; // 우클릭 뗄 때만
        const wasDragging = dragging;
        const from = dragSource;
        // 드래그면 화살표가 가리키던 대상(그 방향 최대치)을 그대로 쓴다 — 리셋 전에 계산.
        const dragTarget = wasDragging ? resolveDragTarget(e.point, [e.lngLat.lng, e.lngLat.lat]) : -1;

        rightDownPoint = null; // 상태 리셋
        rightDownDong = -1;
        dragging = false;
        dragSource = -1;
        dragTargets = [];
        dragTargetSet = new Set();
        updateArrow(-1, null); // 화살표 지우기

        if (wasDragging) {
          if (dragTarget >= 0) doAttack(from, dragTarget, connection); // 새: 화살표가 가리킨 동으로
        } else {
          const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
          const target = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
          if (target >= 0) doAttackFromSelected(target, connection); // 옛: 좌클릭 선택 동 → 클릭한 대상
        }
      });

      // 더블클릭 = 집결지 지정/해제(B2). 내 동을 더블클릭하면 집결지로, 현재 집결지를 다시 더블클릭하면 해제.
      map.on("dblclick", (e) => {
        const st = useUIStore.getState();
        if (st.isAiming || st.isTransporting) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const hit = hits[0];
        if (hit && hit.id !== undefined) handleSetRally(Number(hit.id), connection);
      });

      useUIStore.getState().setPhase("ready");
      useUIStore.getState().refreshSummary();
    });

    // README.md §4.5 — 물리 키(e.code) 사용, 한글 IME 조합 중에는 무시.
    // WASD/화살표는 '눌린 방향'만 pressed에 모아두고, 렌더 루프가 매 프레임 일정 속도로
    // 부드럽게 패닝한다(키다운마다 툭툭 끊기거나 OS 키 리핏 속도에 휘둘리지 않도록).
    // 대각선(두 키 동시)·일정 속도·키 리핏 무관이 자연스러운 이동의 핵심. 줌·미사일 키는 단발.
    const PAN_SPEED = 800; // 패닝 속도(px/초)
    const DIR: Record<string, "up" | "down" | "left" | "right"> = {
      KeyW: "up",
      ArrowUp: "up",
      KeyS: "down",
      ArrowDown: "down",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
    };
    const pressed = new Set<"up" | "down" | "left" | "right">();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      // 입력창(닉네임 등)에 포커스가 있으면 지도 조작으로 가로채지 않는다.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Esc = 미사일 조준 / 공수 모드 취소
      if (e.code === "Escape") {
        const st = useUIStore.getState();
        if (st.isAiming) {
          st.setAiming(false);
          return;
        }
        if (st.isTransporting) {
          st.setTransporting(false);
          return;
        }
      }
      // Space = 미사일 조준 모드 토글. (Space는 기본 스크롤/버튼 클릭을 유발하므로 막는다.)
      if (e.code === "Space") {
        e.preventDefault();
        const st = useUIStore.getState();
        if (!st.isAiming && st.missileCount === 0) {
          st.showToast("보유한 미사일이 없습니다.");
          return;
        }
        const next = !st.isAiming;
        st.setAiming(next);
        if (next && st.isTransporting) st.setTransporting(false); // 공수 중이었으면 해제하고 조준으로
        return;
      }
      // Left Shift = 공수부대(병력 수송) 모드 토글 (오른쪽 아래 버튼과 동일 동작).
      if (e.code === "ShiftLeft") {
        if (e.repeat) return; // 키를 누르고 있을 때의 리핏으로 반복 토글되지 않게.
        e.preventDefault();
        const st = useUIStore.getState();
        if (st.isTransporting) {
          st.setTransporting(false);
        } else if (st.airdropCooldownLeft > 0) {
          // 진입 차단은 버튼 disabled(쿨다운 중 && 비수송)과 동일.
          st.showToast(`공수 재사용까지 ${Math.ceil(st.airdropCooldownLeft / 1000)}초`);
        } else {
          st.setTransporting(true); // aiming은 setTransporting이 알아서 끈다.
        }
        return;
      }
      // 이동 키: 방향만 기록(연속 패닝은 렌더 루프가 담당). 화살표 기본 스크롤 방지.
      const dir = DIR[e.code];
      if (dir) {
        pressed.add(dir);
        e.preventDefault();
        return;
      }
      // 줌은 단발.
      switch (e.code) {
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
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = DIR[e.code];
      if (dir) pressed.delete(dir);
    };
    // 창이 포커스를 잃으면 keyup을 놓쳐 키가 '눌린 채' 남는 것을 방지(멈춤).
    const onBlur = () => pressed.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // 렌더 루프 — 서버가 보낸 world(사본)의 변경분만 반영한다. 게임 로직(생산·전투)은
    // 서버(로컬 mock)가 돌린다. 여기선 (1) 도착 유닛 제거 (2) dirty 배치 리페인트
    // (3) 이동 유닛 원 보간만 한다. (README §7.3, plan.md §3)
    let raf = 0;
    let lastSummaryAt = 0;
    let hadUnits = false;
    let lastPanNow = 0; // WASD 연속 패닝용 직전 프레임 시각
    const flashing = new Map<number, number>(); // admIndex → 플래시 시작 시각
    const loop = (now: number) => {
      // WASD/화살표 연속 패닝 — 눌린 방향으로 매 프레임 dt(초)만큼 부드럽게 이동.
      const dt = lastPanNow ? Math.min(0.05, (now - lastPanNow) / 1000) : 0; // dt 상한: 탭 복귀 시 급점프 방지
      lastPanNow = now;
      if (pressed.size > 0) {
        const dx = ((pressed.has("right") ? 1 : 0) - (pressed.has("left") ? 1 : 0)) * PAN_SPEED * dt;
        const dy = ((pressed.has("down") ? 1 : 0) - (pressed.has("up") ? 1 : 0)) * PAN_SPEED * dt;
        if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: false });
      }

      // 소스가 아직 없으면(load 핸들러 전) 아무것도 하지 않는다 — dirty를 소진하지 않아 보존된다.
      if (!map.getSource(SOURCE_ID)) {
        raf = requestAnimationFrame(loop);
        return;
      }
      pruneArrivedOrders(now); // 도착 유닛 시각 제거(실제 상태 변화는 DELTA cells로 옴)

      const changed = drainDirty();
      if (changed.length > 0) {
        // 소유권이 바뀐 동 + 그 동에 접한 아크만 다시 계산해 국경선을 갱신한다.
        const arcsToUpdate = new Set<number>();
        for (const idx of changed) {
          map.setFeatureState(
            { source: SOURCE_ID, id: idx },
            { owner: paletteIdxOf(world.ownerId[idx]), mine: world.ownerId[idx] === world.myHolderId }
          );
          for (const ai of prepared.dongArcs[idx]) arcsToUpdate.add(ai);
        }
        for (const ai of arcsToUpdate) setArcState(map, prepared, ai);
        updateBadges(map, prepared);
      }

      // 함락 플래시 — 새 함락은 시작 시각 기록, 매 프레임 흰색을 페이드아웃.
      for (const idx of drainCaptureFlashes()) flashing.set(idx, now);
      for (const [idx, start] of flashing) {
        const a = 1 - (now - start) / FLASH_MS;
        if (a <= 0) {
          map.setFeatureState({ source: SOURCE_ID, id: idx }, { flash: 0 });
          flashing.delete(idx);
        } else {
          map.setFeatureState({ source: SOURCE_ID, id: idx }, { flash: a * 0.6 });
        }
      }

      // 이동 중인 유닛 원 위치를 매 프레임 갱신. 없으면 마지막에 한 번 비운다.
      if (world.orders.length > 0) {
        updateUnits(map, now);
        hadUnits = true;
      } else if (hadUnits) {
        updateUnits(map, now);
        hadUnits = false;
      }

      // 집결지를 잃으면(적에게 함락/미사일 등) 로컬 마커·상태도 정리한다(서버도 보급을 자동 해제).
      if (world.myRally >= 0 && world.ownerId[world.myRally] !== world.myHolderId) setMyRally(-1);
      // 미사일 마커(스폰/소모 시 갱신)
      if (drainMissilesTouched()) updateMissileMarkers(map);
      // 집결지 깃발(지정/해제 시 갱신)
      if (drainRallyTouched()) updateRallyMarker(map);

      // 재시작으로 새 시작 동을 배정받으면 그 동으로 카메라를 옮긴다(어디서 시작했는지 안 보이던 문제).
      const respawnCell = drainRespawnCell();
      if (respawnCell !== null) {
        map.flyTo({ center: world.meta[respawnCell].centroid as [number, number], zoom: 11, duration: 1200 });
      }

      // 미사일 조준: 원/타격 갱신 + 걸린 동의 하얀 반짝 펄스
      const aimingNow = useUIStore.getState().isAiming;
      if (aimingNow) {
        if (!wasAiming) aimDirty = true; // 조준 시작 → 즉시 한 번 그린다
        if (aimDirty && lastMouseLngLat) {
          updateAim(lastMouseLngLat, aimedSet, false);
          aimDirty = false;
        }
        const pulse = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(now / 140));
        for (const idx of aimedSet) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: pulse });
        map.getCanvas().style.cursor = "crosshair";
      } else if (wasAiming) {
        clearAim(aimedSet);
        map.getCanvas().style.cursor = "";
      }
      wasAiming = aimingNow;

      // 공수(병력 수송) 조준: source 단계는 원으로 내 동 선택, dest 단계는 커서 아래 목적지 하이라이트.
      const transportingNow = useUIStore.getState().isTransporting;
      if (transportingNow) {
        if (!wasTransporting) aimDirty = true; // 진입 즉시 한 번 그린다
        if (airdropPhase === "source") {
          if (aimDirty && lastMouseLngLat) {
            updateAim(lastMouseLngLat, airdropSet, true);
            aimDirty = false;
          }
        } else if (lastMouseLngLat) {
          const p = map.project(lastMouseLngLat);
          const feats = map.queryRenderedFeatures(p, { layers: [FILL_LAYER] });
          const id = feats.length > 0 && feats[0].id !== undefined ? Number(feats[0].id) : -1;
          if (id !== destHover) {
            if (destHover >= 0 && !airdropSet.has(destHover)) {
              map.setFeatureState({ source: SOURCE_ID, id: destHover }, { aim: 0 });
            }
            destHover = id;
          }
        }
        const pulse = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(now / 140));
        for (const idx of airdropSet) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: pulse });
        let destOk = true;
        if (airdropPhase === "dest" && destHover >= 0) {
          destOk = airdropInRange(airdropSources, destHover); // 사거리 안일 때만 흰 펄스
          map.setFeatureState({ source: SOURCE_ID, id: destHover }, { aim: destOk ? pulse : 0 });
        }
        map.getCanvas().style.cursor = airdropPhase === "dest" && !destOk ? "not-allowed" : "crosshair";
      } else if (wasTransporting) {
        clearAirdrop();
        map.getCanvas().style.cursor = "";
      }
      wasTransporting = transportingNow;

      // 미사일 폭발 충격파 — 중립화된 동(=착탄)에서 터뜨린다. 전원 공통(DELTA 기반).
      const impacts = drainMissileImpacts();
      if (impacts.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const idx of impacts) {
          sx += world.meta[idx].centroid[0];
          sy += world.meta[idx].centroid[1];
        }
        const cx = sx / impacts.length;
        const cy = sy / impacts.length;
        let maxd = 0;
        for (const idx of impacts) {
          const c = world.meta[idx].centroid;
          const d = Math.hypot(c[0] - cx, c[1] - cy);
          if (d > maxd) maxd = d;
        }
        explosions.push({ cx, cy, r: Math.max(maxd + RADIUS * 0.5, RADIUS), start: now });
      }
      if (explosions.length > 0) {
        const active = explosions.filter((ex) => now - ex.start < EXPLOSION_MS);
        explosions.length = 0;
        explosions.push(...active);
        const feats = active.map((ex) => {
          const t = (now - ex.start) / EXPLOSION_MS;
          const cosLat = Math.cos((ex.cy * Math.PI) / 180);
          const rr = ex.r * (0.3 + t * 1.1); // 안에서 밖으로 퍼진다
          return {
            type: "Feature" as const,
            properties: { opacity: 1 - t, fillOpacity: Math.max(0, 0.5 * (1 - t * 2)) },
            geometry: { type: "Polygon" as const, coordinates: [ringCoords(ex.cx, ex.cy, rr, cosLat, 40)] },
          };
        });
        (map.getSource(EXPLOSION_SOURCE) as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: feats,
        });
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
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
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
  const oa = a >= 0 ? world.ownerId[a] : -1;
  const ob = b >= 0 ? world.ownerId[b] : -1; // -1 = 지도 바깥
  const frontier = oa !== ob;
  const pIdx = paletteIdxOf(borderHolder(oa, ob));
  map.setFeatureState(
    { source: ARC_SOURCE, id: i },
    { frontier, color: (PALETTE[pIdx] ?? PALETTE[0]).stroke }
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

// 우클릭 드래그 공격: 출발지(from)에서 대상(to)으로 병력 파견(서버에 명령 전송).
//  · 인접 적/중립 → 전투    · 인접 내 동 → 증원    · 먼 내 동 → 경로 자동 출정(B1, 내 영토 따라 연쇄)
// 실제 처리는 서버(로컬 mock)가 하고, 결과는 DELTA(채움·국경·유닛)/ERROR(토스트)로 돌아온다.
function doAttack(from: number, to: number, connection: Connection) {
  const { showToast, sortieRatio } = useUIStore.getState();

  if (from < 0 || world.ownerId[from] !== world.myHolderId) return; // 출발지가 내 동이 아니면 무시
  if (from === to) return; // 같은 동에 놓으면 취소

  const adjacent = world.neighborIndex[from]?.includes(to) ?? false;

  // 인접이 아니면: 내 동이면 경로 자동 출정(B1), 아니면 공격은 인접만 가능함을 안내.
  if (!adjacent) {
    if (world.ownerId[to] === world.myHolderId) {
      connection.sendMarch(from, to, sortieRatio);
    } else {
      showToast("먼 내 동은 자동 행군, 공격은 인접 동만 가능합니다.");
    }
    return;
  }

  // 인접 증원인데 이미 가득 찼으면(여유 0) 보낼 게 없으니 왕복 전에 막는다.
  // (여유가 있으면 그대로 보내고, 서버가 상한 여유분만큼만 잘라서 증원한다.)
  if (world.ownerId[to] === world.myHolderId && world.troops[to] >= world.troopCap[to]) {
    showToast("이미 병력이 가득 찬 동입니다.");
    return;
  }

  // 이번 출정에 보낼 병력 비율 = 오른쪽 아래 슬라이더 값.
  connection.sendSortie(from, to, sortieRatio);
}

// 옛 방식(드래그 없이 우클릭한 경우): 좌클릭으로 선택해 둔 내 동을 출발지로 삼아 대상으로 파견한다.
function doAttackFromSelected(to: number, connection: Connection) {
  const { selectedIndex, showToast } = useUIStore.getState();
  if (selectedIndex === null || world.ownerId[selectedIndex] !== world.myHolderId) {
    showToast("먼저 내 동을 좌클릭으로 선택하세요.");
    return;
  }
  doAttack(selectedIndex, to, connection);
}

// 드래그 공격에서 이 출발지로부터 '갈 수 있는' 동 목록:
//  · 행군/증원 가능한 내 영토 연결요소(소유 인접으로 이어진 내 동들, 출발지 제외)
//  · 공격 가능한 인접 적/중립(1홉)
// 커서가 유효 대상 밖일 때 '그 방향으로 갈 수 있는 최대치'를 이 목록 중 커서 최근접으로 고른다.
function reachableTargets(source: number): number[] {
  const me = world.myHolderId;
  const out: number[] = [];
  const seen = new Uint8Array(world.n);
  seen[source] = 1;
  const q = [source];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur !== source) out.push(cur); // 내 영토 연결요소(행군/증원 대상)
    for (const nb of world.neighborIndex[cur]) {
      if (!seen[nb] && world.ownerId[nb] === me) {
        seen[nb] = 1;
        q.push(nb);
      }
    }
  }
  for (const nb of world.neighborIndex[source]) {
    if (!seen[nb] && world.ownerId[nb] !== me) {
      seen[nb] = 1;
      out.push(nb); // 인접 적/중립(공격 대상, 1홉)
    }
  }
  return out;
}

// 우클릭 드래그 공격 화살표 지오메트리 — HOI(하츠오브아이언) 스타일 블록 화살표 폴리곤 하나.
// 얇게 시작해 넓어지는 테이퍼 샤프트 + 그보다 넓은 삼각 촉으로 굵고 또렷한 공세 화살표를 만든다.
// 경도는 위도에 따라 실제 거리가 달라 cosLat로 스케일해 방향/수직 벡터를 계산한 뒤 lng/lat로 환산한다.
function arrowPolygon(a: [number, number], b: [number, number]) {
  const cosLat = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1;
  const dx = (b[0] - a[0]) * cosLat;
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];

  const ux = dx / len; // 진행 방향(단위)
  const uy = dy / len;
  const px = -uy; // 왼쪽 수직(단위)
  const py = ux;

  // 동 중심 간 거리가 너무 짧으면 폭이 길이보다 커져 화살표가 뭉개진다. 렌더 길이에 최소값을 둬서
  // (짧을 땐 대상 방향으로 살짝만 연장) 폭·촉을 그 길이에 비례시켜 항상 화살표 비율을 유지한다.
  const MIN_LEN = 0.009;
  const eff = Math.max(len, MIN_LEN);

  // 얇게 시작해 촉으로 갈수록 넓어지는 형태(폭은 렌더 길이에 비례, 상한만 둠).
  const shaftW = Math.min(0.0038, eff * 0.055); // 촉 밑변쪽 샤프트 반폭
  const startW = shaftW * 0.5; // 시작부는 얇게
  const headW = shaftW * 2.0; // 화살촉 날개 반폭(가장 넓음)
  const headLen = Math.min(eff * 0.5, Math.max(eff * 0.28, headW * 1.4)); // 화살촉 길이
  const baseLen = eff - headLen; // 샤프트 끝(=촉 밑변)까지 거리

  // 스케일 공간 (진행거리 along, 수직 side) → lng/lat.
  const P = (along: number, side: number): [number, number] => [
    a[0] + (ux * along + px * side) / cosLat,
    a[1] + (uy * along + py * side),
  ];

  const ring: [number, number][] = [
    P(0, startW), // 시작부 왼쪽(얇음)
    P(baseLen, shaftW), // 촉 밑변 왼쪽(넓어짐)
    P(baseLen, headW), // 촉 왼쪽 날개(가장 넓음)
    P(eff, 0), // 뾰족한 끝(짧으면 대상 너머로 약간 연장)
    P(baseLen, -headW), // 촉 오른쪽 날개
    P(baseLen, -shaftW), // 촉 밑변 오른쪽
    P(0, -startW), // 시작부 오른쪽(얇음)
    P(0, startW), // 닫기
  ];
  return [
    { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } },
  ];
}

// 더블클릭으로 호출: 내 동을 집결지로 설정, 현재 집결지를 다시 더블클릭하면 해제한다(B2).
// 마커·요약은 낙관적으로 즉시 반영(setMyRally)하고, 서버는 sendRally로 검증·저장한다.
function handleSetRally(idx: number, connection: Connection) {
  const { showToast, rallyIndex } = useUIStore.getState();
  if (world.ownerId[idx] !== world.myHolderId) {
    showToast("내 동만 집결지로 지정할 수 있습니다.");
    return;
  }
  if (rallyIndex === idx) {
    connection.sendRally(-1);
    setMyRally(-1);
    showToast("집결지를 해제했습니다.");
  } else {
    connection.sendRally(idx);
    setMyRally(idx);
    showToast(`집결지: ${world.meta[idx].name}`);
  }
}

// 이모지를 캔버스에 렌더해 지도 아이콘(addImage)용 픽셀 데이터로 만든다. glyphs 서버가 없어
// symbol text-field로는 컬러 이모지를 못 그리므로 래스터 아이콘으로 얹기 위한 것. sizePx는
// CSS 픽셀 기준 논리 크기이고, devicePixelRatio만큼 확대 렌더 후 pixelRatio로 되돌려 선명하게.
function makeEmojiIcon(
  emoji: string,
  sizePx: number
): { data: ImageData; pixelRatio: number } | null {
  const ratio = Math.max(1, Math.min(4, Math.round(window.devicePixelRatio || 1)));
  const px = sizePx * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `${Math.floor(px * 0.82)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, px / 2, px / 2);
  return { data: ctx.getImageData(0, 0, px, px), pixelRatio: ratio };
}

// 공수부대 삼각형 유닛 아이콘 — 흰 삼각형 + 어두운 외곽선을 캔버스에 그려 addImage용 픽셀 데이터로.
// (원 유닛과 한눈에 구분되게 위를 향한 삼각형. glyphs 없이 쓰려고 이미지로 얹는다.)
function makeTriangleIcon(sizePx: number): { data: ImageData; pixelRatio: number } | null {
  const ratio = Math.max(1, Math.min(4, Math.round(window.devicePixelRatio || 1)));
  const px = sizePx * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.beginPath();
  ctx.moveTo(px / 2, px * 0.14);
  ctx.lineTo(px * 0.9, px * 0.86);
  ctx.lineTo(px * 0.1, px * 0.86);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = Math.max(1, px * 0.07);
  ctx.strokeStyle = "#1b2430";
  ctx.stroke();
  return { data: ctx.getImageData(0, 0, px, px), pixelRatio: ratio };
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
      properties: { troops: world.troops[m.admIndex], name: m.name },
      geometry: { type: "Point", coordinates: m.centroid },
    })),
  });
}

// 이동 중인 유닛을 출발지→목적지 사이 보간 위치에 그린다. 일반 출정/보급은 원(UNIT_SOURCE),
// 공수부대(order.airdrop)는 삼각형(AIRDROP_UNIT_SOURCE)으로 나눠 그린다. 둘 다 옆/아래에 병력 수.
function updateUnits(map: MaplibreMap, now: number) {
  const src = map.getSource(UNIT_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  const triSrc = map.getSource(AIRDROP_UNIT_SOURCE) as GeoJSONSource | undefined;
  const toFeature = (o: (typeof world.orders)[number]) => {
    const span = o.arriveTick - o.departTick;
    const t = span > 0 ? Math.min(1, Math.max(0, (now - o.departTick) / span)) : 1;
    const a = world.meta[o.from].centroid;
    const b = world.meta[o.to].centroid;
    return {
      type: "Feature" as const,
      properties: { amount: o.amount, paletteIdx: paletteIdxOf(o.holderId) },
      geometry: {
        type: "Point" as const,
        coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      },
    };
  };
  src.setData({
    type: "FeatureCollection",
    features: world.orders.filter((o) => !o.airdrop).map(toFeature),
  });
  triSrc?.setData({
    type: "FeatureCollection",
    features: world.orders.filter((o) => o.airdrop).map(toFeature),
  });
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

// 내 첫 영토 동의 중심 — 시작 시 카메라를 여기로. 내 동이 없으면 전체 무게중심.
function myStartCenter(prepared: PreparedMap): [number, number] {
  for (let i = 0; i < world.n; i++) {
    if (world.ownerId[i] === world.myHolderId) return world.meta[i].centroid;
  }
  return averageCenter(prepared);
}

// holderId → 그 holder의 paletteIdx (색 슬롯). holder 미등록/미상은 중립(0).
function paletteIdxOf(holderId: number): number {
  return world.holders.get(holderId)?.paletteIdx ?? 0;
}

// 원(center=[lng,lat], 반경 r; 경도는 cosLat로 스케일)과 폴리곤이 조금이라도 겹치는가.
// 중심이 폴리곤 안 · 꼭짓점이 원 안 · 변이 원에 근접, 셋 중 하나면 겹침으로 본다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function circleHitsPoly(cx: number, cy: number, r: number, cosLat: number, geom: any): boolean {
  const polys: number[][][][] =
    geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
  const r2 = r * r;
  for (const poly of polys) {
    if (pointInRing(cx, cy, poly[0])) return true;
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (scaledDist2(cx, cy, ring[i][0], ring[i][1], cosLat) <= r2) return true;
        if (segDist2(cx, cy, ring[i][0], ring[i][1], ring[j][0], ring[j][1], cosLat) <= r2) return true;
      }
    }
  }
  return false;
}

// 경도차를 cosLat로 스케일한 제곱거리(작은 원 안에서 원처럼 취급하기 위함).
function scaledDist2(ax: number, ay: number, bx: number, by: number, cosLat: number): number {
  const dx = (ax - bx) * cosLat;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// 점(px,py)에서 선분(a→b)까지의 스케일 제곱거리.
function segDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cosLat: number
): number {
  const ex = (bx - ax) * cosLat;
  const ey = by - ay;
  const wx = (px - ax) * cosLat;
  const wy = py - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? (wx * ex + wy * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - t * ex;
  const dy = wy - t * ey;
  return dx * dx + dy * dy;
}

// 원 링 폴리곤 좌표(경도는 cosLat 보정). 폭발 충격파 그리기에 사용.
function ringCoords(cx: number, cy: number, r: number, cosLat: number, steps: number): [number, number][] {
  const out: [number, number][] = [];
  const rLng = r / cosLat;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([cx + Math.cos(a) * rLng, cy + Math.sin(a) * r]);
  }
  return out;
}

// 링(ring) 내부에 점(px,py)이 있는가 — 표준 레이캐스트.
function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// paletteIdx(keyExpr가 가리키는 값) → PALETTE 색 매칭 expression. 매칭 실패 시 중립색 fallback.
function buildPaletteMatchExpr(keyExpr: unknown, kind: "fill" | "stroke") {
  const expr: unknown[] = ["match", keyExpr];
  PALETTE.forEach((c, idx) => {
    expr.push(idx, kind === "fill" ? c.fill : c.stroke);
  });
  expr.push(kind === "fill" ? PALETTE[0].fill : PALETTE[0].stroke);
  return expr as never;
}
