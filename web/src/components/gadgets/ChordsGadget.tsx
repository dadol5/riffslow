// Chords 가젯 — 분석된 코드 진행이 재생 위치 따라 슬라이드되는 가로 타임라인
// 중앙 고정 플레이헤드(세로선) 기준으로 코드 블록들이 왼쪽으로 흘러감 (사용자 요청 UI)
// 블록 탭 = 해당 코드 시작점으로 이동. 타임라인 좌우 드래그 = 재생 위치 탐색 (손가락 1:1)
// 코드명 아래 운지 다이어그램 표시 (좁은 블록은 이름만)
import { useRef, useState } from 'react'
import type { ChordSegment } from '../../audio/chords'
import { prettyChord, transposeName } from '../../utils/music'
import ChordDiagram from '../ChordDiagram'

// 타임라인 축척: 1초 = 50px (블록 폭이 코드 길이에 비례)
const PX_PER_SEC = 50

// 이보다 좁은 블록은 운지 다이어그램 생략 (이름만 — 그림이 찌그러지는 것 방지)
const MIN_DIAGRAM_PX = 52

// 이 픽셀 미만 움직임은 드래그가 아닌 탭으로 판정 (코드 탭 시크와 공존)
const DRAG_THRESHOLD_PX = 5

interface ChordsGadgetProps {
  hasTrack: boolean
  analyzing: boolean // 분석 진행 중 여부
  chords: ChordSegment[] | null | undefined // undefined = 미분석, null = 분석 실패
  position: number // 현재 재생 위치 (초)
  duration: number // 곡 길이 (초) — 드래그 탐색 범위 제한용
  pitch: number // 피치 반음 — 코드명/운지를 이동된 조로 표시 (사용자 요청)
  onSeek: (pos: number) => void
}

function ChordsGadget({
  hasTrack,
  analyzing,
  chords,
  position,
  duration,
  pitch,
  onSeek,
}: ChordsGadgetProps) {
  // 드래그 상태 — moved가 true가 된 뒤로는 탭(코드 시크)을 무시
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startPos: number
    moved: boolean
  } | null>(null)
  // 탭 억제 플래그 — click은 pointerup "이후"에 오므로 dragRef와 별도로 유지
  const suppressTapRef = useRef(false)
  const [dragging, setDragging] = useState(false) // 드래그 중 transition 해제용

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return // 두 번째 손가락 무시
    suppressTapRef.current = false
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startPos: position,
      moved: false,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    const dx = e.clientX - drag.startX
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      drag.moved = true
      suppressTapRef.current = true
      setDragging(true)
      // 드래그 확정 후에만 캡처 — 캡처가 탭의 click 이벤트를 가로채는 것 방지
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    // 왼쪽으로 끌면 앞으로 (스트립이 손가락에 붙어 따라옴, 1초=50px 그대로)
    const pos = Math.min(duration, Math.max(0, drag.startPos - dx / PX_PER_SEC))
    onSeek(pos)
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

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
    <div
      className={`chords-gadget${dragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
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
          // 피치가 옮겨져 있으면 코드도 이동된 조로 표시 (저장 데이터는 원조 그대로)
          const shown = transposeName(seg.chord, pitch)
          return (
            <button
              key={i}
              className={`chord-item${active ? ' active' : ''}`}
              style={{ left: seg.start * PX_PER_SEC }}
              onClick={() => {
                // 드래그였으면 탭 시크 무시 (드래그로 이미 위치를 옮겼음)
                if (suppressTapRef.current) return
                onSeek(seg.start)
              }}
            >
              <span className="chord-name">{prettyChord(shown)}</span>
              {room >= MIN_DIAGRAM_PX && <ChordDiagram chord={shown} />}
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
