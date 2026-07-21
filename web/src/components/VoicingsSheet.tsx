// 코드표 레이어 — 선택된 코드를 한 번 더 탭하면 열림: 같은 코드의 운지 포지션 목록
// 현재 적용 중인 운지가 발광(선택) 상태로 열리고, 다른 운지 탭 = 소리 + 선택 이동,
// [확인] = 그 운지로 변경 ("같은 코드 전부" 토글: 켜짐 = 곡 전체, 꺼짐 = 탭한 구간만)
// (Playlist/Mixer와 같은 바텀 시트 패턴 — 추후 코드 수정 폼으로 확장 예정)
import { useState } from 'react'
import { voicingsFor, type Shape } from '../utils/voicings'
import { prettyChord } from '../utils/music'
import ChordDiagram from './ChordDiagram'

interface VoicingsSheetProps {
  chord: string // 표시 조 기준 코드명 (피치를 옮겼으면 옮긴 조)
  currentShape: Shape | null // 지금 이 코드에 적용된 운지 (null = 기본 운지 = 목록 첫 번째)
  onTapShape: (shape: Shape) => void // 운지 탭 = 그 포지션 운지로 미리듣기
  onApply: (shape: Shape, applyAll: boolean) => void // 확인 = 운지 변경
  onClose: () => void
}

const keyOf = (s: Shape) => s.frets.join(',')

function VoicingsSheet({ chord, currentShape, onTapShape, onApply, onClose }: VoicingsSheetProps) {
  const generated = voicingsFor(chord)
  // 저장된 운지가 생성 목록에 없으면(생성 로직이 바뀐 옛 저장 등) 맨 앞에 끼워서 보여줌
  const shapes =
    currentShape && !generated.some((s) => keyOf(s) === keyOf(currentShape))
      ? [currentShape, ...generated]
      : generated

  // 선택된 포지션 — 초기값 = 현재 적용 중인 운지 (기본 운지면 목록 첫 번째)
  const initial = currentShape ?? shapes[0]
  const [selKey, setSelKey] = useState(initial ? keyOf(initial) : '')
  const [applyAll, setApplyAll] = useState(false) // 켜짐 = 이 곡의 같은 코드 전부
  const selShape = shapes.find((s) => keyOf(s) === selKey)

  return (
    <>
      {/* 딤 배경 — 탭하면 닫힘 (변경 없이 취소) */}
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="voicings-sheet">
        <div className="sheet-header">
          <span className="sheet-title">{prettyChord(chord)}</span>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {shapes.length === 0 ? (
          <div className="voicings-empty">이 코드의 운지를 몰라요</div>
        ) : (
          <div className="voicings-scroll">
            {shapes.map((s, i) => (
              <button
                key={keyOf(s)}
                className={`voicing-cell${keyOf(s) === selKey ? ' selected' : ''}`}
                onClick={() => {
                  setSelKey(keyOf(s))
                  onTapShape(s) // 탭 = 이 운지 소리로 바로 확인
                }}
              >
                <ChordDiagram chord={chord} shape={s} />
                <span className="voicing-pos">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div className="voicings-footer">
          <button
            className={`voicings-all${applyAll ? ' on' : ''}`}
            onClick={() => setApplyAll((a) => !a)}
          >
            같은 코드 전부
          </button>
          <button
            className="voicings-apply"
            disabled={!selShape}
            onClick={() => selShape && onApply(selShape, applyAll)}
          >
            확인
          </button>
        </div>
        <div className="voicings-hint">
          운지 탭 = 소리 미리듣기 · 확인 = 이 운지로 변경{applyAll ? ' (같은 코드 전부)' : ' (이 구간만)'}
        </div>
      </div>
    </>
  )
}

export default VoicingsSheet
