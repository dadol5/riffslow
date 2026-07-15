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
  metroOn: boolean // 메트로놈 클릭 on/off
  canMetro: boolean // BPM이 있어야 켤 수 있음
  onMetroToggle: () => void
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
  metroOn,
  canMetro,
  onMetroToggle,
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

      {/* 재생/일시정지 (원본: 왼쪽 아래 테두리 없는 삼각형 — P-02 중앙 버튼과 상태 동기화)
          + 반대편(오른쪽)에 메트로놈 토글 (사용자 결정) */}
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

        <button
          className={`metro-btn${metroOn ? ' on' : ''}`}
          onClick={onMetroToggle}
          disabled={!canMetro}
          aria-label="메트로놈"
        >
          {/* 메트로놈 모양: 사다리꼴 몸통 + 템포 눈금 3개 + 대각선 진자 + 받침 */}
          <svg viewBox="0 0 24 24" className="icon">
            <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
              {/* 몸통 (위가 좁은 사다리꼴) */}
              <path d="M9.6 3.5 h4.8 l3.9 17 h-12.6 z" />
              {/* 받침 (아랫부분 채움) */}
              <path d="M6.4 16.8 h11.2 l0.85 3.7 h-12.9 z" fill="currentColor" />
            </g>
            {/* 템포 눈금 3개 (왼쪽 위) */}
            <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M9.3 7.2 h2.6" />
              <path d="M9.7 9.8 h2.6" />
              <path d="M10.1 12.4 h2.6" />
            </g>
            {/* 진자 (몸통을 가로질러 오른쪽 위로 뻗음) */}
            <path
              d="M11.8 18.2 L20.6 3.8"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </>
  )
}

export default ProgressPage
