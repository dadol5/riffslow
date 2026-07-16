// 스템 믹서 시트 — 악기별 가로 페이더 + 아이콘 탭=뮤트 + S=솔로 (사용자 결정: 가로 + 아이콘)
// Playlist와 같은 바텀 시트 패턴 (딤 배경, 슬라이드 업)
interface MixerSheetProps {
  names: string[] // 스템 이름 (엔진 채널 순서와 동일)
  mix: Record<string, { volume: number; muted: boolean }>
  solos: Set<string> // 솔로 켜진 스템들 (세션 한정)
  onVolume: (name: string, volume: number) => void
  onToggleMute: (name: string) => void
  onToggleSolo: (name: string) => void
  onClose: () => void
}

// 스템 이름 → 악기 아이콘 (앱 공통 스타일: currentColor 스트로크 라인 아이콘)
// 모르는 이름은 음파 아이콘으로 표시
function StemIcon({ name }: { name: string }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const
  switch (name) {
    case 'vocals': // 마이크
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <rect x="9.2" y="3" width="5.6" height="9.5" rx="2.8" />
            <path d="M6 10.5 a6 6 0 0 0 12 0 M12 16.5 V20 M8.5 20 H15.5" />
          </g>
        </svg>
      )
    case 'drums': // 스네어 드럼 + 스틱
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <ellipse cx="12" cy="11" rx="7" ry="2.6" />
            <path d="M5 11 V16.5 a7 2.6 0 0 0 14 0 V11" />
            <path d="M6.5 3.5 L11 8.6 M17.5 3.5 L13 8.6" />
          </g>
        </svg>
      )
    case 'bass': // 낮은음자리표 (𝄢) — 실루엣으론 기타와 구분이 어려워 기호로 (사용자 선택 B2)
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <path d="M8.8 9.4 a3.3 3.3 0 1 1 6.6 0 C 15.4 13.6 12.4 16.8 8.2 18.8" />
            <circle cx="8.8" cy="9.4" r="0.8" fill="currentColor" />
            <circle cx="18.3" cy="7.6" r="0.9" fill="currentColor" />
            <circle cx="18.3" cy="11.2" r="0.9" fill="currentColor" />
          </g>
        </svg>
      )
    case 'guitar': // 잘록한 몸통 + 사운드홀 + 브릿지/페그 디테일 (사용자 선택 G2)
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <path d="M12 10 C 9.7 10 8.7 11.4 9.2 12.7 C 9.5 13.6 9.5 14 9 14.9 C 8.1 16.6 9 19.2 12 19.2 C 15 19.2 15.9 16.6 15 14.9 C 14.5 14 14.5 13.6 14.8 12.7 C 15.3 11.4 14.3 10 12 10 Z" />
            <circle cx="12" cy="13.6" r="1.2" />
            <path d="M10.7 17 H13.3" />
            <path d="M12 10 V2.8 M10.5 2.8 H13.5 M10.5 4.3 H12 M13.5 5.6 H12" />
          </g>
        </svg>
      )
    case 'piano': // 건반
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <rect x="3.5" y="7" width="17" height="10.5" rx="1.2" />
            <path d="M9.2 17.5 V12.5 M14.8 17.5 V12.5 M6.9 7 V12 M11.5 7 V12 M16.6 7 V12" />
          </g>
        </svg>
      )
    case 'other': // 음표 (그 외 반주)
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <path d="M11.5 17.5 V5.5 l6 -1.5 V15" />
            <circle cx="9" cy="17.5" r="2.5" />
            <circle cx="15" cy="15" r="2.5" />
          </g>
        </svg>
      )
    default: // 알 수 없는 스템 = 음파
      return (
        <svg viewBox="0 0 24 24" className="icon">
          <g {...stroke}>
            <path d="M4 12 h2 l2 -5 3 10 3 -14 3 12 1.5 -3 H21" />
          </g>
        </svg>
      )
  }
}

function MixerSheet({
  names,
  mix,
  solos,
  onVolume,
  onToggleMute,
  onToggleSolo,
  onClose,
}: MixerSheetProps) {
  // 페이더 터치 위치 → 볼륨 (왼쪽 = 0%, 오른쪽 = 100%)
  const applyFader = (name: string, e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const v = (e.clientX - rect.left) / rect.width
    onVolume(name, Math.max(0, Math.min(1, v)))
  }

  return (
    <>
      {/* 딤 배경 — 탭하면 닫힘 */}
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="mixer-sheet">
        <div className="sheet-header">
          <span className="sheet-title">Mixer</span>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mixer-strips">
          {names.map((name) => {
            const m = mix[name]
            const vol = m?.volume ?? 1
            const muted = m?.muted ?? false
            const solo = solos.has(name)
            // 실제로 소리가 나는 상태 (솔로가 있으면 솔로만, 없으면 뮤트 제외)
            const audible = solos.size > 0 ? solo : !muted
            return (
              <div key={name} className={`mixer-strip${audible ? '' : ' silent'}`}>
                <button
                  className={`mixer-icon${muted ? ' muted' : ''}`}
                  onClick={() => onToggleMute(name)}
                  aria-label={`${name} 음소거 전환`}
                >
                  <StemIcon name={name} />
                </button>
                <div
                  className="mixer-fader"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    applyFader(name, e)
                  }}
                  onPointerMove={(e) => {
                    if (e.buttons === 0) return // 누른 채 움직일 때만
                    applyFader(name, e)
                  }}
                >
                  <div className="mixer-fader-fill" style={{ width: `${vol * 100}%` }} />
                </div>
                <div className="mixer-vol">{Math.round(vol * 100)}</div>
                <button
                  className={`mixer-solo${solo ? ' on' : ''}`}
                  onClick={() => onToggleSolo(name)}
                  aria-label={`${name} 솔로`}
                >
                  S
                </button>
              </div>
            )
          })}
        </div>
        <div className="mixer-hint">아이콘 탭 = 음소거 · S = 이 악기만 듣기 · 변경은 잠깐 뒤에 소리에 반영돼요</div>
      </div>
    </>
  )
}

export default MixerSheet
