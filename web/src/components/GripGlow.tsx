// 링 위 흰 발광 하이라이트 — 원본의 "과노출 블룸" 재현
// 겹침 방식(블러 미사용, iOS 호환): 넓고 옅은 층 → 쨍한 백열 코어 + 방사형 구름
// active = 손가락으로 잡고 제어 중 → 발광이 강렬해짐 ("지금 이걸 제어한다" 피드백)
import { RADIUS, polar, arcPath } from './wheelGeo'

// [호 길이(±도), 선 폭, 투명도] — 평상시
const LAYERS_IDLE: [number, number, number][] = [
  [18, 14, 0.12],
  [15, 9, 0.28],
  [12, 5, 0.55],
  [10, 2.8, 1],
]

// 잡고 있을 때: 퍼지지 않고 중앙부만 응축되어 더 밝게 타오름
const LAYERS_ACTIVE: [number, number, number][] = [
  [18, 14, 0.14],
  [15, 9, 0.32],
  [12, 6, 0.7],
  [10, 3.6, 1],
  [7, 2.2, 1], // 백열 심지: 짧고 쨍한 중심 (잡았을 때만)
]

interface GripGlowProps {
  angleDeg: number // 하이라이트 중심 각도
  id: string // 그라데이션 id 접두어 (SVG마다 고유해야 함)
  active?: boolean // 손가락으로 잡고 제어 중인지
}

function GripGlow({ angleDeg, id, active }: GripGlowProps) {
  const layers = active ? LAYERS_ACTIVE : LAYERS_IDLE
  const tailSpread = 18 // 그라데이션 축(호 양 끝) 폭 — 잡아도 퍼지지 않음

  const center = polar(angleDeg, RADIUS)
  const tail1 = polar(angleDeg - tailSpread)
  const tail2 = polar(angleDeg + tailSpread)

  return (
    <g>
      <defs>
        {/* 구름 블룸용 방사형 그라데이션 (흰색 → 투명) */}
        <radialGradient id={`${id}-cloud`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity={active ? 0.62 : 0.45} />
          <stop offset="30%" stopColor="#ffffff" stopOpacity={active ? 0.2 : 0.14} />
          <stop offset="65%" stopColor="#ffffff" stopOpacity={active ? 0.06 : 0.04} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* 호 방향 선형 그라데이션: 끝 투명 → 중앙 백색 → 끝 투명 */}
        <linearGradient
          id={`${id}-line`}
          gradientUnits="userSpaceOnUse"
          x1={tail1.x}
          y1={tail1.y}
          x2={tail2.x}
          y2={tail2.y}
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="30%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 구름 블룸: 링 안팎으로 은은하게 번지는 빛 (잡으면 중심만 살짝 진해짐) */}
      <circle cx={center.x} cy={center.y} r={active ? 50 : 46} fill={`url(#${id}-cloud)`} />

      {/* 겹침 발광: 넓고 옅은 층부터 백열 코어까지 */}
      {layers.map(([spread, width, opacity]) => (
        <path
          key={width}
          d={arcPath(angleDeg, spread)}
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth={width}
          strokeOpacity={opacity}
        />
      ))}
    </g>
  )
}

export default GripGlow
