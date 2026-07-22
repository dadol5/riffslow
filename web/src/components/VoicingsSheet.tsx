// 코드표/코드 수정 레이어 — 선택된 코드를 한 번 더 탭하면 열림
// 상단 칩 = [현재 코드][관련 코드 4개(같은 근음 3종+나란한조)] + 🔍 검색(입력창+칩 필터)
// 칩/검색으로 다른 코드를 고르면 아래 운지 목록이 그 코드로 바뀌고,
// [확인] = 그 코드(+선택한 운지)로 변경 ("같은 코드 전부" 스위치: 켜짐 = 곡 전체, 꺼짐 = 탭한 구간만)
// + 재생 중 코드 소리 설정 2개(탭 소리 / 자동 스트럼 — 앱 전역, localStorage 유지)
// (Playlist/Mixer와 같은 바텀 시트 패턴)
import { useState } from 'react'
import { voicingsFor, relatedChords, ALL_CHORDS, type Shape } from '../utils/voicings'
import { prettyChord } from '../utils/music'
import ChordDiagram from './ChordDiagram'

interface VoicingsSheetProps {
  chord: string // 원래(탭한) 코드 — 표시 조 기준 (피치를 옮겼으면 옮긴 조)
  currentShape: Shape | null // 지금 이 코드에 적용된 운지 (null = 기본 운지 = 목록 첫 번째)
  sameCount: number // 이 곡에서 같은 코드 구간 수 ("전부 바꾸기" 개수 표시)
  strumWhilePlaying: boolean // 재생 중에도 코드 탭 소리 (앱 설정)
  autoStrum: boolean // 재생 중 코드 전환마다 자동 스트럼 (앱 설정)
  onToggleStrumWhilePlaying: () => void
  onToggleAutoStrum: () => void
  onTapShape: (shape: Shape, chord: string) => void // 운지 탭 = 그 코드/운지로 미리듣기
  onApply: (chord: string, shape: Shape, applyAll: boolean) => void // 확인 = 코드/운지 변경
  onClose: () => void
}

const keyOf = (s: Shape) => s.frets.join(',')

// iOS 스타일 토글 스위치 (참고 앱의 Replace all 토글 모양)
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="switch-knob" />
    </button>
  )
}

