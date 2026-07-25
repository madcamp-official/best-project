import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true → 0.0.0.0 바인딩. 같은 WiFi의 다른 기기(휴대폰 등)에서 이 PC의
  // LAN IP:5173 으로 접속 가능. (기본값은 localhost라 외부 접속 불가)
  server: {
    host: true,
  },
  // maplibre-gl은 별도 워커 청크(maplibre-gl-worker.mjs)를 동적으로 로드하는데,
  // Vite dev의 의존성 사전 번들링(.vite/deps) 대상에 포함되면 그 워커 URL이 깨져 404가 난다.
  // (타일/GeoJSON 처리가 응답 없는 워커를 기다리며 조용히 멈춤 — 에러도 안 뜸)
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
})
