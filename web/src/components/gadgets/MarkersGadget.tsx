// G-04 Markers 가젯 — 마커 조작의 중심 패널 (원본 레이아웃 재현)
// 라벨(+start/stop 보조 라벨) 위, 큰 핀 글리프 아래. 링 위 마커 핀과 동일 체계.
// 개별 삭제는 링 위 핀을 2초 홀드 (원본 방식) — 별도 해제 버튼 없음

// 핀 아이콘 (원 + 꼬리 화살 — 링 위 마커와 같은 생김새)
function PinIcon({ symbol }: { symbol?: string }) {
  return (
    <svg viewBox="0 0 28 38" className="pin-icon">
      <circle cx="14" cy="12" r="9" fill="none" strokeWidth="2.2" />
      <path
        d="M 7 25 L 14 33 L 21 25"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {symbol && (
        <text x="14" y="16" textAnchor="middle">
          {symbol}
        </text>
      )}
    </svg>
  )
}

interface MarkersGadgetProps {
  hasTrack: boolean
  canLoopStop: boolean // 끝점이 비어 있는 루프가 있어야 stop을 찍을 수 있음
  canClearAll: boolean
  onAddMarker: () => void
  onLoopStart: () => void
  onLoopStop: () => void
  onTrackS: () => void
  onTrackE: () => void
  onClearAll: () => void
}

function MarkersGadget({
  hasTrack,
  canLoopStop,
  canClearAll,
  onAddMarker,
  onLoopStart,
  onLoopStop,
  onTrackS,
  onTrackE,
  onClearAll,
}: MarkersGadgetProps) {
  return (
    <div className="markers-gadget">
      <div className="marker-group">
        <span className="group-lbl">
          Position
          <br />
          Marker
        </span>
        <div className="group-btns">
          <button className="pin-btn" onClick={onAddMarker} disabled={!hasTrack}>
            <PinIcon />
          </button>
        </div>
      </div>

      <div className="marker-group">
        <span className="group-lbl">Loop Markers</span>
        <span className="group-sub">start&ensp;stop</span>
        <div className="group-btns">
          <button className="pin-btn" onClick={onLoopStart} disabled={!hasTrack}>
            <PinIcon symbol="›" />
          </button>
          <button className="pin-btn" onClick={onLoopStop} disabled={!hasTrack || !canLoopStop}>
            <PinIcon symbol="‹" />
          </button>
        </div>
      </div>

      <div className="marker-group">
        <span className="group-lbl">Track Markers</span>
        <span className="group-sub">start&ensp;stop</span>
        <div className="group-btns">
          <button className="pin-btn" onClick={onTrackS} disabled={!hasTrack}>
            <PinIcon symbol="S" />
          </button>
          <button className="pin-btn" onClick={onTrackE} disabled={!hasTrack}>
            <PinIcon symbol="E" />
          </button>
        </div>
      </div>

      <div className="marker-group">
        <span className="group-lbl">
          Delete All
          <br />
          Markers
        </span>
        <div className="group-btns">
          <button className="pin-btn text delete" onClick={onClearAll} disabled={!canClearAll}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export default MarkersGadget
