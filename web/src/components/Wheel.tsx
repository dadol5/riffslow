import { useRef, useState } from 'react'
import { formatTime } from '../utils/time'
import { SIZE, CENTER, RADIUS, TOUCH_BAND, polar } from './wheelGeo'
import GripGlow from './GripGlow'
import NeonRing from './NeonRing'
import type { Loop } from '../db/library'

// 회전 감도: 한 바퀴 = 곡 전체 (발광 하이라이트가 손가락과 정확히 1:1로 붙는 유일한 비율)
// — 발광 각도가 "곡 전체=360°" 기준이므로, 조작도 같은 비율이어야 손가락을 따라옴
// — 가속 불필요 (한 바퀴면 곡 끝까지 가므로), 미세 탐색은 마커 탭이 보조

// 마커 홀드 삭제: 길게 누르는 시간 (사용자 요청으로 1초 — App.css의 pin-hold-delete 애니메이션과 싱크)
const HOLD_DELETE_MS = 1000
// 홀드가 아니라 "탭"으로 인정하는 최대 시간
const TAP_MS = 300

interface WheelProps {
  position: number // 현재 재생 위치 (초)
  duration: number // 곡 전체 길이 (초)
  onSeek: (pos: number) => void // 휠 회전으로 위치 변경 시 부모에게 알림
  loops?: Loop[] // 구간 루프 목록 (여러 개 가능)
  markers?: number[] // 위치 마커 목록 (초)
  trackStart?: number | null // 시작(S) 마커 (초)
  trackEnd?: number | null // 끝(E) 마커 (초)
  onMarkerTap?: (pos: number) => void // 위치 마커 탭 → 해당 지점 이동
  onLoopStartTap?: (pos: number) => void // 루프 시작 핀 탭 → 그 지점부터 재생 (원본 확정)
  onDeleteMarker?: (index: number) => void // 위치 마커 홀드 삭제
  onDeleteLoop?: (index: number) => void // 루프 시작 핀 홀드 → 시작점만 삭제
  onDeleteLoopEnd?: (index: number) => void // 루프 끝 핀 홀드 → 끝점만 삭제 (미완성으로 되돌림)
  onDeleteTrackS?: () => void // S 마커 홀드 삭제
  onDeleteTrackE?: () => void // E 마커 홀드 삭제
}

// 시간(초) → 링 위 각도(도). 12시 방향 = 곡 시작, 시계방향 진행
function timeToAngle(time: number, duration: number): number {
  return (time / duration) * 360 - 90
}

// 링 바깥에 붙는 핀 글리프 (원본 재현: 원 + 꼬리 화살 — 꼬리가 링 위 지점을 가리킴)
// 인터랙션: 짧은 탭 = onTap / 1초 홀드 = 커지며 흐려지다 삭제 (도중에 떼면 취소)
const PIN_OFFSET = 18 // 링에서 핀 중심까지 거리

