// G-03 Pitch 가젯 — 피치 체인저 (원본 재현: [− | +] 붙은 알약 버튼 + 값 표시)
// 탭당 1반음 증감, 표시는 0.5씩(원본 앱 표기: 0.5 = 반음 — 2026-07-17 사용자 확정), 범위 ±12반음(표시 ±6)
// + 곡의 조표(KEY) 표시 (사용자 결정: Chords 패널에서 이곳으로 이동) — 피치를 옮기면 바뀐 조도 병기

import { prettyChord, transposeName } from '../../utils/music'

const STEP = 1
const MAX_SEMITONES = 12

interface PitchGadgetProps {
  pitch: number // 반음 단위 (±12)
  songKey: string | null | undefined // 곡의 조표 (예: "F major") — 미분석/실패면 표시 생략
  onChange: (semitones: number) => void
}

function PitchGadget({ pitch, songKey, onChange }: PitchGadgetProps) {
  const adjust = (dir: 1 | -1) => {
    // 구버전 저장값(0.5 단위)은 첫 탭에서 정수 반음으로 스냅
    const next = Math.max(-MAX_SEMITONES, Math.min(Math.round(pitch) + dir * STEP, MAX_SEMITONES))
    onChange(next)
  }

  // 원본 표기 재현: 반음 = 표시 0.5 (내부/저장/조표 계산은 반음 단위 그대로), 0일 때도 "0 semitones" (확정)
  const displayVal = pitch / 2
  const display = Number.isInteger(displayVal) ? String(displayVal) : displayVal.toFixed(2).replace(/0$/, '')

  // 피치를 옮긴 상태면 "원조 → 이동된 조"로 병기 (비정수 피치는 transposeName이 원본을 돌려줘 병기 생략됨)
  const shifted = songKey != null && pitch !== 0 ? transposeName(songKey, pitch) : null

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
      <div className="pitch-info">
        <span className="pitch-value">{display} semitones</span>
        {songKey != null && (
          <span className="pitch-key">
            Key: {prettyChord(songKey)}
            {shifted != null && shifted !== songKey && ` → ${prettyChord(shifted)}`}
          </span>
        )}
      </div>
    </div>
  )
}

export default PitchGadget
