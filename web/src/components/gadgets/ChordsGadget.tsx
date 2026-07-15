// Chords 가젯 — 분석된 코드 진행이 재생 위치 따라 슬라이드되는 가로 타임라인
// 중앙 고정 플레이헤드(세로선) 기준으로 코드 블록들이 왼쪽으로 흘러감 (사용자 요청 UI)
// 블록 탭 = 해당 코드 시작점으로 이동. 코드명 아래 운지 다이어그램 표시 (좁은 블록은 이름만)
import type { ChordSegment } from '../../audio/chords'
import ChordDiagram from '../ChordDiagram'

// 타임라인 축척: 1초 = 50px (블록 폭이 코드 길이에 비례)
const PX_PER_SEC = 50

// 이보다 좁은 블록은 운지 다이어그램 생략 (이름만 — 그림이 찌그러지는 것 방지)
const MIN_DIAGRAM_PX = 52

interface ChordsGadgetProps {
  hasTrack: boolean
  analyzing: boolean // 분석 진행 중 여부
  chords: ChordSegment[] | null | undefined // undefined = 미분석, null = 분석 실패
  songKey: string | null | undefined // 예: "C minor" (표시 위치는 임시 — 사용자 미정)
  position: number // 현재 재생 위치 (초)
  onSeek: (pos: number) => void
}

function ChordsGadget({
  hasTrack,
  analyzing,
  chords,
  songKey,
  position,
  onSeek,
}: ChordsGadgetProps) {
  // 타임라인을 그릴 수 없는 상태들 — 안내 문구만
  if (!hasTrack || analyzing || chords == null || chords.length === 0) {
    let text: string
    if (!hasTrack) {
      text = '—'
    } else if (analyzing) {
      text = '코드 분석 중…'
    } else if (chords === null) {
      text = '코드를 찾지 못했어요'
    } else {
      text = '분석 대기 중…'
    }
    return <div className="chords-gadget empty">{text}</div>
  }

  return (
    <div className="chords-gadget">
      {/* KEY 표시 (임시 위치 — 오른쪽 위 구석) */}
      {songKey && <div className="chords-key">Key: {songKey}</div>}

      {/* 시간 기준선 (고정 — 코드 시작 눈금과 플레이헤드 점이 이 선 위에 놓임) */}
      <div className="chords-baseline" />

      {/* 코드 스트립: 중앙(50%)을 원점으로 재생 위치만큼 왼쪽으로 이동 */}
      <div
        className="chords-strip"
        style={{ transform: `translateX(${-position * PX_PER_SEC}px)` }}
      >
        {chords.map((seg, i) => {
          const active = position >= seg.start && position < seg.end
          // 다음 코드 시작까지의 공간이 좁으면 다이어그램 생략 (겹침 방지)
          const room = ((chords[i + 1]?.start ?? seg.end) - seg.start) * PX_PER_SEC
          return (
            <button
              key={i}
              className={`chord-item${active ? ' active' : ''}`}
              style={{ left: seg.start * PX_PER_SEC }}
              onClick={() => onSeek(seg.start)}
            >
              <span className="chord-name">{seg.chord}</span>
              {room >= MIN_DIAGRAM_PX && <ChordDiagram chord={seg.chord} />}
            </button>
          )
        })}
      </div>

      {/* 중앙 고정 플레이헤드 (세로선 + 기준선 위의 점) */}
      <div className="chords-playhead" />
    </div>
  )
}

export default ChordsGadget
