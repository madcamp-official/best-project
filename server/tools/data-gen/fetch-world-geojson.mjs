// 1회성 준비 스크립트: world-atlas의 국가 경계(TopoJSON, Natural Earth 110m 해상도)를
// GeoJSON으로 풀어 web/public/world-countries.geojson으로 저장한다. kr-sgg.geojson과 같은 역할 —
// 클라(loadMapData)와 서버(generate-world.mjs)가 이 "같은 파일"을 "같은 필터·같은 순서"로 읽어야
// admIndex가 일치한다.
//
// world-atlas의 국가 id는 ISO 3166-1 numeric(ccn3)이고 properties.name은 영문명만 있다.
// world-countries(mledoze/countries, ccn3로 조인 가능)에서 3자리 코드(cca3)·대륙(region)·
// 한국어 표시명(translations.kor.common)을 보충한다 — 이 지도의 "국가"가 한국 지도의
// 시군구에 대응하는 최소 단위, "대륙"이 시도(광역 상위 단위)에 대응한다(계급 판정 재사용).
//
// world-atlas에 있지만 world-countries(공식 ISO 목록 기반)에는 없는 분쟁/미승인 지역
// 3곳(북키프로스·소말릴란드·코소보)은 수동 보강한다.

import * as topojson from "topojson-client";
import countries from "world-countries";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const topoPath = require.resolve("world-atlas/countries-110m.json");

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

  const byCcn3 = new Map(countries.map((c) => [c.ccn3, c]));

  const out = { type: "FeatureCollection", features: [] };
  let overrideCount = 0;
  for (const f of fc.features) {
    const match = byCcn3.get(f.id);
    let code, name, region;
    if (match) {
      code = match.cca3;
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
  console.log(`변환 완료: ${out.features.length}개 (수동 보강 ${overrideCount}개)`);

  const outPath = new URL("../../../web/public/world-countries.geojson", import.meta.url);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장 완료: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