function VoicingsSheet({
  chord,
  currentShape,
  sameCount,
  strumWhilePlaying,
  autoStrum,
  onToggleStrumWhilePlaying,
  onToggleAutoStrum,
  onTapShape,
  onApply,
  onClose,
}: VoicingsSheetProps) {
  // 지금 보고 있는 코드 (칩/검색으로 전환 — 확인 시 이 코드로 변경됨)
  const [viewChord, setViewChord] = useState(chord)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  // 검색으로 골랐던 코드들 — 다른 칩으로 옮겨도 사라지지 않고 맨 앞에 유지 (사용자 요청)
  const [extraChips, setExtraChips] = useState<string[]>([])

  const isOriginal = viewChord === chord
  const generated = voicingsFor(viewChord)
  // 원래 코드를 보는 중이고 저장된 운지가 생성 목록에 없으면(옛 생성 로직 저장 등) 맨 앞에 끼움
  const shapes =
    isOriginal && currentShape && !generated.some((s) => keyOf(s) === keyOf(currentShape))
      ? [currentShape, ...generated]
      : generated

  // 선택된 포지션 — 원래 코드면 현재 적용 운지, 다른 코드로 전환하면 그 코드의 기본 운지
  const initial = isOriginal ? (currentShape ?? shapes[0]) : shapes[0]
  const [selKey, setSelKey] = useState(initial ? keyOf(initial) : '')
  const [applyAll, setApplyAll] = useState(false) // 켜짐 = 이 곡의 같은 코드 전부
  const selShape = shapes.find((s) => keyOf(s) === selKey)

  // 상단 칩: 원래 코드 + 관련 코드 (검색으로 고른 코드는 extraChips로 맨 앞에 붙음)
  const baseChips = [chord, ...relatedChords(chord)]
  const chips = [...extraChips, ...baseChips]

  // 칩/검색으로 코드 전환 — 운지 선택은 그 코드 기준으로 리셋
  const switchChord = (c: string) => {
    setViewChord(c)
    setSearching(false)
    setQuery('')
    // 관련 칩에 없는 코드(검색 선택)는 맨 앞에 추가 — 다른 칩으로 옮겨도 유지됨
    if (!baseChips.includes(c)) {
      setExtraChips((prev) => [c, ...prev.filter((x) => x !== c)])
    }
    const list = voicingsFor(c)
    const init = c === chord ? (currentShape ?? list[0]) : list[0]
    setSelKey(init ? keyOf(init) : '')
  }

  // 검색 필터: 입력을 코드명 앞부분과 대소문자/♭ 표기 무관하게 매칭
  const q = query.trim().toLowerCase().replace(/♭/g, 'b')
  const searchResults = q === '' ? ALL_CHORDS : ALL_CHORDS.filter((c) => c.toLowerCase().startsWith(q))


  return (
    <>
      {/* 딤 배경 — 탭하면 닫힘 (변경 없이 취소) */}
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="voicings-sheet">
        <div className="sheet-header voicings-header">
          {searching ? (
            <input
              className="chord-search-input"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="코드 검색 (예: G, Bbm7)"
            />
          ) : (
            <div className="chord-chips">
              {/* 원래 코드 + 관련 코드(같은 근음 3종 + 나란한조) + 검색으로 고른 코드 */}
              {chips.map((c) => (
                <button
                  key={c}
                  className={`chord-chip${viewChord === c ? ' on' : ''}`}
                  onClick={() => switchChord(c)}
                >
                  {prettyChord(c)}
                </button>
              ))}
            </div>
          )}
          {/* 돋보기 = 검색 열기 (검색 중엔 검색만 닫기) */}
          <button
            className="chord-search-btn"
            aria-label={searching ? '검색 닫기' : '코드 검색'}
            onClick={() => {
              setSearching((s) => !s)
              setQuery('')
            }}
          >
            <svg viewBox="0 0 24 24" className="icon">
              <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="M15 15 L20 20" />
              </g>
            </svg>
          </button>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {searching ? (
          /* 검색 결과 칩 (탭 = 그 코드로 전환) */
          <div className="chord-search-grid">
            {searchResults.map((c) => (
              <button key={c} className="chord-chip" onClick={() => switchChord(c)}>
                {prettyChord(c)}
              </button>
            ))}
            {searchResults.length === 0 && <div className="voicings-empty">일치하는 코드 없음</div>}
          </div>
        ) : shapes.length === 0 ? (
          <div className="voicings-empty">이 코드의 운지를 몰라요</div>
        ) : (
          <div className="voicings-scroll">
            {shapes.map((s, i) => (
              <button
                key={keyOf(s)}
                className={`voicing-cell${keyOf(s) === selKey ? ' selected' : ''}`}
                onClick={() => {
                  setSelKey(keyOf(s))
                  onTapShape(s, viewChord) // 탭 = 이 코드/운지 소리로 바로 확인
                }}
              >
                <ChordDiagram chord={viewChord} shape={s} />
                <span className="voicing-pos">{i + 1}</span>
              </button>
            ))}
          </div>
        )}

        {!searching && (
          <>
            {/* 적용 범위 (참고 앱의 "Replace all N chords" 스위치) */}
            <div className="voicings-row">
              <span className="voicings-row-label">
                {isOriginal
                  ? `같은 ${prettyChord(chord)} 코드 ${sameCount}개 전부 바꾸기`
                  : `같은 ${prettyChord(chord)} 코드 ${sameCount}개 전부 ${prettyChord(viewChord)}로 바꾸기`}
              </span>
              <Switch on={applyAll} label="같은 코드 전부 바꾸기" onToggle={() => setApplyAll((a) => !a)} />
            </div>

            {/* 재생 중 코드 소리 설정 (앱 전역 — 닫아도 유지) */}
            <div className="voicings-divider" />
            <div className="voicings-row">
              <span className="voicings-row-label">재생 중 코드 소리</span>
              <Switch on={strumWhilePlaying} label="재생 중 코드 소리" onToggle={onToggleStrumWhilePlaying} />
            </div>
            <div className="voicings-row">
              <span className="voicings-row-label">재생 중 코드 자동 스트럼</span>
              <Switch on={autoStrum} label="재생 중 코드 자동 스트럼" onToggle={onToggleAutoStrum} />
            </div>

            <button
              className="voicings-apply"
              disabled={!selShape}
              onClick={() => selShape && onApply(viewChord, selShape, applyAll)}
            >
              확인
            </button>
          </>
        )}
      </div>
    </>
  )
}

export default VoicingsSheet
