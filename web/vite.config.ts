import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages는 /riffslow/ 하위 경로에서 서빙됨 (빌드에만 적용, 로컬 개발은 루트 그대로)
  base: command === 'build' ? '/riffslow/' : '/',
  plugins: [
    react(),
    // dev 서버 HTTPS (자체 서명 인증서 자동 생성)
    // — AudioWorklet은 보안 컨텍스트(https/localhost)에서만 동작해서, 폰 LAN 접속에 필수
    basicSsl(),
    // PWA: 홈 화면 설치 + 오프라인 캐싱 (서비스 워커)
    VitePWA({
      registerType: 'autoUpdate', // 새 버전 배포 시 자동 갱신
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'RiffSlow',
        short_name: 'RiffSlow', // 홈 화면 아이콘 아래 표시명
        description: '기타 연습용 템포 조절 플레이어',
        lang: 'ko',
        theme_color: '#0e0c0a',
        background_color: '#0e0c0a', // 스플래시 배경
        display: 'standalone', // 주소창 없는 전체 화면 (앱처럼)
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // ffmpeg wasm(~31MB)까지 오프라인 캐시에 포함
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // onnxruntime wasm은 제외 — 런타임에 CDN에서 받음(stems.ts wasmPaths), 스템 분리를
        // 안 쓰는 사용자까지 26MB를 미리 받게 하지 않기 위함
        globIgnores: ['**/ort-wasm*'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true, // 같은 WiFi의 다른 기기(아이폰 등)에서 접속 허용
    // ⚠️ COOP/COEP 헤더(SharedArrayBuffer용)를 넣었더니 iOS Safari가 페이지를
    // 반복 크래시시킴(2026-07-13 실기기 확인 — "문제가 반복적으로 발생") → 제거.
    // 스템 분리는 단일 스레드 WASM/WebGPU로 동작 (stems.ts에서 자동 조정)
  },
  optimizeDeps: {
    // ffmpeg.wasm은 내부에서 웹워커를 쓰므로 Vite 사전 번들링에서 제외 (공식 권장 설정)
    // onnxruntime-web도 자체 wasm 로딩 로직이 있어 제외
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web'],
  },
}))
