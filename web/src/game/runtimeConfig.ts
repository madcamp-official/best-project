import { CONFIG } from "../config";

// docs/convention.md §4 — 온라인 전환 후에는 서버가 설정의 원본이고 WELCOME으로 클라에 전달된다.
// 정적 CONFIG는 지도(mapId)마다 달라질 수 없는데, 세계지도처럼 지구 전체 위경도 범위를 쓰는
// 지도는 미사일 반경·공수 사거리 같은 거리 기반 상수를 한국 지도 기준값 그대로 쓰면 의미가
// 없어진다(MapCatalog.applyProfile 참조) — 그래서 서버가 WELCOME.config로 지도별 오버라이드가
// 반영된 값을 내려주고, 렌더러(map/)는 이 RUNTIME_CONFIG를 읽는다. 라운드 시작마다
// world/worldView.ts의 applyWelcome이 갱신한다. game/core.ts(순수 로직, 서버 이식 대상)는
// 여기 의존하지 않는다 — 전역 mutable state 금지 규칙 때문에 그대로 정적 CONFIG를 쓴다.
export const RUNTIME_CONFIG: typeof CONFIG = { ...CONFIG };

export function applyServerConfig(serverConfig: typeof CONFIG): void {
  Object.assign(RUNTIME_CONFIG, serverConfig);
}
