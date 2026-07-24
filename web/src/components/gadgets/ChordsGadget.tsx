// Chords 가젯 — 분석된 코드 진행이 재생 위치 따라 슬라이드되는 가로 타임라인
// 중앙 고정 플레이헤드(세로선) 기준으로 코드 블록들이 왼쪽으로 흘러감 (사용자 요청 UI)
// 블록 탭 = 해당 코드 시작점으로 이동 + 미리듣기 콜백(일시정지 중 기타 스트럼은 App이 판단)
//          + 탭한 코드 이름이 네온 펄스로 "눌렸다" 표시 + 선택 유지(테두리 링)
// 선택된 코드 한 번 더 탭 = 코드표 레이어(운지 포지션 목록) 열기
// 타임라인 좌우 드래그 = 재생 위치 탐색 (손가락 1:1)
// 코드명 아래 운지 다이어그램 표시 (좁은 블록은 이름만)
import { useMemo, useRef, useState } from 'react'
import type { ChordSegment } from '../../audio/chords'
import { prettyChord, transposeName } from '../../utils/music'
import { shapeMatches, type Shape } from '../../utils/voicings'
import ChordDiagram from '../ChordDiagram'

// 타임라인 축척: 1초 = 50px (블록 폭이 코드 길이에 비례)
const PX_PER_SEC = 50

// 이보다 좁은 블록은 운지 다이어그램 생략 (이름만 — 그림이 찌그러지는 것 방지)
const MIN_DIAGRAM_PX = 52

// 이 픽셀 미만 움직임은 드래그가 아닌 탭으로 판정 (코드 탭 시크와 공존)
const DRAG_THRESHOLD_PX = 5

// 길게 누름 = 코드 추가 (핀 홀드 삭제와 같은 감각의 시간)
const HOLD_ADD_MS = 700

interface ChordsGadgetProps {
  hasTrack: boolean
  analyzing: boolean // 분석 진행 중 여부
  chords: ChordSegment[] | null | undefined // undefined = 미분석, null = 분석 실패
  position: number // 현재 재생 위치 (초)
  duration: number // 곡 길이 (초) — 드래그 탐색 범위 제한용
  pitch: number // 피치 반음 — 코드명/운지를 이동된 조로 표시 (사용자 요청)
  bpm: number | null | undefined // BPM 그리드 — 같은 코드가 여러 마디면 마디마다 반복 표시용
  bpmOffset: number | null // 첫 박 위치 (초) — 박자 점 그리드 정렬용
  barPhase: number // 마디 첫박 위상 (0~3, bpmOffset 기준 박 인덱스 mod 4 — App이 수동 지정/다수결로 결정)
  chordShapes: Record<string, Shape> // 코드별로 고른 운지 ("같은 코드 전부 적용" — 키 = 표시 조 코드명)
  onSeek: (pos: number) => void
  onPreview: (chord: string, shape?: Shape) => void // 코드 탭 미리듣기 (적용된 운지 소리로)
  onShowVoicings: (chord: string, segIndex: number) => void // 선택된 코드 한 번 더 탭 = 코드표 레이어
  onAddChord: (startSec: number) => void // 타임라인 길게 누름 = 그 지점(박 스냅)에 코드 추가
}

