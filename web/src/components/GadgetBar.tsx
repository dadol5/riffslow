// 가젯 탭 바 — 모든 페이지 공통 하단 영역 (COM-01 ⑦)
// 사용자 결정: Volume/Markers/Pitch + BPM(2026-07-13 구현으로 부활) 노출
// (Playlist는 상단 음표 메뉴로 이동, 나머지 미구현 가젯 자리는 숨김 — 추후 SET-01에서 탭 on/off 관리 예정)

export type GadgetId = 'volume' | 'markers' | 'pitch' | 'bpm'

const TABS: { id: GadgetId; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'markers', label: 'Markers' },
  { id: 'pitch', label: 'Pitch' },
  { id: 'bpm', label: 'BPM' },
]

interface GadgetBarProps {
  active: GadgetId
  onSelect: (gadget: GadgetId) => void
}

function GadgetBar({ active, onSelect }: GadgetBarProps) {
  return (
    <nav className="gadget-tabs">
      {TABS.map(({ id, label }) => (
        <button
          key={label}
          className={`gadget-tab${id === active ? ' active' : ''}`}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export default GadgetBar
