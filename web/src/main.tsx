import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'dseg/css/dseg.css' // 7세그먼트 디지털 폰트 (DSEG)
import './theme/theme.css' // 테마 변수 (색상 팔레트 — 전환 가능 구조)
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
