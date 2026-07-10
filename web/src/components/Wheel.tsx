import { useRef } from 'react'
import { formatTime } from '../utils/time'

// ── 휠 크기 상수 (SVG 내부 좌표계 기준 — 실제 표시 크기는 CSS가 결정) ──
const SIZE = 300 // SVG 전체 크기
const CENTER = SIZE / 2 // 중심 좌표
const RADIUS = 120 // 링 중심선 반지름
const RING_WIDTH = 30 // 링 두께

// 회전 감도(기본): 천천히 돌릴 때 한 바퀴 = 몇 초 이동 (원본 앱과 대조하며 튜닝 예정)
const SECONDS_PER_TURN = 30

// ── 조그휠 가속: 빠르게 돌릴수록 이동 배율 증가 (iPod 클릭휠 방식) ──
const ACCEL_REF_SPEED = 0.15 // 이 회전 속도(도/ms)에서 배율 2배가 됨 — 낮출수록 가속이 민감해짐
const ACCEL_POWER = 1.8 // 가속 곡선의 가파름 — 높일수록 빠른 회전에 배율이 급격히 붙음
const ACCEL_MAX = 20 // 최대 배율 (아무리 빨리 돌려도 이 이상은 안 붙음)

// 터치 판정 여유: 링 두께보다 넓게 잡음 (모바일 손가락 조작 대비)
const TOUCH_MARGIN = 25

// 부모(App)로부터 받는 데이터/콜백 정의 — Java 인터페이스와 비슷한 역할
interface WheelProps {
  position: number // 현재 재생 위치 (초)
  duration: number // 곡 전체 길이 (초)
  onSeek: (pos: number) => void // 휠 회전으로 위치 변경 시 부모에게 알림
  loopStart?: number | null // A/B 루프 시작 (초) — 없으면 표시 안 함
  loopEnd?: number | null // A/B 루프 끝 (초)
  markers?: number[] // 위치 마커 목록 (초)
  onMarkerTap?: (pos: number) => void // 마커 탭 → 해당 위치로 즉시 이동
  trackStart?: number | null // 시작(S) 마커 (초)
  trackEnd?: number | null // 끝(E) 마커 (초)
}

// 시간(초) → 링 위 각도(도). 12시 방향 = 곡 시작, 시계방향 진행
function timeToAngle(time: number, duration: number): number {
  return (time / duration) * 360 - 90
}

// 각도(도) → 링 위 좌표
function polar(angleDeg: number): { x: number; y: number } {
  return {
    x: CENTER + RADIUS * Math.cos((angleDeg * Math.PI) / 180),
    y: CENTER + RADIUS * Math.sin((angleDeg * Math.PI) / 180),
  }
}

