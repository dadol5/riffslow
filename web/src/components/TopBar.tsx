// COM-01 상단 바 — 모든 페이지 공통 고정 영역 (원본 재현)
// [저장(원형 네온 아이콘)] [DSEG 템포 디스플레이 + 곡 제목] [임포트(원형 네온 아이콘)]

interface TopBarProps {
  tempo: number // 템포 % (DSEG 디스플레이)
  title: string | null // 현재 곡 제목 (없으면 안내 문구)
  isLoading: boolean
  loadingText: string
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function TopBar({ tempo, title, isLoading, loadingText, onFileChange }: TopBarProps) {
  return (
    <header className="top-bar">
      {/* 저장/내보내기 (원본 COM-01 ① 플로피 아이콘 — 동작은 Phase 2+) */}
      <button className="icon-btn" disabled aria-label="내보내기 (추후)">
        <svg viewBox="0 0 24 24" className="icon">
          {/* 플로피 디스크 모양 */}
          <path
            d="M5 4 h11 l3 3 v13 h-14 z M9 4 v5 h7 V4 M8 13 h8 v7 H8 z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="top-center">
        {/* 템포 디스플레이: 꺼진 세그먼트 잔상(888) 위에 현재값 (원본 계기판 디테일) */}
        <div className="dseg-display">
          <span className="dseg-stack">
            <span className="dseg-ghost">888</span>
            <span className="dseg-value">{tempo}</span>
          </span>
          <span className="dseg-unit">%</span>
        </div>
        {/* 곡 제목: 도트 매트릭스 폰트 + 안 켜진 고스트 셀 띠 (원본 계기판 디테일) */}
        <div className="song-title">
          <span className="title-ghost" aria-hidden="true">
            {'█'.repeat(40)}
          </span>
          <span className="title-text">
            {isLoading ? loadingText : (title ?? '+ 버튼으로 곡을 추가하세요')}
          </span>
        </div>
      </div>

      {/* 임포트 (원본 COM-01 ④ 음표 아이콘 — 파일 피커. 방사형 메뉴/마이크는 Phase 2) */}
      <label className="icon-btn import">
        <svg viewBox="0 0 24 24" className="icon">
          {/* 음표 모양 */}
          <path
            d="M9 18 V6 l10 -2 v11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <circle cx="6.8" cy="18" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="16.8" cy="15" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <input
          type="file"
          accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov"
          onChange={onFileChange}
          hidden
        />
      </label>
    </header>
  )
}

export default TopBar
