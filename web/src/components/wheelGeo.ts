// 휠 공통 지오메트리 — P-01 진행 휠 / P-02 템포 휠이 공유
// 원본 비율: 링 지름 ≈ 화면 폭의 76% (스크린샷 실측) — 링이 SVG 박스의 대부분을 차지해야 함
export const SIZE = 360 // SVG 전체 크기
export const CENTER = SIZE / 2 // 중심 좌표
export const RADIUS = 150 // 기본 링 반지름 (P-02 템포 휠 기준 — P-01 진행 휠은 자체 축소값 사용)
export const TOUCH_BAND = 40 // 터치 판정 폭 (링 중심선 기준 ±)

// 각도(도) → 좌표 (기본은 링 위, radius 지정 시 임의 반지름)
export function polar(angleDeg: number, radius: number = RADIUS): { x: number; y: number } {
  return {
    x: CENTER + radius * Math.cos((angleDeg * Math.PI) / 180),
    y: CENTER + radius * Math.sin((angleDeg * Math.PI) / 180),
  }
}

// 특정 각도를 중심으로 ±spread 만큼의 호(arc) 경로 (하이라이트/루프 표시용)
export function arcPath(centerDeg: number, spreadDeg: number, radius: number = RADIUS): string {
  const p1 = polar(centerDeg - spreadDeg, radius)
  const p2 = polar(centerDeg + spreadDeg, radius)
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y}`
}
