// P-02 템포 휠 — 링 회전 = 템포 20~250% 조절 (피치 유지), 중앙 = 재생/일시정지
import { useRef, useState } from 'react'
import { SIZE, CENTER, RADIUS, TOUCH_BAND } from './wheelGeo'
import GripGlow from './GripGlow'
import NeonRing from './NeonRing'

// 템포-각도 매핑: 100% = 12시 방향, 시계방향 = 빨라짐
// (원본 스샷들은 각도가 서로 불일치 — 절대 기준이 없어 직관적인 100%=상단으로 확정)
const TEMPO_ANCHOR = 100 // 이 템포일 때 하이라이트가 12시 방향
const TEMPO_PER_TURN = 18 // 한 바퀴 회전 = 템포 18%p 변화 (원본 실기기 실측: 100%→한 바퀴→118%)
const MIN_PERCENT = 20
const MAX_PERCENT = 250

// 하이라이트(그립)를 잡았을 때만 회전 시작 (원본 방식 — 링 아무데나 잡으면 스와이프와 충돌)
const GRIP_GRAB_SPREAD = 36 // 하이라이트 중심 기준 ±36° 안에서만 잡기 판정

interface TempoWheelProps {
  tempo: number // 현재 템포 %
  hasTrack: boolean
  isPlaying: boolean
  onTempoChange: (percent: number) => void // 휠 회전 → 새 템포 %
  onTogglePlay: () => void
}

function TempoWheel({
  tempo,
  hasTrack,
  isPlaying,
  onTempoChange,
  onTogglePlay,
}: TempoWheelProps) {
  // 드래그 상태 (진행 휠과 같은 방식 — 가속은 없음: 템포는 미세 조절이 중요)
  const dragRef = useRef<{ lastAngle: number; value: number } | null>(null)
  // 그립을 잡고 있는 동안 발광 강화 ("제어 중" 피드백)
  const [grabbing, setGrabbing] = useState(false)

  const toWheelCoords = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - CENTER
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - CENTER
    return { x, y }
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { x, y } = toWheelCoords(e)
    // 링 위에서 시작한 터치만 후보 (중앙 트랜스포트/바깥은 통과)
    const dist = Math.sqrt(x * x + y * y)
    if (dist < RADIUS - TOUCH_BAND || dist > RADIUS + TOUCH_BAND) return

    // 원본 방식: 하이라이트(그립) 근처를 잡았을 때만 회전 시작
    // → 링의 다른 부분에서 시작한 터치는 페이지 스와이프로 흘려보냄
    const pointerAngle = (Math.atan2(y, x) * 180) / Math.PI
    let diff = pointerAngle - hlAngle
    diff = ((diff % 360) + 540) % 360 - 180 // -180~180 범위로 정규화
    if (Math.abs(diff) > GRIP_GRAB_SPREAD) return

    e.stopPropagation() // 그립을 잡았다 = 휠 제스처 우선, 페이지 스와이프 차단
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      lastAngle: pointerAngle,
      value: tempo,
    }
    setGrabbing(true)
  }

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return

    const { x, y } = toWheelCoords(e)
    const angle = (Math.atan2(y, x) * 180) / Math.PI

    let delta = angle - drag.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    drag.lastAngle = angle

    // 회전량 → 템포 변화량 (시계방향 = 빨라짐)
    drag.value = Math.max(
      MIN_PERCENT,
      Math.min(drag.value + (delta / 360) * TEMPO_PER_TURN, MAX_PERCENT),
    )
    onTempoChange(drag.value)
  }

  const handleUp = () => {
    dragRef.current = null
    setGrabbing(false)
  }

  // 하이라이트 각도 = 현재 템포의 위치 표시 (원본: 그립 지점이자 템포 각도 표시)
  const hlAngle = -90 + ((tempo - TEMPO_ANCHOR) / TEMPO_PER_TURN) * 360

  return (
    <svg
      className="wheel wheel-tempo"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {/* 링: 가는 네온 선 + 발광 — 템포 그립 방향이 가장 밝음 (원본 재현) */}
      <NeonRing angleDeg={hlAngle} id="ring-grad-tempo" />

      {/* 템포 하이라이트: 흰 발광 구간 (잡는 순간 강렬해짐 — "제어 중" 피드백) */}
      <GripGlow angleDeg={hlAngle} id="grip-bloom-tempo" active={grabbing} />

      {/* 중앙 트랜스포트: 작은 네온 원 + 재생/일시정지 (원본 P-02 중앙)
          |◀◀ ▶▶| 앞뒤 버튼은 플레이리스트 재생 중에만 노출 — Phase 2에서 추가 */}
      <defs>
        {/* 중앙 원 주변의 발광 (원본: 원 뒤로 은은하게 퍼지는 방사형 광) */}
        <radialGradient id="tempo-center-bloom">
          <stop offset="0%" style={{ stopColor: 'var(--neon)' }} stopOpacity="0.28" />
          <stop offset="45%" style={{ stopColor: 'var(--neon)' }} stopOpacity="0.1" />
          <stop offset="75%" style={{ stopColor: 'var(--neon)' }} stopOpacity="0.03" />
          <stop offset="100%" style={{ stopColor: 'var(--neon)' }} stopOpacity="0" />
        </radialGradient>
        {/* 트랜스포트 링의 선 그라데이션: 밝은 쪽(백열)이 큰 링의 하이라이트와 같은 방향
            (원본 확정: 하나의 광원이 두 링을 함께 비추는 구도 — 회전으로 정렬) */}
        <linearGradient id="tempo-center-ring" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="25%" style={{ stopColor: 'var(--neon-soft)' }} />
          <stop offset="60%" style={{ stopColor: 'var(--neon)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--neon-deep)' }} />
        </linearGradient>
      </defs>
      <g
        className={`transport${hasTrack ? '' : ' disabled'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => hasTrack && onTogglePlay()}
      >
        {/* 중앙 발광: 원 뒤로 퍼지는 그라데이션 광 */}
        <circle cx={CENTER} cy={CENTER} r={78} fill="url(#tempo-center-bloom)" />
        {/* 터치 판정 영역 (보이는 원보다 넓게) */}
        <circle cx={CENTER} cy={CENTER} r={48} fill="transparent" />
        {/* 작은 링: 겹침 방식 발광 (큰 링과 동일 — 밝은 쪽이 그립과 일직선) */}
        {(
          [
            [16, 0.06],
            [10, 0.12],
            [6, 0.28],
            [2.8, 1],
          ] as [number, number][]
        ).map(([width, opacity]) => (
          <circle
            key={width}
            cx={CENTER}
            cy={CENTER}
            r={37}
            fill="none"
            stroke="url(#tempo-center-ring)"
            strokeWidth={width}
            strokeOpacity={opacity}
            transform={`rotate(${hlAngle} ${CENTER} ${CENTER})`}
          />
        ))}
        {isPlaying ? (
          // 일시정지 아이콘 (막대 2개 — 이모지 대신 SVG로 그려 네온 색 유지)
          <g className="transport-icon">
            <rect x={CENTER - 10} y={CENTER - 11} width={7} height={22} rx={1.5} />
            <rect x={CENTER + 3} y={CENTER - 11} width={7} height={22} rx={1.5} />
          </g>
        ) : (
          // 재생 아이콘 (삼각형)
          <path
            className="transport-icon"
            d={`M ${CENTER - 7} ${CENTER - 12} L ${CENTER + 13} ${CENTER} L ${CENTER - 7} ${CENTER + 12} Z`}
          />
        )}
      </g>
    </svg>
  )
}

export default TempoWheel