function Pin({
  angleDeg,
  symbol,
  onTap,
  onHoldDelete,
}: {
  angleDeg: number
  symbol?: string // 원 안의 글자 (없으면 빈 원 = 위치 마커)
  onTap?: () => void
  onHoldDelete?: () => void
}) {
  const [holding, setHolding] = useState(false) // 홀드 중 = 삭제 애니메이션 재생
  const holdRef = useRef<{ timer: number; startedAt: number } | null>(null)

  const cancelHold = () => {
    if (holdRef.current) {
      clearTimeout(holdRef.current.timer)
      holdRef.current = null
    }
    setHolding(false)
  }

  const handleDown = (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation() // 휠 회전/페이지 스와이프로 번지지 않게 차단
    e.currentTarget.setPointerCapture(e.pointerId) // 손가락이 살짝 움직여도 추적 유지

    const startedAt = e.timeStamp
    if (onHoldDelete) {
      // 홀드 시간 경과 후 삭제 예약 (떼면 취소)
      const timer = window.setTimeout(() => {
        holdRef.current = null
        setHolding(false)
        onHoldDelete()
      }, HOLD_DELETE_MS)
      holdRef.current = { timer, startedAt }
      setHolding(true)
    } else {
      holdRef.current = { timer: 0, startedAt }
    }
  }

  const handleUp = (e: React.PointerEvent<SVGGElement>) => {
    const hold = holdRef.current
    cancelHold()
    // 짧게 눌렀다 뗀 경우만 탭으로 인정
    if (hold && e.timeStamp - hold.startedAt < TAP_MS) {
      onTap?.()
    }
  }

  const { x, y } = polar(angleDeg, RADIUS + PIN_OFFSET)
  return (
    <g
      className={`pin${onTap || onHoldDelete ? ' tappable' : ''}`}
      // 핀을 해당 각도 위치로 이동 + 꼬리가 링을 향하도록 회전
      transform={`translate(${x} ${y}) rotate(${angleDeg + 90})`}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={cancelHold}
    >
      {/* 홀드 삭제 애니메이션은 안쪽 그룹에 적용 (배치 transform과 분리) */}
      <g className={`pin-body${holding ? ' holding' : ''}`}>
        {/* 터치 판정 영역 (보이지 않아야 함 — pin-hit 클래스로 테두리 제외) */}
        <circle className="pin-hit" cy={-5} r={22} fill="transparent" />
        {/* 원 (원본 실측: 핀 지름 ≈ 링의 8%) */}
        <circle cy={-10} r={11} fill="none" strokeWidth={2.4} />
        {/* 꼬리 화살 (링 방향) */}
        <path
          d="M -8 3.5 L 0 14 L 8 3.5"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {symbol && (
          <text y={-5} textAnchor="middle" className="pin-symbol">
            {symbol}
          </text>
        )}
      </g>
    </g>
  )
}

// 핀 원들이 놓이는 반경 (루프 연결선이 이 반경을 따라 그려짐)
const PIN_RING_R = RADIUS + PIN_OFFSET + 10

