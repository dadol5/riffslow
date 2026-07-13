import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'dseg/css/dseg.css' // 7세그먼트 디지털 폰트 (DSEG)
import './theme/theme.css' // 테마 변수 (색상 팔레트 — 전환 가능 구조)
import './index.css'
import App from './App.tsx'

// dev 모드에서만 폰 화면용 콘솔(eruda) 표시 — 아이폰 실기기 디버깅용 (배포 빌드엔 미포함)
if (import.meta.env.DEV) {
  import('eruda').then((eruda) => eruda.default.init())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
