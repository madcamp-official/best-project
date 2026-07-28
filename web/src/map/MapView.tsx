import { useEffect, useRef } from "react";
import { AttributionControl, Map as MaplibreMap, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 웹워커(타일 파싱·렌더 백엔드) URL을 명시 지정. 기본 동작은 메인 모듈의
// import.meta.url 기준 상대 경로(./maplibre-gl-worker.mjs)라서 Vite 프로덕션 번들에선
// /assets/maplibre-gl-worker.mjs 404 → 지도가 통째로 빈 화면이 된다(dev는 node_modules
// 직서빙이라 멀쩡해 눈에 안 띔). ?worker&url = 워커를 의존성까지 자립 청크로 번들한 URL.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
setWorkerUrl(maplibreWorkerUrl);
import type { PreparedMap } from "../data/loadMapData";
import {
  world,
  airdropInRange,
  airdropOrigin,
  drainDirty,
  pruneArrivedOrders,
  drainCaptureFlashes,
  drainMissilesTouched,
  drainMissileImpacts,
  drainRespawnCell,
  toggleMyAttackTarget,
  drainAttackQueueTouched,
  pruneCapturedAttackTargets,
  enclosedSet,
  drainEnclosedTouched,
} from "../world/worldView";
import type { Connection } from "../net/connection";
import { useUIStore } from "../store/uiStore";
import { CONFIG, PALETTE } from "../config";
import { RUNTIME_CONFIG } from "../game/runtimeConfig";

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
const ENCLOSED_LAYER = "dong-enclosed-blink"; // 포위(귀속 대기)된 동의 반짝임 채움
const ARC_SOURCE = "arcs";
const ADMIN_SGG_LAYER = "admin-sgg-boundary"; // 시군구 경계 — 소유권과 무관한 정적 강조선
const ADMIN_SIDO_LAYER = "admin-sido-boundary"; // 시도 경계 — 시군구보다 더 굵고 진하게
const OWNED_DOT_SOURCE = "owned-dots"; // 저줌 최소 시인성 — 동 폴리곤이 화면상 안 보일 만큼 작아도
const OWNED_DOT_LAYER = "owned-dots-layer"; // 점으로는 항상 보이게(막 시작한 상대도 눈에 띄도록)
const PLAYER_LABEL_SOURCE = "player-labels"; // 플레이어별 영토 중심에 닉네임 — 도 단위가 보일 정도로
const PLAYER_LABEL_LAYER = "player-labels-layer"; // 축소했을 때만(maxzoom) 표시, 동 단위 확대 시엔 숨김
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
const NUKE_SOURCE = "nuke-silos"; // 전술핵 사일로(제주) 고정 마커
const NUKE_LAYER = "nuke-silos-layer";
const NUKE_IMAGE_ID = "nuke-silo-icon"; // 일반 미사일보다 훨씬 큰 로켓 = 사일로 표식
const ATTACK_QUEUE_SOURCE = "attack-queue"; // 공격 큐 ⚔️ 마커(내 큐 대상마다)
const ATTACK_QUEUE_LAYER = "attack-queue-layer";
const ATTACK_QUEUE_IMAGE_ID = "attack-queue-icon"; // addImage로 얹는 ⚔️ 아이콘 이름
const ATTACK_QUEUE_EMOJI = "⚔️";
const AIM_CIRCLE_SOURCE = "aim-circle";
const AIM_CIRCLE_FILL = "aim-circle-fill";
const AIM_CIRCLE_LINE = "aim-circle-line";
const AIRDROP_RANGE_SOURCE = "airdrop-range"; // 공수 사거리 원(목적지 선택 단계)
const AIRDROP_RANGE_FILL = "airdrop-range-fill";
const AIRDROP_RANGE_LINE = "airdrop-range-line";
const AIM_BLINK_LAYER = "dong-aim-blink"; // 조준에 걸린 동의 하얀 반짝 테두리
const SHIELD_SOURCE = "spawn-shield"; // 스폰 방어막 돔(신규 참가·재시작 후 SPAWN_SHIELD_SEC초 보호)
const SHIELD_FILL = "spawn-shield-fill";
const SHIELD_LINE = "spawn-shield-line";
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
// 출정은 항상 전 병력(100%) — 비율 슬라이더는 제거됨. (드래그 이동/쓸기·행군이 공유)
const SORTIE_SEND_RATIO = 1;

// 셀 이름·병력 배지가 보이기 시작하는 줌 임계. 이 지도(kr-sgg 시군구)는 셀 하나가 옛 법정동보다
// 훨씬 커서, 동 기준으로 튜닝됐던 값(10)을 그대로 쓰면 한참 확대해야만 이름·병력이 보였다.
// 시군구 스케일에 맞춰 낮춰, 전국 개요에서 살짝만 확대하면 시/군/구 이름과 병력이 뜨게 한다.
// NAME/BADGE는 이 줌 이상에서, 저줌 점(OWNED_DOT)·닉네임 라벨은 이 줌 미만에서 표시 —
// 같은 값을 공유해 두 오버레이가 겹치지 않고 한 지점에서 깔끔히 교대한다.
const LABEL_MIN_ZOOM = 7;

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
      // 전국을 살짝 보여준 뒤(줌 아웃 상태로 시작) load 핸들러 끝에서 내 시작 동으로 flyTo —
      // 재시작 때와 같은 "확대돼서 어디 배정받았는지 보이는" 연출을 최초 접속에도 준다.
      center: averageCenter(prepared),
      zoom: 6.4,
      attributionControl: false,
      doubleClickZoom: false, // 더블클릭 확대 비활성화 (동을 빠르게 두 번 클릭할 때 오확대 방지)
      // 이 지도 실제 영역 밖으로는 못 나가게 고정 — renderWorldCopies 기본값(true)은 줌아웃 시
      // 지도를 옆으로 무한 반복해서 그려 계속 스크롤할 수 있게 만드는데(세계지도에서 특히 눈에
      // 띔), 이 둘을 같이 꺼야 "딱 이 지도 범위 안"으로 팬/줌이 제한된다.
      maxBounds: computeMapBounds(prepared),
      renderWorldCopies: false,
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
      Object.assign(window, { __map: map, __world: world, __arrowPolygon: arrowPolygon });
    }

    map.on("error", (e) => {
      console.error("[maplibre error]", e.error);
    });

    // ── 미사일 조준 상태(이 이펙트 수명 동안 유지되는 명령형 상태) ──
    // 지도별로 스케일이 다른 값(RUNTIME_CONFIG, 서버 WELCOME에서 옴) — 시군구는 법정동보다
    // 훨씬 큰 반경을 쓴다(runtimeConfig.ts 참조). 이펙트는 prepared(지도)가 바뀔 때마다 다시
    // 마운트되므로 매 라운드 최신 값을 담는다.
    const RADIUS = RUNTIME_CONFIG.MISSILE_RADIUS_DEG;
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

    // 내 공격 큐 대상마다 ⚔️ 마커를 그린다. 비었으면 소스를 비운다.
    const updateAttackQueueMarker = (m: MaplibreMap) => {
      const src = m.getSource(ATTACK_QUEUE_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      const features = Array.from(world.myAttackQueue)
        .filter((idx) => idx >= 0 && idx < world.n)
        .map((idx) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: world.meta[idx].centroid },
        }));
      src.setData({ type: "FeatureCollection", features });
    };

    // 방어막 돔 갱신 — 지금(Date.now() 기준) 보호 중인 모든 holder의 현재 영토를 감싸는 동심원
    // 돔을 그린다. 영토가 넓어지면(방어막 동안 확장) 반경도 같이 커진다. 안쪽일수록 밝은 원을
    // 겹쳐 그려 유리 돔처럼 보이게 하고, now 기반 사인파로 아주 은은하게 숨쉬듯 흔든다.
    let shieldWasActive = false;
    const updateShieldDomes = (m: MaplibreMap, now: number) => {
      const src = m.getSource(SHIELD_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      const wallNow = Date.now();
      const activeHolders: number[] = [];
      for (let h = 1; h < 256; h++) if (world.shieldUntil[h] > wallNow) activeHolders.push(h);

      if (activeHolders.length === 0) {
        if (shieldWasActive) {
          src.setData({ type: "FeatureCollection", features: [] });
          shieldWasActive = false;
        }
        return;
      }
      shieldWasActive = true;

      const pulse = 1 + Math.sin(now / 450) * 0.035; // 아주 은은한 숨쉬기 효과
      const features: {
        type: "Feature";
        properties: { opacity: number; lineOpacity: number; lineWidth: number };
        geometry: { type: "Polygon"; coordinates: [number, number][][] };
      }[] = [];
      for (const holderId of activeHolders) {
        let sx = 0;
        let sy = 0;
        let cnt = 0;
        for (let i = 0; i < world.n; i++) {
          if (world.ownerId[i] !== holderId) continue;
          sx += world.meta[i].centroid[0];
          sy += world.meta[i].centroid[1];
          cnt++;
        }
        if (cnt === 0) continue; // 방어막은 있지만 지금은 소유 동 0개(궤멸 직후 등) — 그릴 게 없음
        const cx = sx / cnt;
        const cy = sy / cnt;
        let maxD = 0;
        for (let i = 0; i < world.n; i++) {
          if (world.ownerId[i] !== holderId) continue;
          const c = world.meta[i].centroid;
          const dx = c[0] - cx;
          const dy = c[1] - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > maxD) maxD = d;
        }
        const baseR = (maxD + 0.045) * pulse; // 영토 전체를 여유 있게 감싸는 반경 + 펄스
        const cosLat = Math.cos((cy * Math.PI) / 180);
        // 겹치는 3겹 동심원(바깥→안쪽 순서로 그려야 안쪽이 위에 덮인다): 바깥은 옅고 테두리만
        // 뚜렷하게, 안쪽일수록 채움이 밝아져 유리 돔에 빛이 모인 느낌을 낸다.
        const rings = [
          { mul: 1.0, opacity: 0.05, lineOpacity: 0.5, lineWidth: 2 },
          { mul: 0.7, opacity: 0.06, lineOpacity: 0, lineWidth: 0 },
          { mul: 0.4, opacity: 0.09, lineOpacity: 0, lineWidth: 0 },
        ];
        for (const ring of rings) {
          const r = baseR * ring.mul;
          const rLng = r / cosLat;
          const coords: [number, number][] = [];
          for (let i = 0; i <= 56; i++) {
            const a = (i / 56) * 2 * Math.PI;
            coords.push([cx + Math.cos(a) * rLng, cy + Math.sin(a) * r]);
          }
          features.push({
            type: "Feature",
            properties: { opacity: ring.opacity, lineOpacity: ring.lineOpacity, lineWidth: ring.lineWidth },
            geometry: { type: "Polygon", coordinates: [coords] },
          });
        }
      }
      src.setData({ type: "FeatureCollection", features });
    };

    // 우클릭 두 방식 공존 — '눌렀다 뗀' 지점 이동이 임계(px) 미만이면 '클릭'으로 보고 커서 아래
    // 지역을 공격 큐에 토글하고, 내 동에서 시작해 임계 이상 끌면 '드래그'로 확정해 예전 방식의
    // 병력 이동(화살표 단일 파견 / 인접 적·중립 쓸기 일괄 출정 / 먼 내 동 행군)을 실행한다.
    const RIGHT_CLICK_THRESHOLD_PX = 6;
    let rightDownPoint: { x: number; y: number } | null = null;
    let rightDownDong = -1; // 우클릭이 눌린 동(내 동일 때만 드래그 출발지가 된다)
    let dragging = false;
    let dragSource = -1;
    let dragTargets: number[] = []; // 이번 드래그에서 갈 수 있는 동들(드래그 확정 시 1회 계산)
    let dragTargetSet = new Set<number>();
    // 드래그 쓸기: 커서가 지나간 '인접 적·중립' 목표를 모아 놓았다 놓을 때 한 번에 출정한다.
    let dragAdj = new Set<number>(); // 출발지에 인접한 non-소유 동(쓸기로 집을 수 있는 대상)
    let dragPicked: number[] = []; // 이번 드래그에서 쓸어 담은 목표(순서 보존)
    let dragPickedSet = new Set<number>();

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

    // 출발지(from)에서 여러 목표(targets) 중심으로 향하는 화살표들을 한꺼번에 그린다(드래그 쓸기).
    const updateArrows = (from: number, targets: number[]) => {
      const src = map.getSource(ATTACK_ARROW_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      if (from < 0 || from >= world.n || targets.length === 0) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const a = world.meta[from].centroid as [number, number];
      const features = targets.flatMap((t) => arrowPolygon(a, world.meta[t].centroid as [number, number]));
      src.setData({ type: "FeatureCollection", features });
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

    // 지금 조준 반경 — 전술핵 조준 중이면 일반 미사일의 NUKE_RADIUS_MULT배.
    const aimRadius = () =>
      useUIStore.getState().isNukeAiming ? RADIUS * RUNTIME_CONFIG.NUKE_RADIUS_MULT : RADIUS;

    // 마우스 위치를 중심으로 조준 원을 그리고, 원에 걸친 동을 targetSet에 담는다.
    // ownedOnly=true면 내 소유 동만(공수 source 단계), false면 모든 동(미사일·전술핵 조준).
    const updateAim = (
      center: [number, number],
      targetSet: Set<number>,
      ownedOnly: boolean,
      radius: number = RADIUS
    ) => {
      const [cx, cy] = center;
      const cosLat = Math.cos((cy * Math.PI) / 180);
      const rLng = radius / cosLat; // 경도는 위도에 따라 실제 거리가 달라 보정(원처럼 보이게)

      const ring: [number, number][] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * 2 * Math.PI;
        ring.push([cx + Math.cos(a) * rLng, cy + Math.sin(a) * radius]);
      }
      const circleSrc = map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined;
      circleSrc?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
      });

      // 원의 경위도 bbox를 화면 좌표로 변환해 후보 동만 질의 → 폴리곤-원 교차로 확정.
      const sw = map.project([cx - rLng, cy - radius]);
      const ne = map.project([cx + rLng, cy + radius]);
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
        if (circleHitsPoly(cx, cy, radius, cosLat, f.geometry)) hit.add(id);
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

    // 일반 미사일 조준(단일 표적) — 커서가 가리키는 동 하나만 targetSet에 담는다. 원은 쓰지 않으므로 비운다.
    const updateAimSingle = (center: [number, number], targetSet: Set<number>) => {
      const circleSrc = map.getSource(AIM_CIRCLE_SOURCE) as GeoJSONSource | undefined;
      circleSrc?.setData({ type: "FeatureCollection", features: [] });

      const feats = map.queryRenderedFeatures(map.project(center), { layers: [FILL_LAYER] });
      const id = feats.length > 0 && feats[0].id !== undefined ? Number(feats[0].id) : -1;
      for (const idx of targetSet) {
        if (idx !== id) map.setFeatureState({ source: SOURCE_ID, id: idx }, { aim: 0 });
      }
      targetSet.clear();
      if (id >= 0) targetSet.add(id);
    };

    // 발사: 지금 원에 걸린 동 목록을 서버로 보내고 조준 모드를 끝낸다. 서버가 중립화 후 DELTA.
    // 전술핵 조준 중이면 사일로 발사(sendNuke, 반경 3배) — 검증·쿨다운은 서버가 담당.
    const fireMissile = (center: [number, number]) => {
      const st = useUIStore.getState();
      if (st.isNukeAiming) {
        connection.sendNuke(center, RADIUS * RUNTIME_CONFIG.NUKE_RADIUS_MULT, Array.from(aimedSet));
        clearAim(aimedSet);
        st.setNukeAiming(false);
        return;
      }
      // 일반 미사일 — 클릭 순간 커서가 가리키는 단일 지역만 타격 대상으로 확정.
      const feats = map.queryRenderedFeatures(map.project(center), { layers: [FILL_LAYER] });
      const target = feats.length > 0 && feats[0].id !== undefined ? Number(feats[0].id) : -1;
      if (target < 0) {
        st.showToast("공격할 지역을 가리켜 주세요.");
        return; // 미사일 소모 없이 취소
      }
      connection.sendMissile(center, RADIUS, [target]);
      clearAim(aimedSet);
      st.setAiming(false);
    };

    // 공수 사거리 원(반경 = AIRDROP_MAX_RANGE_DEG)을 origin 중심으로 그린다. 거리 판정은 raw 도
    // (centroidDistance)지만, 표시는 화면상 원형이 자연스러워 경도를 cosLat로 보정해 그린다
    // (미사일 조준 원과 동일 방식 — Mercator 위도 늘어남 상쇄). 판정 경계와 미세하게 다를 수 있다.
    const drawAirdropRange = (center: [number, number]) => {
      const r = RUNTIME_CONFIG.AIRDROP_MAX_RANGE_DEG;
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
      // 행정구역 경계 강조선 — 소유권(frontier)과 무관한 정적 속성(sggBoundary/sidoBoundary)이라
      // feature-state가 아니라 GeoJSON properties를 바로 읽는다. frontier 레이어보다 먼저 그려서
      // 국경선(소유주 다름)이 겹치는 자리에선 frontier 색이 위에 덮이게 한다.
      // 배경(어두운 베이스맵·옅은 동 채움)이 전반적으로 어두워서, 선은 밝은 톤이어야 "진하게" 보인다.
      // 경계선 굵기는 전부 줌에 비례시킨다 — 고정 픽셀 굵기는 전국 줌(6~7)에서 시도 경계가
      // 흰 덩어리로 뭉개지고 해안선이 두꺼운 이중 윤곽으로 보이는 "경계선 이상"의 원인이었다.
      map.addLayer({
        id: ADMIN_SGG_LAYER,
        type: "line",
        source: ARC_SOURCE,
        filter: ["all", ["==", ["get", "sggBoundary"], true], ["!=", ["get", "sidoBoundary"], true]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#c7d2e0",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 10, 1.1],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.15, 8, 0.4],
        },
      });
      map.addLayer({
        id: ADMIN_SIDO_LAYER,
        type: "line",
        source: ARC_SOURCE,
        filter: ["==", ["get", "sidoBoundary"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.9, 10, 2.4],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 9, 0.75],
        },
      });
      // 국경선 글로우 — 해안선(outer 아크)에는 그리지 않는다. 나라 전체·수천 개 섬 둘레에
      // 상시 글로우가 깔리면 저줌에서 두껍고 지저분한 후광이 된다(경계선 이상의 주범).
      map.addLayer({
        id: FRONTIER_GLOW,
        type: "line",
        source: ARC_SOURCE,
        filter: ["!=", ["get", "outer"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], PALETTE[0].stroke],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 11, 6],
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 9, 1.2, 11, 1.8],
          "line-opacity": [
            "case",
            ["!=", ["feature-state", "frontier"], true],
            0,
            // 해안선(중립 실루엣 포함)은 살짝 옅게 — 베이스맵 해안선과 겹쳐도 덜 두드러지게.
            ["case", ["==", ["get", "outer"], true], 0.75, 1],
          ],
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
      // 포위(귀속 대기)된 동의 반짝임 — feature-state "enclosed"(0~1)를 rAF가 펄스로 흔든다.
      // 곧 흡수됨을 경고하는 앰버 채움. 흰 함락 플래시·조준과 색으로 구분된다.
      map.addLayer({
        id: ENCLOSED_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": "#ffcc33",
          "fill-opacity": ["coalesce", ["feature-state", "enclosed"], 0],
        },
      });

      map.addSource(BADGE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // 셀 이름 — 작은 흰 글자로 병력 숫자 위에 표시. (값과의 구분은 '크기'가 담당)
      // 시군구 스케일에 맞춘 LABEL_MIN_ZOOM 이상에서 표시하고, allow-overlap을 끄고 MapLibre
      // 충돌 배치에 맡겨 밀집 지역(수도권 등)에서 라벨이 뭉치지 않게 한다.
      map.addLayer({
        id: NAME_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: LABEL_MIN_ZOOM,
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
      // 저줌에서 라벨이 겹치면 병력이 많은(=중요한) 셀을 우선 배치한다.
      map.addLayer({
        id: BADGE_LAYER,
        type: "symbol",
        source: BADGE_SOURCE,
        minzoom: LABEL_MIN_ZOOM, // 시군구 스케일: 전국 개요에서 살짝만 확대해도 병력 숫자가 보이도록
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

      // 저줌 최소 시인성 점 — 셀 폴리곤 하나는 전국 축소 시 화면상 안 보일 만큼 작아질 수 있다
      // (막 시작한 상대가 셀 1개만 가진 경우 특히). 소유 셀마다 고정 크기 점을 찍어, 폴리곤
      // 크기와 무관하게 항상 눈에 띄게 한다. 확대해서 실제 폴리곤·병력 배지가 보이는 시점
      // (LABEL_MIN_ZOOM, NAME/BADGE_LAYER의 minzoom과 맞춤)에는 점을 끄고 넘겨준다.
      map.addSource(OWNED_DOT_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: OWNED_DOT_LAYER,
        type: "circle",
        source: OWNED_DOT_SOURCE,
        maxzoom: LABEL_MIN_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 3.5],
          "circle-color": buildPaletteMatchExpr(["get", "paletteIdx"], "stroke"),
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 0.6,
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
      // 끝점을 캔버스 정중앙에 두는 도안이라 삼각형이 아래 절반만 차지한다 → 실제 크기 유지를 위해
      // 캔버스를 키운다(위 절반은 투명 여백, 앵커=중앙=끝점을 위한 것).
      const triangleIcon = makeTriangleIcon(32);
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
            // 끝점(= 앵커·정중앙)을 진행 방위각만큼 시계방향 회전 → 끝이 이동 방향을 가리키고,
            // 회전 피벗이 끝점이라 보간 위치(=끝점)가 목적지에 정확히 안착한다.
            // rotation-alignment "map": 지도 북 기준으로 회전(지도 회전/기울임과 무관하게 방향 유지).
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
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
          "text-offset": [0, 1.5], // 끝점 앵커 아래로 뻗은 삼각형 몸통을 지나 병력 수 표시
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

      // 전술핵 사일로(제주) 마커 — 일반 미사일(28px)보다 훨씬 큰 로켓(48px)으로 구분.
      // 사일로 위치는 정적이라 여기서 한 번만 그린다(소유가 바뀌어도 마커는 그대로).
      map.addSource(NUKE_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: world.nukeSilos
            .filter((i) => i >= 0)
            .map((i) => ({
              type: "Feature" as const,
              properties: {},
              geometry: { type: "Point" as const, coordinates: world.meta[i].centroid },
            })),
        },
      });
      const nukeIcon = makeEmojiIcon(MISSILE_EMOJI, 48);
      if (nukeIcon) {
        if (!map.hasImage(NUKE_IMAGE_ID)) {
          map.addImage(NUKE_IMAGE_ID, nukeIcon.data, { pixelRatio: nukeIcon.pixelRatio });
        }
        map.addLayer({
          id: NUKE_LAYER,
          type: "symbol",
          source: NUKE_SOURCE,
          layout: {
            "icon-image": NUKE_IMAGE_ID,
            "icon-size": 1,
            "icon-allow-overlap": true, // 사일로는 항상 보이게
            "icon-ignore-placement": true,
          },
        });
      } else {
        map.addLayer({
          id: NUKE_LAYER,
          type: "circle",
          source: NUKE_SOURCE,
          paint: {
            "circle-radius": 10,
            "circle-color": "#ff5a3c",
            "circle-stroke-color": "#3a0e00",
            "circle-stroke-width": 2,
          },
        });
      }

      // 플레이어 닉네임 라벨 — 각 플레이어 소유 영토의 무게중심 1곳에 표시. 전국 개요로
      // 축소했을 때만 보이고(maxzoom), 그보다 확대하면 사라진다 — 시군구 단위로 들어가면
      // 셀 이름·병력 배지가 그 역할을 대신하므로 라벨이 겹쳐 지저분해지는 걸 막는다.
      // maxzoom을 NAME/BADGE의 minzoom(LABEL_MIN_ZOOM)과 맞춰 한 지점에서 깔끔히 교대시킨다.
      // 유닛 원(UNIT_CIRCLE_LAYER)보다 나중에(=위에) 그려야 그것들에
      // 가려지지 않는다 — 이전엔 더 먼저 추가돼 있어서 마커 근처에서 라벨이 안 보이는 문제가 있었다.
      map.addSource(PLAYER_LABEL_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: PLAYER_LABEL_LAYER,
        type: "symbol",
        source: PLAYER_LABEL_SOURCE,
        maxzoom: LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 15,
        },
        paint: {
          "text-color": buildPaletteMatchExpr(["get", "paletteIdx"], "stroke"),
          "text-halo-color": "#ffffff", // 흰 테두리 — 색색의 영토·유닛 배경 위에서도 또렷하게
          "text-halo-width": 1.8,
        },
      });

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

      // 스폰 방어막 돔 — 보호 중인 플레이어 영토를 감싸는 동심원 여러 겹(중심일수록 밝게)으로
      // 유리 돔처럼 보이게 한다. 매 프레임 world.shieldUntil를 읽어 updateShieldDomes가 갱신한다.
      map.addSource(SHIELD_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SHIELD_FILL,
        type: "fill",
        source: SHIELD_SOURCE,
        paint: {
          "fill-color": "#6fd6ff",
          "fill-opacity": ["coalesce", ["get", "opacity"], 0.06],
        },
      });
      map.addLayer({
        id: SHIELD_LINE,
        type: "line",
        source: SHIELD_SOURCE,
        paint: {
          "line-color": "#d3f4ff",
          "line-width": ["coalesce", ["get", "lineWidth"], 0],
          "line-opacity": ["coalesce", ["get", "lineOpacity"], 0],
          "line-blur": 0.5,
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

      // 우클릭 드래그 공격 화살표 — HOI 스타일 블록 화살표(반투명 주황 채움 + 밝은 테두리).
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

      // 공격 큐 ⚔️ 마커 — 내 큐 대상 centroid마다. (미사일 마커와 같은 이모지-아이콘 방식.)
      map.addSource(ATTACK_QUEUE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      const attackIcon = makeEmojiIcon(ATTACK_QUEUE_EMOJI, 26);
      if (attackIcon) {
        if (!map.hasImage(ATTACK_QUEUE_IMAGE_ID)) {
          map.addImage(ATTACK_QUEUE_IMAGE_ID, attackIcon.data, { pixelRatio: attackIcon.pixelRatio });
        }
        map.addLayer({
          id: ATTACK_QUEUE_LAYER,
          type: "symbol",
          source: ATTACK_QUEUE_SOURCE,
          layout: {
            "icon-image": ATTACK_QUEUE_IMAGE_ID,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      } else {
        map.addLayer({
          id: ATTACK_QUEUE_LAYER,
          type: "circle",
          source: ATTACK_QUEUE_SOURCE,
          paint: {
            "circle-radius": 6,
            "circle-color": "#ff5a2b",
            "circle-stroke-color": "#5a1400",
            "circle-stroke-width": 2,
          },
        });
      }

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
      updateOwnedDots(map);
      updatePlayerLabels(map);
      updateMissileMarkers(map);
      drainMissilesTouched();
      updateAttackQueueMarker(map);
      drainAttackQueueTouched();
      drainDirty(); // applyWelcome이 표시한 all-dirty를 위 초기 페인트로 이미 소진했으므로 비운다.

      // 전국 개관 → 내 시작 동으로 확대 이동(재시작 flyTo와 동일 연출) — 어디서 시작했는지
      // 한눈에 보이도록. 첫 페인트가 끝난 뒤라 이동 경로가 시각적으로 보인다.
      map.flyTo({ center: myStartCenter(prepared), zoom: 11, duration: 1400 });

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
        if (st.isAiming || st.isNukeAiming) aimDirty = true;
        if (st.isTransporting && airdropPhase === "source") aimDirty = true;
        // 우클릭을 누른 채 임계 이상 움직이면 드래그 이동/공격으로 확정(내 동에서 시작한 경우만).
        if (rightDownPoint && (e.originalEvent.buttons & 2) !== 0) {
          if (!dragging) {
            const moved = Math.hypot(e.point.x - rightDownPoint.x, e.point.y - rightDownPoint.y);
            if (
              moved > RIGHT_CLICK_THRESHOLD_PX &&
              rightDownDong >= 0 &&
              world.ownerId[rightDownDong] === world.myHolderId
            ) {
              dragging = true;
              dragSource = rightDownDong;
              dragTargets = reachableTargets(dragSource); // 갈 수 있는 동을 이번 드래그 시작 시 1회 계산
              dragTargetSet = new Set(dragTargets);
              // 쓸기로 집을 수 있는 대상 = 출발지에 인접한 non-소유 동(적·중립). 드래그 시작 시 1회 계산.
              dragAdj = new Set(
                world.neighborIndex[dragSource].filter((nb) => world.ownerId[nb] !== world.myHolderId)
              );
              dragPicked = [];
              dragPickedSet = new Set();
              selectDong(map, dragSource, useUIStore.getState().select); // 출발지 강조
            }
          }
          if (dragging) {
            // 쓸기: 커서가 인접 적·중립 위를 지나가면 그 동을 목표로 담는다(한 번 담기면 유지).
            const hitsMove = map.queryRenderedFeatures([e.point.x, e.point.y], { layers: [FILL_LAYER] });
            const over = hitsMove.length > 0 && hitsMove[0].id !== undefined ? Number(hitsMove[0].id) : -1;
            if (over >= 0 && dragAdj.has(over) && !dragPickedSet.has(over)) {
              dragPickedSet.add(over);
              dragPicked.push(over);
            }
            if (dragPicked.length > 0) {
              // 담은 목표들로 향하는 화살표를 전부 그린다(자석처럼 각 동 중심에 붙음).
              updateArrows(dragSource, dragPicked);
            } else {
              // 아직 아무것도 안 담았으면 단일 화살표(그 방향 최대치 동)를 보여준다.
              const t = resolveDragTarget(e.point, [e.lngLat.lng, e.lngLat.lat]);
              if (t >= 0) updateArrow(dragSource, world.meta[t].centroid as [number, number]);
              else updateArrow(-1, null);
            }
          }
        }
      });

      // 좌클릭 = 동 선택. 조준 중이면 = 미사일/전술핵 발사, 공수 중이면 = 공수 클릭.
      map.on("click", (e) => {
        const stClick = useUIStore.getState();
        if (stClick.isAiming || stClick.isNukeAiming) {
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

      // 우클릭 — 두 방식 공존. 짧은 클릭(임계 미만) = 공격 큐 토글(⚔️ 마커),
      // 내 동에서 시작한 드래그(임계 이상) = 예전 병력 이동(화살표 파견/쓸기 일괄 출정/행군).
      // 내 동 밖에서 시작한 드래그는 무시. 기본 컨텍스트 메뉴는 막는다.
      map.getCanvas().addEventListener("contextmenu", (ev) => ev.preventDefault());
      map.on("contextmenu", () => {
        // 우클릭 = 공수 취소(그 외 공격은 mousedown/mouseup이 처리하므로 여기선 안 함).
        const st = useUIStore.getState();
        if (st.isTransporting) st.setTransporting(false);
      });

      map.on("mousedown", (e) => {
        if (e.originalEvent.button !== 2) return; // 우클릭만
        const st = useUIStore.getState();
        if (st.isAiming || st.isNukeAiming || st.isTransporting) return; // 특수 모드 중엔 우클릭 비활성
        // 누른 지점·동만 기록해 둔다. 드래그 확정은 mousemove의 임계 판정이 한다.
        rightDownPoint = { x: e.point.x, y: e.point.y };
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        rightDownDong = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
        dragging = false;
        dragSource = -1;
      });

      map.on("mouseup", (e) => {
        if (e.originalEvent.button !== 2 || !rightDownPoint) return; // 우클릭 뗄 때만
        const moved = Math.hypot(e.point.x - rightDownPoint.x, e.point.y - rightDownPoint.y);
        const wasDragging = dragging;
        const from = dragSource;
        // 쓸어 담은 목표들(2개 이상이면 한 번에 균등 분할 출정). 리셋 전에 스냅샷.
        const picked = dragPicked.slice();
        // 아무것도 안 담았으면 화살표가 가리키던 대상(그 방향 최대치)을 그대로 쓴다 — 리셋 전에 계산.
        const dragTarget =
          wasDragging && picked.length === 0 ? resolveDragTarget(e.point, [e.lngLat.lng, e.lngLat.lat]) : -1;

        rightDownPoint = null; // 상태 리셋
        rightDownDong = -1;
        dragging = false;
        dragSource = -1;
        dragTargets = [];
        dragTargetSet = new Set();
        dragAdj = new Set();
        dragPicked = [];
        dragPickedSet = new Set();
        updateArrow(-1, null); // 화살표 지우기

        if (wasDragging) {
          if (picked.length >= 2) {
            // 여러 인접 목표를 쓸었으면 균등 분할해 한 번에 출정(클릭 감소).
            connection.sendMultiSortie(from, picked, SORTIE_SEND_RATIO);
          } else if (picked.length === 1) {
            doAttack(from, picked[0], connection); // 하나만 쓸었으면 단일 출정
          } else if (dragTarget >= 0) {
            doAttack(from, dragTarget, connection); // 아무것도 안 쓸었으면 방향이 가리킨 동(먼 내 동=행군 등)
          }
          return;
        }
        if (moved > RIGHT_CLICK_THRESHOLD_PX) return; // 내 동 밖에서 시작한 드래그 → 아무것도 안 함
        const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
        const target = hits.length > 0 && hits[0].id !== undefined ? Number(hits[0].id) : -1;
        if (target >= 0) handleToggleAttack(target, connection);
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
    // 줌(Q/E, +/-)도 팬처럼 '눌린 상태'를 모아 렌더 루프가 매 프레임 즉시 줌한다.
    // 애니메이션 줌(zoomIn/Out)은 매 프레임 panBy(animate:false)에 취소되어 WASD와 동시에
    // 쓸 수 없기 때문 — 즉시 줌으로 바꾸면 팬과 자연스럽게 겹쳐 동작한다.
    const ZOOM_SPEED = 2.5; // 줌 속도(레벨/초)
    const ZOOM: Record<string, "in" | "out"> = {
      KeyE: "in",
      Equal: "in",
      NumpadAdd: "in",
      KeyQ: "out",
      Minus: "out",
      NumpadSubtract: "out",
    };
    const zoomPressed = new Set<"in" | "out">();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      // 입력창(닉네임 등)에 포커스가 있으면 지도 조작으로 가로채지 않는다.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Esc = 미사일/전술핵 조준 / 공수 모드 취소
      if (e.code === "Escape") {
        const st = useUIStore.getState();
        if (st.isAiming) {
          st.setAiming(false);
          return;
        }
        if (st.isNukeAiming) {
          st.setNukeAiming(false);
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
      // Shift(좌·우 모두) = 공수부대(병력 수송) 모드 토글 (오른쪽 아래 버튼과 동일 동작).
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
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
      // 줌 키: 방향만 기록(연속 줌은 렌더 루프가 담당) — WASD와 동시에 눌러도 동작한다.
      const zoom = ZOOM[e.code];
      if (zoom) {
        zoomPressed.add(zoom);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = DIR[e.code];
      if (dir) pressed.delete(dir);
      const zoom = ZOOM[e.code];
      if (zoom) zoomPressed.delete(zoom);
    };
    // 창이 포커스를 잃으면 keyup을 놓쳐 키가 '눌린 채' 남는 것을 방지(멈춤).
    const onBlur = () => {
      pressed.clear();
      zoomPressed.clear();
    };
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
    const enclosedRendered = new Set<number>(); // 지금 반짝임(enclosed feature-state)을 켠 동
    const loop = (now: number) => {
      // WASD/화살표 연속 패닝 — 눌린 방향으로 매 프레임 dt(초)만큼 부드럽게 이동.
      const dt = lastPanNow ? Math.min(0.05, (now - lastPanNow) / 1000) : 0; // dt 상한: 탭 복귀 시 급점프 방지
      lastPanNow = now;
      if (pressed.size > 0) {
        const dx = ((pressed.has("right") ? 1 : 0) - (pressed.has("left") ? 1 : 0)) * PAN_SPEED * dt;
        const dy = ((pressed.has("down") ? 1 : 0) - (pressed.has("up") ? 1 : 0)) * PAN_SPEED * dt;
        if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: false });
      }
      // Q/E 연속 줌 — 즉시 setZoom이라 팬과 겹쳐도 서로 취소하지 않는다(WASD 중에도 동작).
      if (zoomPressed.size > 0) {
        const dz = ((zoomPressed.has("in") ? 1 : 0) - (zoomPressed.has("out") ? 1 : 0)) * ZOOM_SPEED * dt;
        if (dz !== 0) map.setZoom(map.getZoom() + dz);
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
        updateOwnedDots(map);
        updatePlayerLabels(map);
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

      // 포위(귀속 대기) 동 반짝임 — 집합이 바뀌면 빠진 동의 반짝임을 끄고, 현재 집합을 앰버로 펄스.
      if (drainEnclosedTouched()) {
        for (const idx of enclosedRendered) {
          if (!enclosedSet.has(idx)) {
            map.setFeatureState({ source: SOURCE_ID, id: idx }, { enclosed: 0 });
            enclosedRendered.delete(idx);
          }
        }
        for (const idx of enclosedSet) enclosedRendered.add(idx);
      }
      if (enclosedRendered.size > 0) {
        const ePulse = 0.15 + 0.4 * (0.5 + 0.5 * Math.sin(now / 180)); // 0.15~0.55 사이로 깜빡
        for (const idx of enclosedRendered) {
          map.setFeatureState({ source: SOURCE_ID, id: idx }, { enclosed: ePulse });
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

      // 점령 완료된 공격 큐 대상은 마커에서 정리한다(서버 tick도 큐에서 제거).
      pruneCapturedAttackTargets();
      // 미사일 마커(스폰/소모 시 갱신)
      if (drainMissilesTouched()) updateMissileMarkers(map);
      // 공격 큐 ⚔️ 마커(토글/점령 정리 시 갱신)
      if (drainAttackQueueTouched()) updateAttackQueueMarker(map);

      // 재시작으로 새 시작 동을 배정받으면 그 동으로 카메라를 옮긴다(어디서 시작했는지 안 보이던 문제).
      const respawnCell = drainRespawnCell();
      if (respawnCell !== null) {
        map.flyTo({ center: world.meta[respawnCell].centroid as [number, number], zoom: 11, duration: 1200 });
      }

      // 스폰 방어막 돔 — 매 프레임 갱신(보호 중인 플레이어가 있을 때만 실질 비용 발생).
      updateShieldDomes(map, now);

      // 미사일/전술핵 조준: 원/타격 갱신 + 걸린 동의 하얀 반짝 펄스 (전술핵은 반경 3배)
      const stAim = useUIStore.getState();
      const aimingNow = stAim.isAiming || stAim.isNukeAiming;
      if (aimingNow) {
        if (!wasAiming) aimDirty = true; // 조준 시작 → 즉시 한 번 그린다
        if (aimDirty && lastMouseLngLat) {
          // 전술핵은 원 범위(AoE), 일반 미사일은 커서가 가리키는 단일 지역만.
          if (stAim.isNukeAiming) updateAim(lastMouseLngLat, aimedSet, false, aimRadius());
          else updateAimSingle(lastMouseLngLat, aimedSet);
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

// 우클릭으로 호출: 국경에 인접한 적·중립 지역을 공격 큐에 토글한다(⚔️ 마커). 이미 큐에 있으면 해제.
// 마커는 낙관적으로 즉시 반영(toggleMyAttackTarget)하고, 서버는 sendAttackTarget으로 검증·저장한다.
// 이후 매 주기 그 대상에 인접한 내 동들의 병력 일부가 자동으로 그 대상을 공격한다.
function handleToggleAttack(idx: number, connection: Connection) {
  const { showToast } = useUIStore.getState();
  const me = world.myHolderId;

  if (world.myAttackQueue.has(idx)) {
    // 해제는 항상 허용.
    toggleMyAttackTarget(idx);
    connection.sendAttackTarget(idx);
    showToast(`${world.meta[idx].name} 공격 취소`);
    return;
  }
  if (world.ownerId[idx] === me) {
    showToast("적·중립 지역만 공격 대상으로 지정할 수 있습니다.");
    return;
  }
  const adjacent = world.neighborIndex[idx]?.some((nb) => world.ownerId[nb] === me) ?? false;
  if (!adjacent) {
    showToast("내 영토에 인접한 지역만 공격할 수 있습니다.");
    return;
  }
  toggleMyAttackTarget(idx);
  connection.sendAttackTarget(idx);
  showToast(`공격 대상: ${world.meta[idx].name}`);
}

// 우클릭 드래그 이동/공격: 출발지(from)에서 대상(to)으로 병력 파견(서버에 명령 전송).
//  · 인접 적/중립 → 전투    · 인접 내 동 → 증원    · 먼 내 동 → 경로 자동 출정(B1, 내 영토 따라 연쇄)
// 실제 처리는 서버(로컬 mock)가 하고, 결과는 DELTA(채움·국경·유닛)/ERROR(토스트)로 돌아온다.
function doAttack(from: number, to: number, connection: Connection) {
  const { showToast } = useUIStore.getState();

  if (from < 0 || world.ownerId[from] !== world.myHolderId) return; // 출발지가 내 동이 아니면 무시
  if (from === to) return; // 같은 동에 놓으면 취소

  const adjacent = world.neighborIndex[from]?.includes(to) ?? false;

  // 인접이 아니면: 내 동이면 경로 자동 출정(B1), 아니면 공격은 인접만 가능함을 안내.
  if (!adjacent) {
    if (world.ownerId[to] === world.myHolderId) {
      connection.sendMarch(from, to, SORTIE_SEND_RATIO);
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

  connection.sendSortie(from, to, SORTIE_SEND_RATIO);
}

// 드래그 이동/공격에서 이 출발지로부터 '갈 수 있는' 동 목록:
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

  // 화살표 끝은 '항상 대상 동 중심(b)'에 정확히 맞춘다. 폭·촉은 실제 거리(len)에 비례시켜
  // 짧아도 뭉개지지 않게 한다(짧으면 그만큼 작은 화살표 — 위치는 항상 정확).
  const shaftW = Math.min(0.0038, len * 0.055); // 촉 밑변쪽 샤프트 반폭(길이에 비례, 상한만)
  const startW = shaftW * 0.5; // 시작부는 얇게
  const headW = shaftW * 2.0; // 화살촉 날개 반폭(가장 넓음)
  const headLen = Math.min(len * 0.5, Math.max(len * 0.28, headW * 1.4)); // 화살촉 길이
  const baseLen = len - headLen; // 샤프트 끝(=촉 밑변)까지 거리

  // 스케일 공간 (진행거리 along, 수직 side) → lng/lat.
  const P = (along: number, side: number): [number, number] => [
    a[0] + (ux * along + px * side) / cosLat,
    a[1] + (uy * along + py * side),
  ];

  const ring: [number, number][] = [
    P(0, startW), // 시작부 왼쪽(얇음)
    P(baseLen, shaftW), // 촉 밑변 왼쪽(넓어짐)
    P(baseLen, headW), // 촉 왼쪽 날개(가장 넓음)
    P(len, 0), // 뾰족한 끝 = 대상 동 중심(b)에 정확히 안착
    P(baseLen, -headW), // 촉 오른쪽 날개
    P(baseLen, -shaftW), // 촉 밑변 오른쪽
    P(0, -startW), // 시작부 오른쪽(얇음)
    P(0, startW), // 닫기
  ];
  return [
    { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } },
  ];
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
  // 뾰족한 꼭짓점을 캔버스 정중앙(= 아이콘 앵커·회전 피벗)에 둔다. 그래야 이동 보간 위치에
  // '삼각형 끝점'이 정확히 놓여, 가까운 동으로 수송해도 끝이 목적지에 딱 맞는다(끝이 목적지를
  // 지나쳐 보이던 문제 해소). 몸통은 중앙 아래로 뻗어, 방위각 회전 시 출발지 쪽으로 꼬리처럼 끌린다.
  ctx.beginPath();
  ctx.moveTo(px * 0.5, px * 0.5); // 끝(뾰족한 꼭짓점) = 정중앙
  ctx.lineTo(px * 0.8, px * 0.96); // 오른쪽 밑
  ctx.lineTo(px * 0.2, px * 0.96); // 왼쪽 밑
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = Math.max(1, px * 0.06);
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

// 저줌 최소 시인성 점 — 소유(중립·야만인 제외) 동 하나마다 점 1개. 폴리곤이 화면상 안 보일
// 만큼 작아져도(막 시작한 상대 등) 이 점으로는 항상 위치가 드러난다.
function updateOwnedDots(map: MaplibreMap) {
  const src = map.getSource(OWNED_DOT_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  const features: { type: "Feature"; properties: { paletteIdx: number }; geometry: { type: "Point"; coordinates: [number, number] } }[] = [];
  for (let i = 0; i < world.n; i++) {
    const owner = world.ownerId[i];
    if (owner === 0 || owner === CONFIG.ENV_HOLDER_ID) continue;
    features.push({
      type: "Feature",
      properties: { paletteIdx: paletteIdxOf(owner) },
      geometry: { type: "Point", coordinates: world.meta[i].centroid as [number, number] },
    });
  }
  src.setData({ type: "FeatureCollection", features });
}

// 플레이어별 닉네임 라벨 — 그 플레이어의 현재 소유 영토 무게중심 1곳에 이름을 띄운다(동마다
// 반복 표시하면 도배되므로 플레이어당 1개). 영토가 늘수록 중심도 같이 이동한다.
function updatePlayerLabels(map: MaplibreMap) {
  const src = map.getSource(PLAYER_LABEL_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  const sums = new Map<number, { sx: number; sy: number; cnt: number }>();
  for (let i = 0; i < world.n; i++) {
    const owner = world.ownerId[i];
    if (owner === 0 || owner === CONFIG.ENV_HOLDER_ID) continue;
    const c = world.meta[i].centroid;
    const acc = sums.get(owner);
    if (acc) {
      acc.sx += c[0];
      acc.sy += c[1];
      acc.cnt++;
    } else {
      sums.set(owner, { sx: c[0], sy: c[1], cnt: 1 });
    }
  }
  const features = Array.from(sums.entries()).map(([holderId, { sx, sy, cnt }]) => ({
    type: "Feature" as const,
    properties: { name: world.holders.get(holderId)?.name ?? "?", paletteIdx: paletteIdxOf(holderId) },
    geometry: { type: "Point" as const, coordinates: [sx / cnt, sy / cnt] as [number, number] },
  }));
  src.setData({ type: "FeatureCollection", features });
}

// 이동 중인 유닛을 출발지→목적지 사이 보간 위치에 그린다. 일반 출정/공세는 원(UNIT_SOURCE),
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
    // 진행 방위각(북 기준 시계방향, 도) — 공수 삼각형 유닛을 이동 방향으로 회전시키는 데 쓴다.
    // 경도차는 위도에 따라 화면 폭이 줄어드므로 cosLat로 보정해야 실제 진행 방향과 일치한다.
    const cosLat = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1;
    const bearing = (Math.atan2((b[0] - a[0]) * cosLat, b[1] - a[1]) * 180) / Math.PI;
    return {
      type: "Feature" as const,
      properties: { amount: o.amount, paletteIdx: paletteIdxOf(o.holderId), bearing },
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

// 지도 실제 폴리곤 전부를 감싸는 bbox + 여유(패딩) — MaplibreMap의 maxBounds로 써서 이 지도
// 범위 밖으로는 팬/줌이 안 나가게 한다(무한 스크롤·좌우 반복 방지). 세계지도는 원래 전 지구를
// 다루니 거의 -180~180이 되는 게 맞고(그래야 실제로 세계 전체가 보임), 법정동/시군구는 대한민국
// 언저리로 자연히 좁혀진다 — 지도마다 하드코딩 없이 prepared 데이터에서 매번 계산.
function computeMapBounds(prepared: PreparedMap): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (typeof node[0] === "number") {
      const [lng, lat] = node as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const child of node) visit(child);
    }
  };
  for (const f of prepared.geojson.features) visit(f.geometry.coordinates);

  const padLng = Math.max((maxLng - minLng) * 0.1, 2);
  const padLat = Math.max((maxLat - minLat) * 0.1, 2);
  return [
    [Math.max(minLng - padLng, -179.9), Math.max(minLat - padLat, -85)],
    [Math.min(maxLng + padLng, 179.9), Math.min(maxLat + padLat, 85)],
  ];
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
