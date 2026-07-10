// 메인 링 — 네온 발광 (원본 재현)
// 원리: 폭이 점점 넓고 투명도가 점점 옅은 선을 여러 겹 쌓아 빛 감쇠를 표현
// (CSS blur는 iOS Safari에서 SVG에 적용이 안 되는 경우가 있어 사용하지 않음 — 순수 겹침 방식)
// 그라데이션: 하이라이트 방향이 가장 밝고 반대편으로 갈수록 어두움 (회전으로 정렬)
import { CENTER, RADIUS } from './wheelGeo'

// [선 폭, 투명도] — 안쪽(본선)부터 바깥 번짐까지 (가우시안 감쇠 근사)
const GLOW_LAYERS: [number, number][] = [
  [28, 0.04],
  [18, 0.08],
  [11, 0.15],
  [6.5, 0.3],
  [3.2, 1], // 본선
]

interface NeonRingProps {
  angleDeg: number // 하이라이트 각도 (이 방향이 가장 밝음)
  id: string // 그라데이션 id (SVG마다 고유)
  radius?: number // 링 반지름 (기본 = 공용 RADIUS, P-01은 축소값 전달)
}

function NeonRing({ angleDeg, id, radius = RADIUS }: NeonRingProps) {
  const rotate = `rotate(${angleDeg} ${CENTER} ${CENTER})`
  return (
    <>
      <defs>
        {/* 가로축 그라데이션: 오른쪽(하이라이트 쪽) 밝음 → 왼쪽(반대편) 어두움 */}
        <linearGradient id={id} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" style={{ stopColor: 'var(--neon-soft)' }} />
          <stop offset="40%" style={{ stopColor: 'var(--neon)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--neon-deep)' }} stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {GLOW_LAYERS.map(([width, opacity]) => (
        <circle
          key={width}
          cx={CENTER}
          cy={CENTER}
          r={radius}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={width}
          strokeOpacity={opacity}
          transform={rotate}
        />
      ))}
    </>
  )
}

export default NeonRing
