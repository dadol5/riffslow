// P-03 트랙 리스트 페이지 — 곡 목록/선택 재생/삭제 (핵심 개선 대상 ⭐)
import { formatTime } from '../utils/time'
import type { TrackMeta } from '../db/library'

interface TrackListPageProps {
  tracks: TrackMeta[]
  currentId: number | null // 현재 재생 곡 id (인디케이터 표시)
  onSelect: (meta: TrackMeta) => void
  onDelete: (e: React.MouseEvent, meta: TrackMeta) => void
}

function TrackListPage({ tracks, currentId, onSelect, onDelete }: TrackListPageProps) {
  if (tracks.length === 0) {
    return <p className="empty-note">곡이 없어요. 상단 + 버튼으로 추가하세요.</p>
  }

  return (
    <div className="track-list">
      {tracks.map((t) => (
        <div
          key={t.id}
          className={`track-row${t.id === currentId ? ' current' : ''}`}
          onClick={() => onSelect(t)}
        >
          {/* 현재 트랙 인디케이터 (설계서: 재생 중 곡 좌측 ▶) */}
          <span className="track-indicator">{t.id === currentId ? '▶' : ''}</span>
          <span className="track-name">{t.name}</span>
          {/* 스템 붙은 곡 표시 배지 */}
          {t.stemNames != null && t.stemNames.length > 0 && (
            <span className="track-stem-badge">STEM</span>
          )}
          <span className="track-duration">{formatTime(t.duration)}</span>
          <button className="track-delete" onClick={(e) => onDelete(e, t)}>
            삭제
          </button>
        </div>
      ))}
    </div>
  )
}

export default TrackListPage
