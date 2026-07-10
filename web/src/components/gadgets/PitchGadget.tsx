// G-03 Pitch 가젯 — 피치 체인저 (원본 재현: [− | +] 붙은 알약 버튼 + 값 표시)
// 탭당 0.5 반음 증감, 범위 ±12, 재생 중 실시간 반영

const STEP = 0.5
const MAX_SEMITONES = 12

interface PitchGadgetProps {
  pitch: number // 반음 단위 (±12)
  onChange: (semitones: number) => void
}

function PitchGadget({ pitch, onChange }: PitchGadgetProps) {
  const adjust = (dir: 1 | -1) => {
    const next = Math.max(-MAX_SEMITONES, Math.min(pitch + dir * STEP, MAX_SEMITONES))
    onChange(next)
  }

  // 원본 표기 재현: 피치 0일 때도 "0 semitones" (확정)
  const display = Number.isInteger(pitch) ? String(pitch) : pitch.toFixed(1)

  return (
    <div className="pitch-gadget">
      {/* −/+ 가 한 몸인 알약 버튼 (원본 스샷 확정) */}
      <div className="pitch-pill">
        <button onClick={() => adjust(-1)} disabled={pitch <= -MAX_SEMITONES}>
          −
        </button>
        <button onClick={() => adjust(1)} disabled={pitch >= MAX_SEMITONES}>
          +
        </button>
      </div>
      <span className="pitch-value">{display} semitones</span>
    </div>
  )
}

export default PitchGadget
