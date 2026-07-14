// BPM 가젯 — 자동 분석된 곡 BPM 표시 + 자물쇠 잠금/해제 + −/+ 수동 조절 (임시 UI, 추후 다듬기)
//
// BPM 값의 기준은 항상 "100% 속도일 때" (저장/메트로놈 그리드도 이 기준):
// - 🔒 잠김(기본): 조절 불가. 표시 숫자 = 기준값 × 현재 속도 (속도를 늦추면 같이 내려감)
// - 🔓 열림: −/+로 기준값 조절 (탭 ±1, 꾹 누르면 연속). 다시 잠그면 그 값이 100% 기준으로 확정
import { useEffect, useRef } from 'react'

const MIN_BPM = 20
const MAX_BPM = 400

// 홀드 연속 증감 타이밍: 첫 반복까지 지연 → 이후 빠르게 반복
const HOLD_DELAY_MS = 400
const HOLD_REPEAT_MS = 70

interface BpmGadgetProps {
  hasTrack: boolean
  analyzing: boolean // 분석 진행 중 여부
  bpm: number | null | undefined // 100% 기준 BPM (undefined = 미분석, null = 분석 실패)
  tempo: number // 현재 템포 % (잠김 상태의 실제 BPM 환산 표시용)
  locked: boolean // 자물쇠 상태 (잠김 = 조절 불가 + 속도 반영 표시)
  onChange: (bpm: number) => void
  onToggleLock: () => void
}

function BpmGadget({
  hasTrack,
  analyzing,
  bpm,
  tempo,
  locked,
  onChange,
  onToggleLock,
}: BpmGadgetProps) {
  // 홀드 반복 중에도 최신 bpm을 읽기 위한 미러 (setInterval 클로저는 prop이 낡기 때문)
  const bpmRef = useRef(bpm)
  bpmRef.current = bpm
  const timerRef = useRef<number | null>(null)

  const step = (dir: 1 | -1) => {
    // 분석 실패(?)여도 수동으로 잡을 수 있게 — 값이 없으면 120부터 시작
    const cur = bpmRef.current ?? 120
    onChange(Math.max(MIN_BPM, Math.min(cur + dir, MAX_BPM)))
  }

  // 누르는 동안 연속 증감 (포인터를 떼거나 벗어나면 중단)
  const holdStart = (dir: 1 | -1) => {
    step(dir) // 탭 즉시 1회
    timerRef.current = window.setTimeout(() => {
      timerRef.current = window.setInterval(() => step(dir), HOLD_REPEAT_MS)
    }, HOLD_DELAY_MS)
  }

  const holdEnd = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current) // setTimeout/setInterval 모두 같은 id 공간이라 이걸로 충분
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // 언마운트(탭 전환) 시 홀드 타이머 정리
  useEffect(() => holdEnd, [])

  // 표시 문구 결정: 곡 없음 → 자리 표시 / 분석 중 / 실패 / 값
  // 잠김 = 속도 반영한 실제 BPM, 열림 = 조절 중인 100% 기준값
  let display: string
  if (!hasTrack) {
    display = '—'
  } else if (analyzing) {
    display = '분석 중…'
  } else if (bpm == null) {
    display = '?' // 분석 실패 — 🔓 열고 −/+로 직접 설정
  } else {
    display = String(locked ? Math.round((bpm * tempo) / 100) : bpm)
  }

  const canStep = hasTrack && !analyzing && !locked

  return (
    <div className="bpm-gadget">
      <button
        className="bpm-adjust"
        onPointerDown={() => holdStart(-1)}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
        disabled={!canStep || (bpm != null && bpm <= MIN_BPM)}
      >
        −
      </button>

      {/* 숫자 + 자물쇠를 한 묶음으로 붙여서 −/+ 간격은 자물쇠 이전과 동일하게 유지 */}
      <div className="bpm-center">
        <div className="bpm-display">
          <span className="bpm-value">{display}</span>
          <span className="bpm-unit">BPM</span>
          {/* 잠김 + 속도 변경 상태에선 100% 기준값을 작게 병기 / 열림 상태에선 기준 안내 */}
          {bpm != null && locked && tempo !== 100 && (
            <span className="bpm-effective">{bpm} @ 100%</span>
          )}
          {hasTrack && !analyzing && !locked && (
            <span className="bpm-effective">100% 기준값 설정</span>
          )}
        </div>

        {/* 자물쇠: 잠김 = 속도 반영 표시 전용, 열림 = 100% 기준값 조절 모드 */}
        <button
          className={`bpm-lock${locked ? '' : ' open'}`}
          onClick={onToggleLock}
          disabled={!hasTrack || analyzing}
          aria-label={locked ? 'BPM 잠금 해제' : 'BPM 잠금'}
        >
          <svg viewBox="0 0 24 24" className="icon">
            {/* 자물쇠 본체 */}
            <rect
              x="5"
              y="11"
              width="14"
              height="9"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            {/* 고리: 잠김 = 양쪽 다 걸림 / 열림 = 오른쪽이 들려 있음 */}
            {locked ? (
              <path
                d="M8 11 V8 a4 4 0 0 1 8 0 V11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            ) : (
              <path
                d="M8 11 V8 a4 4 0 0 1 8 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            )}
          </svg>
        </button>
      </div>

      <button
        className="bpm-adjust"
        onPointerDown={() => holdStart(1)}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
        disabled={!canStep || (bpm != null && bpm >= MAX_BPM)}
      >
        +
      </button>
    </div>
  )
}

export default BpmGadget
