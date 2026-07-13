// COM-01 상단 바 — 모든 페이지 공통 고정 영역 (원본 재현)
// [저장(원형 네온 아이콘)] [DSEG 템포 디스플레이 + 곡 제목] [음표(원형 네온 아이콘) → 메뉴]
import { useState } from 'react'

interface TopBarProps {
  tempo: number // 템포 % (DSEG 디스플레이)
  title: string | null // 현재 곡 제목 (없으면 안내 문구)
  isLoading: boolean
  loadingText: string
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenPlaylist: () => void // 음표 메뉴에서 Playlist 선택 시 곡 목록 시트 열기
}

function TopBar({ tempo, title, isLoading, loadingText, onFileChange, onOpenPlaylist }: TopBarProps) {
  // 음표 버튼 메뉴 열림 여부 (원본의 방사형 메뉴를 단순 2버튼 메뉴로 재현 — 사용자 결정)
  const [menuOpen, setMenuOpen] = useState(false)
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

      {/* 음표 버튼 (원본 COM-01 ④) — 탭하면 Playlist / 파일추가 메뉴 (사용자 결정) */}
      <div className="note-menu-wrap">
        <button
          className="icon-btn import"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="곡 메뉴"
        >
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
        </button>

        {menuOpen && (
          <>
            {/* 화면 딤 + 메뉴 밖 터치 = 닫기 (원본 IMP-01 재현) */}
            <div className="note-menu-backdrop" onClick={() => setMenuOpen(false)} />

            {/* 음표 버튼 중심으로 부채꼴 전개되는 원형 아이콘 버튼 (원본 IMP-01) */}
            <button
              className="icon-btn note-fan fan-1"
              aria-label="Playlist"
              onClick={() => {
                setMenuOpen(false)
                onOpenPlaylist()
              }}
            >
              <svg viewBox="0 0 24 24" className="icon">
                {/* 목록 모양 (점 + 줄 3개) */}
                <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <circle cx="5" cy="6" r="0.9" fill="currentColor" />
                  <circle cx="5" cy="12" r="0.9" fill="currentColor" />
                  <circle cx="5" cy="18" r="0.9" fill="currentColor" />
                  <path d="M9.5 6 H20 M9.5 12 H20 M9.5 18 H20" fill="none" />
                </g>
              </svg>
            </button>
            <label className="icon-btn note-fan fan-2" aria-label="파일추가">
              <svg viewBox="0 0 24 24" className="icon">
                {/* 플러스 모양 (파일 추가) */}
                <path
                  d="M12 5 V19 M5 12 H19"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="file"
                accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov"
                onChange={(e) => {
                  setMenuOpen(false)
                  onFileChange(e)
                }}
                hidden
              />
            </label>
          </>
        )}
      </div>
    </header>
  )
}

export default TopBar