function ChordsGadget({
  hasTrack,
  analyzing,
  chords,
  position,
  duration,
  pitch,
  bpm,
  bpmOffset,
  barPhase,
  chordShapes,
  onSeek,
  onPreview,
  onShowVoicings,
  onAddChord,
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

  // 탭 피드백: 탭한 아이템의 코드 이름에 네온 펄스 애니메이션 (seq로 연타 시 재시작)
  const [tapped, setTapped] = useState<{ item: number; seq: number } | null>(null)
  const tapTimerRef = useRef(0)

  // 선택 표시: 마지막에 탭한 코드가 "지금 선택됨" 테두리 유지 (다른 코드를 탭할 때까지)
  // 아이템 식별은 시작 시각으로 — 곡이 바뀌면 일치하는 아이템이 없어 자연히 사라짐
  // (추후 계획: 선택된 코드를 한 번 더 탭하면 수정 폼 — 그래서 재탭 토글 해제는 안 함)
  const [selected, setSelected] = useState<number | null>(null)

  // 길게 누름(코드 추가) 판정 — 타이머 발동 시점의 최신 재생 위치를 읽기 위한 미러
  // (재생 중엔 스트립이 흘러가므로, 시트가 열리는 순간 손가락 아래 보이는 지점을 기준으로)
  const positionRef = useRef(position)
  positionRef.current = position
  const holdTimerRef = useRef(0)

  const cancelHold = () => window.clearTimeout(holdTimerRef.current)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return // 두 번째 손가락 무시
    suppressTapRef.current = false
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startPos: position,
      moved: false,
    }
    // 길게 누름 예약: 0.7초 동안 안 움직이고 안 떼면 그 지점에 코드 추가
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    holdTimerRef.current = window.setTimeout(() => {
      suppressTapRef.current = true // 이어지는 click(시크/선택/해제) 무시
      dragRef.current = null // 홀드가 발동하면 이 제스처의 드래그 판정 종료
      // 화면 x → 원곡 시간: 중앙(플레이헤드) 기준 거리 환산
      const t = positionRef.current + (x - rect.left - rect.width / 2) / PX_PER_SEC
      let snapped = Math.min(duration, Math.max(0, t))
      // 박 스냅 (사용자 확정 — 반마디 코드도 넣을 수 있게 마디가 아닌 박 단위)
      if (bpm) {
        const beatLen = 60 / bpm
        const offset = bpmOffset ?? 0
        snapped = offset + Math.round((snapped - offset) / beatLen) * beatLen
        snapped = Math.min(duration, Math.max(0, snapped))
      }
      onAddChord(snapped)
    }, HOLD_ADD_MS)
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
      cancelHold() // 드래그로 확정되면 길게 누름 취소
      // 드래그 확정 후에만 캡처 — 캡처가 탭의 click 이벤트를 가로채는 것 방지
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    // 왼쪽으로 끌면 앞으로 (스트립이 손가락에 붙어 따라옴, 1초=50px 그대로)
    const pos = Math.min(duration, Math.max(0, drag.startPos - dx / PX_PER_SEC))
    onSeek(pos)
  }

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelHold() // 홀드 시간 전에 떼면 탭/드래그로 처리
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  // 표시용 아이템: 같은 코드가 여러 마디 이어지면 마디(4박, 4/4 가정) 단위로 쪼개서
  // 마디마다 이름/운지/눈금점을 반복 표시 (사용자 요청 — 두 마디째부터 코드가 안 보이던 문제)
  // 분석 구간은 마디 스냅되어 있어 긴 구간의 시작 = 다운비트 → 반복 지점도 마디 첫박에 떨어짐
  const barLen = bpm ? 240 / bpm : null // 한 마디 길이 (원곡 기준 초)
  // segIndex = 원본 세그먼트 인덱스 — 마디로 쪼개도 편집(운지 적용)은 원본 구간 기준이어야 함
  const items: (ChordSegment & { segIndex: number })[] = []
  ;(chords ?? []).forEach((seg, segIndex) => {
    if (!barLen) {
      items.push({ ...seg, segIndex })
      return
    }
    let t = seg.start
    while (t < seg.end - 1e-3) {
      let end = t + barLen
      // 꼬리가 1/4 마디 미만(경계 반올림 오차 수준)일 때만 흡수 — 반 마디짜리 꼬리는
      // 새 마디 첫박에서 시작하는 진짜 코드라 자기 표시를 가져야 함 (실곡 44.95s Bb 피드백)
      if (seg.end - end < barLen * 0.25) end = seg.end
      items.push({ start: t, end, chord: seg.chord, shape: seg.shape, segIndex })
      t = end
    }
  })

  // 박자 점: BPM 그리드(첫 박 + k·60/bpm)를 곡 전체에 점으로 표시 (코드 유무와 무관 — 사용자 요청)
  // 계층 2단(사용자 확정): 마디 첫박 = 중간 크기, 나머지 박 = 아주 흐리게 — 코드 점(6px)이 주인공 유지
  // position이 바뀌어도 그리드는 그대로라 useMemo로 같은 엘리먼트를 재사용 (재생 중 리렌더 비용 0)
  const beatDots = useMemo(() => {
    if (!bpm || duration <= 0) return null
    const beatLen = 60 / bpm
    // 첫 박 오프셋을 [0, beatLen) 안으로 정규화 — 곡 처음(0초)부터 그리드를 깔기 위함
    const offset = bpmOffset ?? 0
    const phase = offset - Math.floor(offset / beatLen) * beatLen
    // 첫박 위상(barPhase)은 bpmOffset 기준 박 인덱스 — 여기 k는 정규화된 phase 기준이라 변환
    const downPhase = (((barPhase + Math.floor(offset / beatLen)) % 4) + 4) % 4
    const count = Math.floor((duration - phase) / beatLen) + 1
    return (
      <div className="chords-beats">
        {Array.from({ length: count }, (_, k) => (
          <span
            key={k}
            className={`beat-dot${k % 4 === downPhase ? ' bar' : ''}`}
            style={{ left: (phase + k * beatLen) * PX_PER_SEC }}
          />
        ))}
      </div>
    )
  }, [bpm, bpmOffset, barPhase, duration])

  // 플레이헤드(중앙 세로선)가 운지 그림 위를 지나는 동안만 선 가운데를 뚫음 (그림이 없으면 온전한 선)
  // 그림은 시작 눈금 오른쪽에 붙음: x = 시작 ~ +49px(그림 폭 — 패딩 2px는 -2px 보정으로 상쇄)
  // 판정은 가장자리보다 4px 안쪽 — 스트립 transform 트랜지션(90ms)이 늦게 따라와서
  // 가장자리 기준이면 진입 전에 미리 뚫린 것처럼 보임 (그림 테두리 여백이라 안 가려짐)
  const gapped = items.some((seg, i) => {
    const room = ((items[i + 1]?.start ?? seg.end) - seg.start) * PX_PER_SEC
    if (room < MIN_DIAGRAM_PX) return false // 이 코드는 운지 그림이 없음
    const dx = (position - seg.start) * PX_PER_SEC
    return dx > 4 && dx < 45
  })

  // 타임라인을 그릴 수 없는 상태들 — 안내 문구만
  // (빈 배열은 제외: 전부 삭제했거나 분석이 못 찾은 상태 — 빈 타임라인을 그려서 길게 누름 추가 가능)
  if (!hasTrack || analyzing || chords == null) {
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
      onClick={(e) => {
        // 코드가 아닌 빈 곳 탭 = 선택 해제 (코드 탭은 아이템 핸들러가 처리, 드래그 후 클릭은 무시)
        if (suppressTapRef.current) return
        if ((e.target as HTMLElement).closest('.chord-item')) return
        setSelected(null)
      }}
    >
      {/* 시간 기준선 (고정 — 코드 시작 눈금과 플레이헤드 점이 이 선 위에 놓임) */}
      <div className="chords-baseline" />

      {/* 코드 스트립: 중앙(50%)을 원점으로 재생 위치만큼 왼쪽으로 이동 */}
      <div
        className="chords-strip"
        style={{ transform: `translateX(${-position * PX_PER_SEC}px)` }}
      >
        {/* 박자 점은 코드 아이템보다 먼저 — 현재 코드의 네온 눈금점이 위에 그려지게 */}
        {beatDots}
        {items.map((seg, i) => {
          const active = position >= seg.start && position < seg.end
          // 다음 코드 시작까지의 공간이 좁으면 다이어그램 생략 (겹침 방지)
          const room = ((items[i + 1]?.start ?? seg.end) - seg.start) * PX_PER_SEC
          // 피치가 옮겨져 있으면 코드도 이동된 조로 표시 (저장 데이터는 원조 그대로)
          const shown = transposeName(seg.chord, pitch)
          // 적용된 운지: 구간별 지정 > 코드별 지정 > 기본 (구간별 지정은 피치가 바뀌어
          // 코드와 안 맞게 되면 무시하고 기본으로 — 잘못된 그림/소리 방지)
          const custom =
            (seg.shape && shapeMatches(seg.shape, shown) ? seg.shape : undefined) ??
            chordShapes[shown]
          return (
            <button
              key={i}
              className={`chord-item${active ? ' active' : ''}`}
              style={{ left: seg.start * PX_PER_SEC }}
              onClick={() => {
                // 드래그였으면 탭 시크 무시 (드래그로 이미 위치를 옮겼음)
                if (suppressTapRef.current) return
                // 이미 선택된 코드를 한 번 더 탭 = 코드표 레이어 (시크/스트럼/펄스 없이)
                if (selected === seg.start) {
                  onShowVoicings(shown, seg.segIndex)
                  return
                }
                onSeek(seg.start)
                onPreview(shown, custom) // 일시정지 중이면 App이 기타 스트럼으로 (적용 운지 소리)
                setSelected(seg.start) // 선택 표시는 다른 코드를 탭할 때까지 유지
                // 탭 표시: 같은 코드를 연타해도 seq가 바뀌어 애니메이션이 다시 시작됨
                window.clearTimeout(tapTimerRef.current)
                setTapped((t) => ({ item: i, seq: (t?.seq ?? 0) + 1 }))
                tapTimerRef.current = window.setTimeout(() => setTapped(null), 550)
              }}
            >
              <span
                key={tapped?.item === i ? `tap${tapped.seq}` : undefined}
                className={`chord-name${tapped?.item === i ? ' tapped' : ''}${
                  selected === seg.start ? ' selected' : ''
                }`}
              >
                {prettyChord(shown)}
              </span>
              {room >= MIN_DIAGRAM_PX && <ChordDiagram chord={shown} shape={custom} />}
            </button>
          )
        })}
      </div>

      {/* 중앙 고정 플레이헤드 (세로선 + 기준선 위의 점) — 운지 그림 위를 지날 땐 그림 구간 뚫림,
          코드 이름은 z-index로 선 위에 올라가 글자 획이 자연스럽게 선을 덮음 */}
      <div className={`chords-playhead${gapped ? ' gapped' : ''}`} />
    </div>
  )
}

export default ChordsGadget
