// 가젯 탭 바 — 모든 페이지 공통 하단 영역 (COM-01 ⑦, 가로 스크롤)
// 미구현 가젯은 비활성 표시 (추후 SET-01에서 탭 on/off 관리 예정)

export type GadgetId = 'volume' | 'markers' | 'pitch' | 'playlist'

// 탭 정의: id가 null이면 아직 미구현 (자리만 재현)
const TABS: { id: GadgetId | null; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'markers', label: 'Markers' },
  { id: 'pitch', label: 'Pitch' },
  { id: 'playlist', label: 'Playlist' }, // 곡 목록 (P-03 페이지 대신 가젯으로)
  { id: null, label: 'Equaliser' },
  { id: null, label: 'Balance' },
  { id: null, label: 'BPM' },
]

interface GadgetBarProps {
  active: GadgetId
  playlistOpen: boolean // Playlist는 패널이 아니라 시트(레이어) 토글이라 별도 상태
  onSelect: (gadget: GadgetId) => void
}

function GadgetBar({ active, playlistOpen, onSelect }: GadgetBarProps) {
  // 탭 강조 여부: Playlist는 시트 열림 상태, 나머지는 선택된 가젯
  const isActive = (id: GadgetId | null) =>
    id === 'playlist' ? playlistOpen : id === active

  return (
    <nav className="gadget-tabs">
      {TABS.map(({ id, label }) => (
        <button
          key={label}
          className={`gadget-tab${isActive(id) ? ' active' : ''}`}
          disabled={id === null}
          onClick={() => id && onSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export default GadgetBar
