// P-01 Progress Wheel 페이지 — 위치 탐색 + 시간 표시 + 마커
// (마커/루프 조작 버튼은 하단 Markers 가젯에 — 원본 구조)
import Wheel from './Wheel'
import type { Loop } from '../db/library'

interface ProgressPageProps {
  position: number
  duration: number
  hasTrack: boolean // 곡이 로드됐는지 (버튼 활성화 판단)
  isPlaying: boolean
  loops: Loop[]
  posMarkers: number[]
  trackS: number | null
  trackE: number | null
  onSeek: (pos: number) => void
  onMarkerTap: (pos: number) => void
  onLoopStartTap: (pos: number) => void
  onDeleteMarker: (index: number) => void
  onDeleteLoop: (index: number) => void
  onDeleteLoopEnd: (index: number) => void
  onDeleteTrackS: () => void
  onDeleteTrackE: () => void
  onTogglePlay: () => void
}

function ProgressPage({
  position,
  duration,
  hasTrack,
  isPlaying,
  loops,
  posMarkers,
  trackS,
  trackE,
  onSeek,
  onMarkerTap,
  onLoopStartTap,
  onDeleteMarker,
  onDeleteLoop,
  onDeleteLoopEnd,
  onDeleteTrackS,
  onDeleteTrackE,
  onTogglePlay,
}: ProgressPageProps) {
  return (
    <>
      <Wheel
        position={position}
        duration={duration}
        onSeek={onSeek}
        loops={loops}
        markers={posMarkers}
        trackStart={trackS}
        trackEnd={trackE}
        onMarkerTap={onMarkerTap}
        onLoopStartTap={onLoopStartTap}
        onDeleteMarker={onDeleteMarker}
        onDeleteLoop={onDeleteLoop}
        onDeleteLoopEnd={onDeleteLoopEnd}
        onDeleteTrackS={onDeleteTrackS}
        onDeleteTrackE={onDeleteTrackE}
      />

      {/* 재생/일시정지 (원본: 왼쪽 아래 테두리 없는 삼각형 — P-02 중앙 버튼과 상태 동기화) */}
      <div className="play-row">
        <button
          className="play-tri"
          onClick={onTogglePlay}
          disabled={!hasTrack}
          aria-label="재생/일시정지"
        >
          <svg viewBox="0 0 32 32">
            {isPlaying ? (
              <g>
                <rect x="6" y="5" width="7" height="22" rx="1.5" />
                <rect x="19" y="5" width="7" height="22" rx="1.5" />
              </g>
            ) : (
              <path d="M 8 4 L 28 16 L 8 28 Z" />
            )}
          </svg>
        </button>
      </div>
    </>
  )
}

export default ProgressPage
