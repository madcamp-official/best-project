import type { Rank } from "./types";

// core.ts/GameCore.kt가 계산하는 표준 계급값(Rank)은 한국 행정구역 명칭 고정("동장"/"시장"/
// "도지사"/"대통령") — 내부 비교·승급 판정(uiStore.ts RANK_LEVEL, 우승 오버레이 억제 등)은
// 전부 이 표준 문자열 기준이라 손대지 않는다. 여기서는 화면에 실제로 보여줄 때만(Hud.tsx)
// 지도(mapId)에 맞는 명칭으로 바꿔치기한다 — 세계지도는 "국가 하나 통째로 장악"이 이미
// sggcd 판정으로 시장 계급에 대응하므로("한국지리"와 같은 설계, data/loadMapData.ts 참조),
// 그 나라·대륙·세계 규모에 맞는 이름만 새로 붙인다.
const WORLD_LABELS: Partial<Record<NonNullable<Rank>, string>> = {
  시장: "국가원수",
  도지사: "대륙 정복자",
  대통령: "세계 대통령",
};

export function displayRank(rank: Rank, mapId: string): string | null {
  if (rank === null) return null;
  if (mapId === "world") return WORLD_LABELS[rank] ?? rank;
  return rank;
}