// 두 각도 사이를 임의 반경으로 잇는 호 (원본: 루프 핀끼리 링 바깥에서 선으로 연결됨)
function arcBetweenAt(radius: number, startAngle: number, endAngle: number): string {
  const p1 = polar(startAngle, radius)
  const p2 = polar(endAngle, radius)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x} ${p2.y}`
}

function Wheel({
  position,
  duration,
  onSeek,
  loops,
  markers,
  trackStart,
  trackEnd,
  onMarkerTap,
  onLoopStartTap,
  onDeleteMarker,
  onDeleteLoop,
  onDeleteLoopEnd,
  onDeleteTrackS,
  onDeleteTrackE,
}: WheelProps) {
  // 드래그 상태 (화면에 그릴 필요 없는 값이므로 ref 사용)
  const dragRef = useRef<{
    lastAngle: number // 직전 포인터 각도
    pos: number // 드래그로 계산 중인 현재 위치 (초)
  } | null>(null)
  // 잡고 있는 동안 발광 강화 ("제어 중" 피드백 — 화면에 반영되므로 state)
  const [grabbing, setGrabbing] = useState(false)

  // 포인터 좌표 → SVG 좌표계의 중심 기준 (x, y)
  const toWheelCoords = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - CENTER
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - CENTER
    return { x, y }
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { x, y } = toWheelCoords(e)

    // 터치 시작점이 링 위일 때만 회전 판정 (설계서 확정 사항)
    // 링 밖/중앙 터치는 그대로 흘려보냄 → 부모(App)의 페이지 스와이프로 판정됨
    const dist = Math.sqrt(x * x + y * y)
    if (dist < RADIUS - TOUCH_BAND || dist > RADIUS + TOUCH_BAND) return

    // 링을 잡았다 = 휠 제스처 우선 → 페이지 스와이프로 번지지 않게 차단 (설계서 확정)
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      lastAngle: (Math.atan2(y, x) * 180) / Math.PI,
      pos: position,
    }
    setGrabbing(true)
  }

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return

    const { x, y } = toWheelCoords(e)
    const angle = (Math.atan2(y, x) * 180) / Math.PI

    // 직전 각도와의 차이 (±180° 경계를 넘을 때 짧은 쪽으로 보정)
    let delta = angle - drag.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360

    drag.lastAngle = angle

    // 회전량 → 시간 이동량: 한 바퀴 = 곡 전체 (발광이 손가락에 1:1로 붙음)
    const moved = (delta / 360) * duration
    drag.pos = Math.max(0, Math.min(drag.pos + moved, duration))
    onSeek(drag.pos)
  }

  const handleUp = () => {
    dragRef.current = null
    setGrabbing(false)
  }

  // 현재 재생 위치의 링 위 각도 (곡 전체 = 360°)
  const progressAngle = duration > 0 ? timeToAngle(position, duration) : -90

  return (
    <svg
      className="wheel"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {/* 링: 가는 네온 선 + 발광 — 재생 위치 방향이 가장 밝음 (원본 재현) */}
      <NeonRing angleDeg={progressAngle} id="ring-grad-progress" />

      {/* 구간 루프들: 발광 호 + 시작(›)/끝(‹) 핀 — 여러 개 가능 */}
      {duration > 0 &&
        loops?.map((loop, i) => {
          const startAngle = timeToAngle(loop.start, duration)
          return (
            <g key={`loop-${i}`}>
              {/* 루프 연결선: 시작 핀 → 끝 핀을 링 바깥에서 잇는 가는 선 (원본 재현) */}
              {loop.end !== null && (
                <path
                  className="loop-line"
                  d={arcBetweenAt(PIN_RING_R, startAngle, timeToAngle(loop.end, duration))}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}
              {/* 시작 핀: 탭 = 그 지점부터 재생 / 홀드 = 시작점만 삭제 */}
              <Pin
                angleDeg={startAngle}
                symbol="›"
                onTap={() => onLoopStartTap?.(loop.start)}
                onHoldDelete={() => onDeleteLoop?.(i)}
              />
              {/* 끝 핀: 홀드 = 끝점만 삭제 (시작점만 남음) */}
              {loop.end !== null && (
                <Pin
                  angleDeg={timeToAngle(loop.end, duration)}
                  symbol="‹"
                  onHoldDelete={() => onDeleteLoopEnd?.(i)}
                />
              )}
            </g>
          )
        })}

      {/* 재생 위치 하이라이트: 링 위의 하얗게 빛나는 구간 (잡고 돌리는 동안 강렬해짐) */}
      {duration > 0 && (
        <GripGlow angleDeg={progressAngle} id="grip-bloom-progress" active={grabbing} />
      )}

      {/* 위치 마커 핀 (빈 원 + 꼬리): 탭 = 이동 / 홀드 = 삭제 */}
      {duration > 0 &&
        markers?.map((m, i) => (
          <Pin
            key={`marker-${i}`}
            angleDeg={timeToAngle(m, duration)}
            onTap={() => onMarkerTap?.(m)}
            onHoldDelete={() => onDeleteMarker?.(i)}
          />
        ))}

      {/* 시작(S)/끝(E) 마커 핀: 홀드 = 삭제 */}
      {duration > 0 && trackStart != null && (
        <Pin
          angleDeg={timeToAngle(trackStart, duration)}
          symbol="S"
          onHoldDelete={onDeleteTrackS}
        />
      )}
      {duration > 0 && trackEnd != null && (
        <Pin
          angleDeg={timeToAngle(trackEnd, duration)}
          symbol="E"
          onHoldDelete={onDeleteTrackE}
        />
      )}

      {/* 중앙 시간 표시: DSEG 디지털 + 꺼진 세그먼트 잔상(88:88) — 원본 계기판 디테일 */}
      <text x={CENTER} y={CENTER - 56} className="time-label" textAnchor="middle">
        time in track
      </text>
      <text x={CENTER} y={CENTER - 12} className="time-ghost big" textAnchor="middle">
        88:88
      </text>
      <text x={CENTER} y={CENTER - 12} className="time-value big" textAnchor="middle">
        {formatTime(position)}
      </text>
      <text x={CENTER} y={CENTER + 38} className="time-label" textAnchor="middle">
        track length
      </text>
      <text x={CENTER} y={CENTER + 72} className="time-ghost" textAnchor="middle">
        88:88
      </text>
      <text x={CENTER} y={CENTER + 72} className="time-value" textAnchor="middle">
        {formatTime(duration)}
      </text>
    </svg>
  )
}

export default Wheel
