// BPM 가젯 — 자동 분석된 곡 BPM 표시 + −/+ 수동 조절 (임시 UI, 추후 다듬기)
// 탭 = ±1, 꾹 누르면 연속 증감 (반배/두배 교정도 이걸로 — 사용자 결정으로 ×2/÷2 제거)
// 메트로놈 on/off는 P-01 재생 버튼 반대편으로 이동 (사용자 결정)
import { useEffect, useRef } from 'react'

const MIN_BPM = 20
const MAX_BPM = 400

// 홀드 연속 증감 타이밍: 첫 반복까지 지연 → 이후 빠르게 반복
const HOLD_DELAY_MS = 400
const HOLD_REPEAT_MS = 70

interface BpmGadgetProps {
  hasTrack: boolean
  analyzing: boolean // 분석 진행 중 여부
  bpm: number | null | undefined // undefined = 미분석, null = 분석 실패
  tempo: number // 현재 템포 % (연습 속도 기준 BPM 환산 표시용)
  onChange: (bpm: number) => void
}

function BpmGadget({ hasTrack, analyzing, bpm, tempo, onChange }: BpmGadgetProps) {
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
  let display: string
  if (!hasTrack) {
    display = '—'
  } else if (analyzing) {
    display = '분석 중…'
  } else if (bpm == null) {
    display = '?' // 분석 실패 (비트 불명확) — −/+로 직접 맞추거나 추후 탭 템포로
  } else {
    display = String(bpm)
  }

  return (
    <div className="bpm-gadget">
      <button
        className="bpm-adjust"
        onPointerDown={() => holdStart(-1)}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
        disabled={!hasTrack || analyzing || (bpm != null && bpm <= MIN_BPM)}
      >
        −
      </button>

      <div className="bpm-display">
        <span className="bpm-value">{display}</span>
        <span className="bpm-unit">BPM</span>
        {/* 배속 반영한 실제 연습 템포 (100%일 땐 동일하니 숨김) */}
        {bpm != null && tempo !== 100 && (
          <span className="bpm-effective">{Math.round((bpm * tempo) / 100)} @ {tempo}%</span>
        )}
      </div>

      <button
        className="bpm-adjust"
        onPointerDown={() => holdStart(1)}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onPointerCancel={holdEnd}
        disabled={!hasTrack || analyzing || (bpm != null && bpm >= MAX_BPM)}
      >
        +
      </button>
    </div>
  )
}

export default BpmGadget
