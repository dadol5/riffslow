import { useEffect, useRef, useState } from 'react'
import { Player } from './audio/player'
import Wheel from './components/Wheel'
import {
  addTrack,
  deleteTrack,
  getAllTracks,
  getTrack,
  getTrackFile,
  updateSettings,
  type TrackMeta,
} from './db/library'
import { formatTime } from './utils/time'
import './App.css'

function App() {
  // Player 인스턴스는 앱 전체에서 1개만 유지 (렌더링마다 새로 만들지 않도록 ref에 보관)
  const playerRef = useRef<Player | null>(null)
  if (!playerRef.current) {
    playerRef.current = new Player()
  }
  const player = playerRef.current

  // ── 화면에 보이는 상태 ──
  const [fileName, setFileName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('') // 로딩 단계별 안내 문구
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0) // 현재 재생 위치 (초)
  const [duration, setDuration] = useState(0) // 곡 길이 (초)
  const [tempo, setTempo] = useState(100) // 템포 % (100 = 원속도)
  const [loopA, setLoopA] = useState<number | null>(null) // 루프 시작 지점 (초)
  const [loopB, setLoopB] = useState<number | null>(null) // 루프 끝 지점 (초)
  const [posMarkers, setPosMarkers] = useState<number[]>([]) // 위치 마커 목록 (초)
  const [trackS, setTrackS] = useState<number | null>(null) // 시작(S) 마커 (초)
  const [trackE, setTrackE] = useState<number | null>(null) // 끝(E) 마커 (초)
  const [tracks, setTracks] = useState<TrackMeta[]>([]) // 라이브러리 곡 목록
  const [currentId, setCurrentId] = useState<number | null>(null) // 현재 곡의 라이브러리 id

  // 앱 시작 시 저장된 곡 목록 불러오기 (빈 배열 의존성 = 최초 1회만 실행)
  useEffect(() => {
    getAllTracks().then(setTracks)
  }, [])

  // 곡별 설정 자동 저장: 설정이 바뀌면 300ms 뒤 저장 (연속 변경은 마지막 것만)
  useEffect(() => {
    if (currentId === null) return
    const timer = setTimeout(() => {
      updateSettings(currentId, { tempo, loopA, loopB, posMarkers, trackS, trackE })
    }, 300)
    return () => clearTimeout(timer) // 300ms 안에 또 바뀌면 이전 예약 취소 (디바운스)
  }, [currentId, tempo, loopA, loopB, posMarkers, trackS, trackE])

  // 곡이 끝까지 재생되면 엔진이 알려줌 → 화면 상태 되돌리기
  useEffect(() => {
    player.onEnded = () => {
      setIsPlaying(false)
      setPosition(player.position) // 정지 후 위치는 S 마커(없으면 곡 처음)
    }
  }, [player])

  // 재생 중에는 매 프레임 위치를 갱신 (시간 표시 + 발광점 이동)
  useEffect(() => {
    if (!isPlaying) return

    let rafId: number
    const tick = () => {
      setPosition(player.position)
      rafId = requestAnimationFrame(tick) // 다음 화면 프레임에 다시 실행 (약 60fps)
    }
    rafId = requestAnimationFrame(tick)

    // 정리 함수: 재생이 멈추면 루프 해제 (메모리 누수 방지)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, player])

  // 파일 선택 → 엔진에 로드 + 라이브러리에 저장
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    player.ensureContext() // 제스처 컨텍스트가 살아있을 때(await 이전) 오디오 준비
    setIsPlaying(false)
    setIsLoading(true)
    try {
      // 동영상이면 먼저 오디오 트랙만 추출 (mov/mp4 등)
      const isVideo =
        file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name)

      let source: Blob = file
      if (isVideo) {
        setLoadingText('동영상에서 오디오 추출 중... (최초 1회는 도구 다운로드로 오래 걸려요)')
        // 필요할 때만 ffmpeg 모듈 로드 (오디오 파일만 쓰는 동안엔 부담 없음)
        const { extractAudio } = await import('./audio/extractAudio')
        source = await extractAudio(file)
      }

      setLoadingText('디코딩 중...')
      const dur = await player.load(source)
      setFileName(file.name)
      setDuration(dur)
      setPosition(0)
      // 곡 단위 설정 초기화 (엔진 쪽 루프/S/E는 load()가 정리함)
      setLoopA(null)
      setLoopB(null)
      setPosMarkers([])
      setTrackS(null)
      setTrackE(null)

      // 라이브러리에 저장 (동영상은 추출된 오디오만 저장 — 용량 절약 + 다음부턴 추출 생략)
      const meta = await addTrack(file.name, source, dur)
      setCurrentId(meta.id)
      setTracks(await getAllTracks())
      console.log(`디코딩 완료: ${file.name} (길이 ${dur.toFixed(1)}초) — 라이브러리 저장됨`)
    } catch (err) {
      // 디버깅용: 파일 정보와 에러 내용을 함께 출력
      console.error('오디오 디코딩 실패:', err)
      console.error(
        `파일 정보 — 이름: ${file.name}, 타입: ${file.type || '(없음)'}, 크기: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
      )
      alert(
        `이 파일은 재생할 수 없어요.\n파일: ${file.name}\n타입: ${file.type || '알 수 없음'}\n에러: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setIsLoading(false)
    }
  }

  // 재생/일시정지 토글
  const togglePlay = () => {
    if (isPlaying) {
      player.pause()
      setPosition(player.position)
      setIsPlaying(false)
    } else {
      player.play()
      setIsPlaying(player.isPlaying)
    }
  }

  // 휠 회전 → 위치 이동
  const handleSeek = (pos: number) => {
    player.seek(pos)
    setPosition(pos)
  }

  // 템포 슬라이더 → 엔진에 실시간 반영 (음정은 유지됨)
  const handleTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const percent = Number(e.target.value)
    setTempo(percent)
    player.tempo = percent / 100
  }

  // A 지점: 현재 재생 위치를 루프 시작으로
  const handleLoopA = () => {
    const a = player.position
    setLoopA(a)
    // B가 A보다 앞이면 무효화 (구간이 성립 안 됨)
    const b = loopB !== null && loopB > a ? loopB : null
    setLoopB(b)
    player.setLoop(a, b)
  }

  // B 지점: 현재 재생 위치를 루프 끝으로 (A보다 뒤여야 함)
  const handleLoopB = () => {
    const b = player.position
    if (loopA === null || b <= loopA) return
    setLoopB(b)
    player.setLoop(loopA, b)
  }

  // 루프 해제
  const handleLoopClear = () => {
    setLoopA(null)
    setLoopB(null)
    player.setLoop(null, null)
  }

  // 위치 마커 추가: 현재 재생 위치를 목록에 저장
  const handleAddMarker = () => {
    // state 배열은 직접 수정하지 않고 복사 후 추가 (React 불변성 규칙)
    setPosMarkers([...posMarkers, player.position])
  }

  // 마커 탭 → 해당 지점으로 즉시 이동
  const handleMarkerTap = (pos: number) => {
    player.seek(pos)
    setPosition(pos)
  }

  // S 마커: 현재 위치를 재생 시작 지점으로 (E보다 앞이어야 함)
  const handleTrackS = () => {
    const s = player.position
    if (trackE !== null && s >= trackE) return
    setTrackS(s)
    player.setTrackMarkers(s, trackE)
  }

  // E 마커: 현재 위치를 재생 끝 지점으로 (S보다 뒤여야 함)
  const handleTrackE = () => {
    const end = player.position
    if (trackS !== null && end <= trackS) return
    setTrackE(end)
    player.setTrackMarkers(trackS, end)
  }

  // 목록에서 곡 선택 → 로드 + 저장된 설정 복원 + 재생 (설계서: 행 탭 = 로드+재생)
  const handleSelectTrack = async (meta: TrackMeta) => {
    player.ensureContext() // 제스처 컨텍스트가 살아있을 때(await 이전) 오디오 준비
    setIsPlaying(false)
    setIsLoading(true)
    setLoadingText('불러오는 중...')
    try {
      const blob = await getTrackFile(meta.id)
      if (!blob) throw new Error('저장된 파일을 찾을 수 없어요')

      const dur = await player.load(blob)
      setFileName(meta.name)
      setDuration(dur)
      setPosition(0)
      setCurrentId(meta.id)

      // 저장된 곡별 설정 복원 (DB에서 최신값 다시 읽음 — 목록의 메타는 오래됐을 수 있음)
      const s = ((await getTrack(meta.id)) ?? meta).settings
      setTempo(s.tempo)
      player.tempo = s.tempo / 100
      setLoopA(s.loopA)
      setLoopB(s.loopB)
      player.setLoop(s.loopA, s.loopB)
      setPosMarkers(s.posMarkers)
      setTrackS(s.trackS)
      setTrackE(s.trackE)
      player.setTrackMarkers(s.trackS, s.trackE)

      player.play()
      setIsPlaying(player.isPlaying)
    } catch (err) {
      console.error('곡 불러오기 실패:', err)
      alert('곡을 불러오지 못했어요.')
    } finally {
      setIsLoading(false)
    }
  }

  // 곡 삭제 ⭐ (원본의 방치된 버그 — 우리는 확실하게)
  const handleDeleteTrack = async (e: React.MouseEvent, meta: TrackMeta) => {
    e.stopPropagation() // 행 탭(재생)으로 번지지 않게
    if (!confirm(`'${meta.name}'\n이 곡을 삭제할까요?`)) return
    await deleteTrack(meta.id)
    setTracks(await getAllTracks())
    if (currentId === meta.id) {
      setCurrentId(null) // 현재 곡이면 라이브러리 연결만 해제 (재생 중이면 유지)
    }
  }

  // 모든 마커 일괄 삭제 (위치 마커 + S/E + A/B 루프)
  const handleClearAllMarkers = () => {
    setPosMarkers([])
    setTrackS(null)
    setTrackE(null)
    player.setTrackMarkers(null, null)
    handleLoopClear()
  }

  return (
    <div className="app">
      <h1>RiffSlow</h1>

      <label className="file-button">
        곡 선택
        {/* 동영상도 허용: 오디오 트랙만 추출해서 재생 (decodeAudioData가 알아서 처리) */}
        <input
          type="file"
          accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov"
          onChange={handleFileChange}
          hidden
        />
      </label>

      {isLoading && <p className="status">{loadingText}</p>}
      {fileName && !isLoading && <p className="status">{fileName}</p>}

      {/* 진행 휠: 위치/길이를 내려주고, 회전하면 onSeek로 돌려받음 */}
      <Wheel
        position={position}
        duration={duration}
        onSeek={handleSeek}
        loopStart={loopA}
        loopEnd={loopB}
        markers={posMarkers}
        onMarkerTap={handleMarkerTap}
        trackStart={trackS}
        trackEnd={trackE}
      />

      {/* A/B 구간 루프 (임시 버튼 — 추후 Markers 가젯으로 이동 예정) */}
      <div className="loop-buttons">
        <button onClick={handleLoopA} disabled={!fileName}>
          A 지점
        </button>
        <button onClick={handleLoopB} disabled={!fileName || loopA === null}>
          B 지점
        </button>
        <button
          onClick={handleLoopClear}
          disabled={loopA === null && loopB === null}
        >
          해제
        </button>
        <button onClick={handleAddMarker} disabled={!fileName}>
          ○ 마커
        </button>
      </div>

      {/* S/E 마커 + 트랙 루프 (임시 버튼 — 추후 Markers 가젯/P-02로 이동 예정) */}
      <div className="loop-buttons">
        <button onClick={handleTrackS} disabled={!fileName}>
          S 마커
        </button>
        <button onClick={handleTrackE} disabled={!fileName}>
          E 마커
        </button>
        <button
          onClick={handleClearAllMarkers}
          disabled={
            posMarkers.length === 0 &&
            trackS === null &&
            trackE === null &&
            loopA === null
          }
        >
          전체삭제
        </button>
      </div>

      {/* 템포 조절 (임시 슬라이더 — 추후 P-02 템포 휠로 교체 예정) */}
      <div className="tempo-control">
        <span className="tempo-value">{tempo}%</span>
        <input
          type="range"
          min={20}
          max={250}
          value={tempo}
          onChange={handleTempoChange}
        />
      </div>

      <button
        className="play-button"
        onClick={togglePlay}
        disabled={!fileName || isLoading}
      >
        {isPlaying ? '⏸ 일시정지' : '▶ 재생'}
      </button>

      {/* 곡 목록 (임시 UI — 추후 P-03 트랙 리스트 페이지로 이동) */}
      {tracks.length > 0 && (
        <div className="track-list">
          {tracks.map((t) => (
            <div
              key={t.id}
              className={`track-row${t.id === currentId ? ' current' : ''}`}
              onClick={() => handleSelectTrack(t)}
            >
              {/* 현재 트랙 인디케이터 (설계서: 재생 중 곡 좌측 ▶) */}
              <span className="track-indicator">
                {t.id === currentId ? '▶' : ''}
              </span>
              <span className="track-name">{t.name}</span>
              <span className="track-duration">{formatTime(t.duration)}</span>
              <button
                className="track-delete"
                onClick={(e) => handleDeleteTrack(e, t)}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