function Wheel({
  position,
  duration,
  onSeek,
  loopStart,
  loopEnd,
  markers,
  onMarkerTap,
  trackStart,
  trackEnd,
}: WheelProps) {
  // 드래그 상태 (화면에 그릴 필요 없는 값이므로 ref 사용)
  const dragRef = useRef<{
    lastAngle: number // 직전 포인터 각도
    lastTime: number // 직전 이벤트 시각 (ms) — 회전 속도 계산용
    pos: number // 드래그로 계산 중인 현재 위치 (초)
  } | null>(null)

  // 포인터 좌표 → SVG 좌표계의 중심 기준 (x, y)
  const toWheelCoords = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // 화면 픽셀 → SVG 좌표 변환 (휠이 화면에서 몇 px로 표시되든 동일하게 동작)
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - CENTER
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - CENTER
    return { x, y }
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { x, y } = toWheelCoords(e)

    // 터치 시작점이 링 위일 때만 회전 판정 (설계서 확정 사항)
    // → 나중에 링 밖 터치는 페이지 스와이프로 흘려보내기 위한 기반
    const dist = Math.sqrt(x * x + y * y)
    const inner = RADIUS - RING_WIDTH / 2 - TOUCH_MARGIN
    const outer = RADIUS + RING_WIDTH / 2 + TOUCH_MARGIN
    if (dist < inner || dist > outer) return

    // 드래그가 휠 밖으로 나가도 포인터 추적 유지
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      lastAngle: (Math.atan2(y, x) * 180) / Math.PI,
      lastTime: e.timeStamp,
      pos: position,
    }
  }

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return // 드래그 중이 아니면 무시

    const { x, y } = toWheelCoords(e)
    const angle = (Math.atan2(y, x) * 180) / Math.PI

    // 직전 각도와의 차이 (±180° 경계를 넘을 때 짧은 쪽으로 보정)
    let delta = angle - drag.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360

    // 회전 속도 (도/ms) → 가속 배율 계산
    const dt = e.timeStamp - drag.lastTime
    const speed = dt > 0 ? Math.abs(delta) / dt : 0
    const factor = Math.min(1 + (speed / ACCEL_REF_SPEED) ** ACCEL_POWER, ACCEL_MAX)

    drag.lastAngle = angle
    drag.lastTime = e.timeStamp

    // 회전량 × 가속 배율 → 시간 이동량 (드래그 중 위치는 ref에 직접 누적)
    const moved = (delta / 360) * SECONDS_PER_TURN * factor
    drag.pos = Math.max(0, Math.min(drag.pos + moved, duration))
    onSeek(drag.pos)
  }

  const handleUp = () => {
    dragRef.current = null
  }

  // 현재 재생 위치의 발광점 좌표 (곡 전체 = 360°)
  const progressAngle = duration > 0 ? timeToAngle(position, duration) : -90
  const { x: dotX, y: dotY } = polar(progressAngle)

  // 루프 구간 호(arc) 경로: A 각도에서 B 각도까지 시계방향
  let loopArcPath: string | null = null
  if (loopStart != null && loopEnd != null && duration > 0) {
    const a1 = timeToAngle(loopStart, duration)
    const a2 = timeToAngle(loopEnd, duration)
    const p1 = polar(a1)
    const p2 = polar(a2)
    // SVG arc 문법: A 반지름x 반지름y 회전 큰호여부 방향(1=시계) 끝좌표
    const largeArc = a2 - a1 > 180 ? 1 : 0
    loopArcPath = `M ${p1.x} ${p1.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${p2.x} ${p2.y}`
  }

  return (
    <svg
      className="wheel"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {/* 링 본체 */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        fill="none"
        stroke="#2a2521"
        strokeWidth={RING_WIDTH}
      />

      {/* 루프 구간: 링 위 밝은 발광 호 (설계서: 루프 활성 시 구간 발광) */}
      {loopArcPath && (
        <path
          d={loopArcPath}
          fill="none"
          stroke="#ffa040"
          strokeWidth={RING_WIDTH - 10}
          strokeLinecap="round"
          className="glow-arc"
        />
      )}

      {/* 위치 마커(○ 글리프): 탭하면 해당 지점으로 이동 */}
      {duration > 0 &&
        markers?.map((m, i) => {
          const { x, y } = polar(timeToAngle(m, duration))
          return (
            <g
              key={i}
              className="marker"
              onPointerDown={(e) => {
                e.stopPropagation() // 휠 회전 판정으로 번지지 않게 차단
                onMarkerTap?.(m)
              }}
            >
              {/* 터치 판정 영역 (보이는 글리프보다 넓게 — 모바일 대비) */}
              <circle cx={x} cy={y} r={16} fill="transparent" />
              {/* ○ 글리프 */}
              <circle
                cx={x}
                cy={y}
                r={7}
                fill="none"
                stroke="#fff"
                strokeWidth={2.5}
                className="marker-glyph"
              />
            </g>
          )
        })}

      {/* 시작(S)/끝(E) 마커 글리프 */}
      {duration > 0 &&
        [
          { time: trackStart, label: 'S' },
          { time: trackEnd, label: 'E' },
        ].map(
          ({ time, label }) =>
            time != null && (
              <text
                key={label}
                {...polar(timeToAngle(time, duration))}
                dy={5}
                className="se-glyph"
                textAnchor="middle"
              >
                {label}
              </text>
            ),
        )}

      {/* 현재 재생 위치 발광점 */}
      <circle cx={dotX} cy={dotY} r={9} fill="#ff6a00" className="glow-dot" />

      {/* 중앙 시간 표시 (추후 DSEG 폰트 적용 예정) */}
      <text x={CENTER} y={CENTER - 34} className="time-label" textAnchor="middle">
        time in track
      </text>
      <text x={CENTER} y={CENTER - 6} className="time-value" textAnchor="middle">
        {formatTime(position)}
      </text>
      <text x={CENTER} y={CENTER + 26} className="time-label" textAnchor="middle">
        track length
      </text>
      <text x={CENTER} y={CENTER + 54} className="time-value" textAnchor="middle">
        {formatTime(duration)}
      </text>
    </svg>
  )
}

export default Wheel
