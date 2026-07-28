// 1회성 준비 스크립트: world-atlas의 국가 경계(TopoJSON, Natural Earth 110m 해상도)를
// GeoJSON으로 풀고, 면적이 극단적으로 큰 나라(러시아·미국·캐나다·중국·인도·브라질·호주·
// 인도네시아·남아공)는 국가 단위 대신 그 나라의 주/성(admin-1, Natural Earth 50m) 단위로
// 쪼개 web/public/world-countries.geojson으로 저장한다. kr-sgg.geojson과 같은 역할 —
// 클라(loadMapData)와 서버(generate-world.mjs)가 이 "같은 파일"을 "같은 필터·같은 순서"로
// 읽어야 admIndex가 일치한다.
//
// 셀 크기 편차 완화가 목적: 러시아 하나가 다른 작은 나라 수십 개를 합친 것보다 크면 게임
// 밸런스가 깨진다 — 위 9개 대국만 쪼개면 최대 셀 크기가 크게 줄어들면서, 나머지 170여 개
// 작은 나라는 그대로 둬 전 세계를 다 잘게 쪼개는 과한 복잡도를 피한다.
//
// world-atlas의 국가 id는 ISO 3166-1 numeric(ccn3)이고 properties.name은 영문명만 있다.
// world-countries(mledoze/countries, ccn3로 조인 가능)에서 3자리 코드(cca3)·대륙(region)·
// 한국어 표시명(translations.kor.common)을 보충한다.
//
// sggcd/sidocd 설계(GameCore.computeRank 그룹핑 재사용, 코드 변경 없음):
//   - 안 쪼갠 나라: sggcd=자기 나라 코드(즉시 최하위 계급 생략), sidocd=대륙
//   - 쪼갠 나라의 주/성: sggcd=자기 주 코드, sidocd=소속 국가 코드 — "그 나라 전체 장악"이
//     도지사 상당 계급이 된다(대륙 장악과는 별개의, 나라별로 난이도가 다른 두 번째 상승 경로).
//
// world-atlas에 있지만 world-countries(공식 ISO 목록 기반)에는 없는 분쟁/미승인 지역
// 3곳(북키프로스·소말릴란드·코소보)은 수동 보강한다.

import * as topojson from "topojson-client";
import countries from "world-countries";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const topoPath = require.resolve("world-atlas/countries-110m.json");

// Natural Earth Vector(공개 도메인, 카토그래피 표준 소스) 50m 해상도 admin-1(주/성) 경계.
// nvkelso/natural-earth-vector 저장소는 원본 셰이프파일을 geojson으로 미리 변환해 공개 제공한다.
const ADMIN1_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson";

// 국토 면적이 극단적으로 커서 셀 크기 편차의 주범인 나라들 — adm0_a3(admin-1 데이터)/
// cca3(world-countries) 공통 3자리 코드.
const SUBDIVIDE_CCA3 = new Set(["RUS", "USA", "CAN", "CHN", "BRA", "AUS", "IND", "IDN", "ZAF"]);

const MANUAL_OVERRIDES = {
  "N. Cyprus": { code: "XNC", name: "북키프로스", region: "Europe" },
  Somaliland: { code: "XSO", name: "소말릴란드", region: "Africa" },
  Kosovo: { code: "XKX", name: "코소보", region: "Europe" },
};

// world-countries의 region은 영문(Africa/Americas/Asia/Europe/Oceania) — 나머지 UI가 전부
// 한국어라 대륙명도 맞춰 번역한다. sidocd(지도상 "도" 상당 상위 그룹)는 원문 영문 코드를
// 그대로 키로 쓰고(GameCore.computeRank의 그룹핑 키), sidonm(표시명)만 번역한다.
const REGION_KO = {
  Africa: "아프리카",
  Americas: "아메리카",
  Asia: "아시아",
  Europe: "유럽",
  Oceania: "오세아니아",
  Antarctic: "남극",
};

async function main() {
  console.log(`world-atlas 국가 경계 로드: ${topoPath}`);
  const topo = JSON.parse(readFileSync(topoPath, "utf8"));
  const fc = topojson.feature(topo, topo.objects.countries);
  console.log(`원본 feature 수: ${fc.features.length}`);

  console.log(`admin-1(주/성) 경계 로드: ${ADMIN1_URL}`);
  const admin1Res = await fetch(ADMIN1_URL);
  if (!admin1Res.ok) throw new Error(`admin-1 로드 실패 (${admin1Res.status})`);
  const admin1Fc = await admin1Res.json();
  console.log(`admin-1 원본 feature 수: ${admin1Fc.features.length}`);

  const byCcn3 = new Map(countries.map((c) => [c.ccn3, c]));
  const byCca3 = new Map(countries.map((c) => [c.cca3, c]));

  const out = { type: "FeatureCollection", features: [] };
  let overrideCount = 0;
  for (const f of fc.features) {
    const match = byCcn3.get(f.id);
    let code, name, region;
    if (match) {
      code = match.cca3;
      if (SUBDIVIDE_CCA3.has(code)) continue; // 아래에서 admin-1 조각으로 대체
      name = match.translations?.kor?.common ?? match.name.common;
      region = match.region || "Other";
    } else {
      const override = MANUAL_OVERRIDES[f.properties.name];
      if (!override) {
        console.warn(`매칭 실패(건너뜀): id=${f.id} name=${f.properties.name}`);
        continue;
      }
      ({ code, name, region } = override);
      overrideCount++;
    }
    out.features.push({
      type: "Feature",
      properties: { code, name, region, regionKo: REGION_KO[region] ?? region },
      geometry: f.geometry,
    });
  }
  console.log(`국가 단위 변환 완료: ${out.features.length}개 (수동 보강 ${overrideCount}개)`);

  let admin1Count = 0;
  for (const f of admin1Fc.features) {
    const cca3 = f.properties.adm0_a3;
    if (!SUBDIVIDE_CCA3.has(cca3)) continue;
    const parent = byCca3.get(cca3);
    const parentName = parent?.translations?.kor?.common ?? parent?.name.common ?? cca3;
    const code = f.properties.iso_3166_2 || f.properties.adm1_code;
    const name = f.properties.name_ko || f.properties.name;
    if (!code || !name) {
      console.warn(`admin-1 매칭 실패(건너뜀): ${cca3} ${f.properties.name}`);
      continue;
    }
    out.features.push({
      type: "Feature",
      // sidocd(그룹핑 키)는 소속 국가 코드 그대로, 표시명만 한국어로.
      properties: { code, name, region: cca3, regionKo: parentName },
      geometry: f.geometry,
    });
    admin1Count++;
  }
  console.log(`admin-1 변환 완료: ${admin1Count}개 (${SUBDIVIDE_CCA3.size}개국 대체)`);
  console.log(`최종 feature 수: ${out.features.length}개`);

  const outPath = new URL("../../../web/public/world-countries.geojson", import.meta.url);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
