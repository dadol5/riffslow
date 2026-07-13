import { useEffect, useRef, useState } from 'react'
import { Player } from './audio/player'
import TopBar from './components/TopBar'
import ProgressPage from './components/ProgressPage'
import TempoPage from './components/TempoPage'
import TrackListPage from './components/TrackListPage'
import GadgetBar, { type GadgetId } from './components/GadgetBar'
import VolumeGadget from './components/gadgets/VolumeGadget'
import MarkersGadget from './components/gadgets/MarkersGadget'
import PitchGadget from './components/gadgets/PitchGadget'
import BpmGadget from './components/gadgets/BpmGadget'
import { analyzeBpm } from './audio/bpm'
import {
  addTrack,
  deleteTrack,
  getAllTracks,
  getTrack,
  getTrackFile,
  updateSettings,
  type Loop,
  type TrackMeta,
} from './db/library'
import './App.css'

// 메인 페이지 구성: 0=P-01 진행 휠, 1=P-02 템포 (곡 목록은 Playlist 가젯으로)
const PAGE_COUNT = 2

// 마지막 재생 곡 기억용 localStorage 키 (다음 실행 시 자동 로드)
const LAST_TRACK_KEY = 'riffslow-last-track'

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
  const [loops, setLoops] = useState<Loop[]>([]) // 구간 루프 목록 (여러 개 가능)
  const [posMarkers, setPosMarkers] = useState<number[]>([]) // 위치 마커 목록 (초)
  const [trackS, setTrackS] = useState<number | null>(null) // 시작(S) 마커 (초)
  const [trackE, setTrackE] = useState<number | null>(null) // 끝(E) 마커 (초)
  const [tracks, setTracks] = useState<TrackMeta[]>([]) // 라이브러리 곡 목록
  const [currentId, setCurrentId] = useState<number | null>(null) // 현재 곡의 라이브러리 id
  const [page, setPage] = useState(0) // 현재 페이지 (기본 진입 = P-01, 설계서 확정)
  const [activeGadget, setActiveGadget] = useState<GadgetId>('volume') // 선택된 가젯 탭
  const [showPlaylist, setShowPlaylist] = useState(false) // 곡 목록 시트(레이어) 열림 여부

  // 가젯 탭 선택 = 패널 전환 (Playlist는 상단 음표 메뉴로 이동 — 사용자 결정)
  const handleGadgetSelect = (id: GadgetId) => {
    setActiveGadget(id)
  }
  const [volume, setVolume] = useState(100) // 마스터 볼륨 % (전역 설정)
  const [pitch, setPitch] = useState(0) // 피치 반음 (곡별 저장)

  // ── BPM (곡별 저장): undefined = 미분석, null = 분석 실패 확정, number = 값 ──
  const [bpm, setBpm] = useState<number | null | undefined>(undefined)
  const [bpmOffset, setBpmOffset] = useState<number | null>(null) // 첫 박 위치 (메트로놈용)
  const [bpmAnalyzing, setBpmAnalyzing] = useState(false)
  const [metroOn, setMetroOn] = useState(false) // 메트로놈 on/off (세션 한정 — 저장 안 함)
  const [metroVolume, setMetroVolume] = useState(100) // 메트로놈 볼륨 % (음원과 개별)

  // BPM 그리드가 바뀔 때마다 엔진에 반영 (곡 교체/분석 완료/×2·÷2 교정 모두 포함)
  useEffect(() => {
    player.setBpmGrid(bpm ?? null, bpmOffset)
  }, [player, bpm, bpmOffset])

  // 분석 완료 시점에 다른 곡으로 바뀌었는지 판별하기 위한 현재 곡 id 미러
  const currentIdRef = useRef<number | null>(null)
  useEffect(() => {
    currentIdRef.current = currentId
  }, [currentId])

  // BPM 자동 분석 (로드 완료 후 백그라운드 실행 — 재생/UI를 막지 않음)
  const runBpmAnalysis = async (trackId: number) => {
    const buffer = player.audioBuffer
    if (!buffer) return
    setBpmAnalyzing(true)
    const result = await analyzeBpm(buffer)
    // 분석 도중 다른 곡으로 바뀌었으면 결과 폐기 (그 곡의 로드 흐름이 상태를 관리)
    if (currentIdRef.current !== trackId) return
    setBpmAnalyzing(false)
    setBpm(result?.bpm ?? null) // 실패는 null 저장 → 다음 로드 때 재분석됨
    setBpmOffset(result?.offset ?? null)
  }

  // ── 페이지 스와이프: 손가락을 따라 실시간으로 끌리고, 놓으면 스냅 ──
  // (휠 링에서 시작한 터치는 Wheel이 stopPropagation으로 차단 → 여기 안 옴)
  // 성능: 드래그 중에는 React 재렌더링 없이 DOM 스타일을 직접 갱신
  const stripRef = useRef<HTMLDivElement | null>(null)
  const swipeRef = useRef<{
    x: number
    y: number
    t: number // 시작 시각 (플릭 속도 계산용)
    active: boolean // 가로 제스처로 확정됐는지
  } | null>(null)

  // 페이지 스트립 위치 지정 (offsetPx = 드래그 중 손가락 이동량)
  const setStrip = (offsetPx: number, animate: boolean, pageIndex: number) => {
    const el = stripRef.current
    if (!el) return
    el.style.transition = animate ? 'transform 0.3s ease' : 'none'
    el.style.transform = `translateX(calc(-${pageIndex * 100}% + ${offsetPx}px))`
  }

  // 페이지가 바뀌면 (스와이프/화살표 어느 쪽이든) 해당 페이지로 스냅
  useEffect(() => {
    setStrip(0, true, page)
  }, [page])

  const handleSwipeStart = (e: React.PointerEvent) => {
    swipeRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, active: false }
  }

  const handleSwipeMove = (e: React.PointerEvent) => {
    const s = swipeRef.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y

    // 아직 방향 미확정: 가로가 뚜렷해지면 스와이프 시작, 세로가 크면 포기(스크롤에 양보)
    if (!s.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.active = true
        // 스와이프 확정 후에만 포인터 캡처 (버튼 탭을 방해하지 않기 위해)
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (Math.abs(dy) > 16) {
        swipeRef.current = null
        return
      } else {
        return
      }
    }

    // 끝 페이지에서 바깥으로 당기면 고무줄 저항
    const atEdge = (page === 0 && dx > 0) || (page === PAGE_COUNT - 1 && dx < 0)
    setStrip(atEdge ? dx * 0.35 : dx, false, page)
  }

  const handleSwipeEnd = (e: React.PointerEvent) => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s || !s.active) return

    const dx = e.clientX - s.x
    const dt = e.timeStamp - s.t
    const width = e.currentTarget.clientWidth

    // 전환 판정: 화면의 1/4 이상 끌었거나, 짧고 빠른 플릭이거나
    const far = Math.abs(dx) > width * 0.25
    const flick = Math.abs(dx) > 40 && Math.abs(dx) / dt > 0.45
    const next =
      far || flick
        ? Math.max(0, Math.min(PAGE_COUNT - 1, page + (dx < 0 ? 1 : -1)))
        : page

    if (next !== page) {
      setPage(next) // useEffect가 새 페이지로 스냅
    } else {
      setStrip(0, true, page) // 원래 자리로 되돌아가는 스냅
    }
  }

  const handleSwipeCancel = () => {
    if (swipeRef.current?.active) {
      setStrip(0, true, page)
    }
    swipeRef.current = null
  }

  // 현재 곡이 바뀔 때마다 "마지막 곡"으로 기억
  useEffect(() => {
    if (currentId !== null) {
      localStorage.setItem(LAST_TRACK_KEY, String(currentId))
    }
  }, [currentId])

  // 곡별 설정 자동 저장: 설정이 바뀌면 300ms 뒤 저장 (연속 변경은 마지막 것만)
  useEffect(() => {
    if (currentId === null) return
    const timer = setTimeout(() => {
      updateSettings(currentId, {
        tempo,
        pitch,
        loops,
        posMarkers,
        trackS,
        trackE,
        bpm, // undefined(미분석)는 저장돼도 무해 — 다음 로드에서 분석 재시도됨
        bpmOffset,
      })
    }, 300)
    return () => clearTimeout(timer) // 300ms 안에 또 바뀌면 이전 예약 취소 (디바운스)
  }, [currentId, tempo, pitch, loops, posMarkers, trackS, trackE, bpm, bpmOffset])

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
      setLoops([])
      setPosMarkers([])
      setTrackS(null)
      setTrackE(null)
      setPitch(0)
      player.pitchSemitones = 0
      setBpm(undefined)
      setBpmOffset(null)

      // 라이브러리에 저장 (동영상은 추출된 오디오만 저장 — 용량 절약 + 다음부턴 추출 생략)
      const meta = await addTrack(file.name, source, dur)
      setCurrentId(meta.id)
      setTracks(await getAllTracks())
      console.log(`디코딩 완료: ${file.name} (길이 ${dur.toFixed(1)}초) — 라이브러리 저장됨`)

      // BPM 자동 분석 (백그라운드 — 끝나면 BPM 가젯에 표시되고 곡별 저장됨)
      void runBpmAnalysis(meta.id)
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

  // 템포 휠 → 엔진에 실시간 반영 (음정은 유지됨)
  const handleTempoChange = (percent: number) => {
    const rounded = Math.round(percent)
    setTempo(rounded)
    player.tempo = rounded / 100
  }

  // 음원 볼륨 (Volume 가젯)
  const handleVolumeChange = (v: number) => {
    setVolume(v)
    player.volume = v / 100
  }

  // 메트로놈 볼륨 (Volume 가젯 — 음원과 개별 조절)
  const handleMetroVolumeChange = (v: number) => {
    setMetroVolume(v)
    player.metroVolume = v / 100
  }

  // 피치 스테퍼 (Pitch 가젯 — 재생 중 실시간 반영)
  const handlePitchChange = (semitones: number) => {
    setPitch(semitones)
    player.pitchSemitones = semitones
  }

  // BPM ×2/÷2 교정 (자동 분석의 반배/두배 혼동 보정 — 첫 박 위치는 그대로 유효)
  const handleBpmChange = (value: number) => {
    setBpm(value)
  }

  // 메트로놈 토글 (BPM 가젯 — 재생 중 음악 위에 클릭음 얹기)
  const handleMetroToggle = () => {
    const next = !metroOn
    setMetroOn(next)
    player.metronome = next
  }

  // 루프 상태 변경: 화면 state와 엔진을 항상 함께 갱신
  const syncLoops = (next: Loop[]) => {
    setLoops(next)
    player.setLoops(next)
  }

  // Loop start: 현재 위치에 새 루프 시작점 추가 (여러 개 가능, 단독으로도 존재)
  const handleLoopStart = () => {
    syncLoops([...loops, { start: player.position, end: null }])
  }

  // Loop stop: 현재 위치보다 앞에 시작점이 있는 미완성 루프 중
  // 가장 가까운 것에 끝점을 부여 (구간 완성 → 반복 활성)
  const handleLoopStop = () => {
    const pos = player.position
    let targetIdx = -1
    let bestStart = -Infinity
    loops.forEach((loop, i) => {
      if (loop.end === null && loop.start < pos && loop.start > bestStart) {
        bestStart = loop.start
        targetIdx = i
      }
    })
    if (targetIdx < 0) return // 앞쪽에 열린 시작점이 없으면 무시
    syncLoops(loops.map((loop, i) => (i === targetIdx ? { ...loop, end: pos } : loop)))
  }

  // 루프 시작 핀 홀드 → 시작점만 삭제 (사용자 요청: 누른 핀만 지워져야 함)
  // 끝점이 있으면 끝점이 미완성 시작 핀으로 남음 (모델상 끝점 단독은 불가)
  const handleDeleteLoop = (index: number) => {
    syncLoops(
      loops.flatMap((loop, i) => {
        if (i !== index) return [loop]
        // 끝점 없는 미완성 루프면 통째로 제거, 있으면 끝점을 새 시작점으로 전환
        return loop.end === null ? [] : [{ start: loop.end, end: null }]
      }),
    )
  }

  // 루프 끝 핀 홀드 → 끝점만 삭제 (시작점만 남아 미완성 루프로)
  const handleDeleteLoopEnd = (index: number) => {
    syncLoops(loops.map((loop, i) => (i === index ? { ...loop, end: null } : loop)))
  }

  // 루프 시작 핀 탭 → 그 지점부터 재생 (원본 확정 동작)
  const handleLoopStartTap = (pos: number) => {
    player.seek(pos)
    setPosition(pos)
    if (!isPlaying) {
      player.play()
      setIsPlaying(player.isPlaying)
    }
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

  // 위치 마커 홀드 삭제
  const handleDeleteMarker = (index: number) => {
    setPosMarkers(posMarkers.filter((_, i) => i !== index))
  }

  // S/E 마커 홀드 삭제
  const handleDeleteTrackS = () => {
    setTrackS(null)
    player.setTrackMarkers(null, trackE)
  }

  const handleDeleteTrackE = () => {
    setTrackE(null)
    player.setTrackMarkers(trackS, null)
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

  // 곡 로드 + 저장된 설정 복원 (autoPlay: 목록 탭 = 재생 / 앱 시작 복원 = 로드만)
  const loadTrack = async (meta: TrackMeta, autoPlay: boolean) => {
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
      setPitch(s.pitch ?? 0) // 구버전 저장 데이터엔 pitch가 없을 수 있음
      player.pitchSemitones = s.pitch ?? 0

      // 루프 복원 (구버전 loopA/loopB 단일 루프 데이터는 배열로 변환)
      const legacy = s as typeof s & { loopA?: number | null; loopB?: number | null }
      const restoredLoops: Loop[] =
        s.loops ??
        (legacy.loopA != null ? [{ start: legacy.loopA, end: legacy.loopB ?? null }] : [])
      setLoops(restoredLoops)
      player.setLoops(restoredLoops)

      setPosMarkers(s.posMarkers)
      setTrackS(s.trackS)
      setTrackE(s.trackE)
      player.setTrackMarkers(s.trackS, s.trackE)

      // BPM 복원 — 유효한 값이 없으면(미분석/구버전/직전 실패) 다시 분석
      // (실패도 재시도하는 이유: 분석 로직이 개선되면 자동으로 다시 혜택받도록 — 백그라운드라 부담 없음)
      setBpm(s.bpm)
      setBpmOffset(s.bpmOffset ?? null)
      setBpmAnalyzing(false)
      if (s.bpm == null) {
        void runBpmAnalysis(meta.id)
      }

      if (autoPlay) {
        player.play()
        setIsPlaying(player.isPlaying)
      }
    } catch (err) {
      console.error('곡 불러오기 실패:', err)
      alert('곡을 불러오지 못했어요.')
    } finally {
      setIsLoading(false)
    }
  }

  // 목록에서 곡 선택 → 로드만 (사용자 결정: 자동 재생 없이 ▶ 눌러서 시작)
  const handleSelectTrack = (meta: TrackMeta) => {
    player.ensureContext() // 제스처 컨텍스트가 살아있을 때(await 이전) 오디오 준비
    loadTrack(meta, false)
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

  // 모든 마커 일괄 삭제 (위치 마커 + S/E + 루프 전부)
  const handleClearAllMarkers = () => {
    setPosMarkers([])
    setTrackS(null)
    setTrackE(null)
    player.setTrackMarkers(null, null)
    syncLoops([])
  }

  // 앱 시작: 곡 목록 로드 + 마지막 재생 곡 자동 복원 (재생은 안 함 — iOS 제스처 정책)
  useEffect(() => {
    ;(async () => {
      const all = await getAllTracks()
      setTracks(all)
      const saved = localStorage.getItem(LAST_TRACK_KEY)
      if (saved === null) return
      const meta = all.find((t) => t.id === Number(saved))
      if (meta) {
        await loadTrack(meta, false) // 로드만 — ▶ 누르면 바로 이어서 연습
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최초 1회만 실행
  }, [])

  const hasTrack = fileName !== null && !isLoading

  return (
    <div className="app-frame">
      {/* COM-01 공통 상단 바 */}
      <TopBar
        tempo={tempo}
        title={fileName}
        isLoading={isLoading}
        loadingText={loadingText}
        onFileChange={handleFileChange}
        onOpenPlaylist={() => setShowPlaylist(true)}
      />

      {/* 페이지 스와이프 영역 (손가락 추적) */}
      <div
        className="pages-viewport"
        onPointerDown={handleSwipeStart}
        onPointerMove={handleSwipeMove}
        onPointerUp={handleSwipeEnd}
        onPointerCancel={handleSwipeCancel}
      >
        <div className="pages-strip" ref={stripRef}>
          <section className="page">
            <ProgressPage
              position={position}
              duration={duration}
              hasTrack={hasTrack}
              isPlaying={isPlaying}
              loops={loops}
              posMarkers={posMarkers}
              trackS={trackS}
              trackE={trackE}
              onSeek={handleSeek}
              onMarkerTap={handleMarkerTap}
              onLoopStartTap={handleLoopStartTap}
              onDeleteMarker={handleDeleteMarker}
              onDeleteLoop={handleDeleteLoop}
              onDeleteLoopEnd={handleDeleteLoopEnd}
              onDeleteTrackS={handleDeleteTrackS}
              onDeleteTrackE={handleDeleteTrackE}
              onTogglePlay={togglePlay}
              metroOn={metroOn}
              canMetro={hasTrack && bpm != null}
              onMetroToggle={handleMetroToggle}
            />
          </section>

          <section className="page">
            <TempoPage
              tempo={tempo}
              hasTrack={hasTrack}
              isPlaying={isPlaying}
              onTempoChange={handleTempoChange}
              onTogglePlay={togglePlay}
            />
          </section>
        </div>

        {/* 페이지 이동 화살표 (끝 페이지에서 해당 방향 숨김 — 설계서 확정) */}
        {page > 0 && (
          <button className="page-arrow left" onClick={() => setPage(page - 1)}>
            ‹
          </button>
        )}
        {page < PAGE_COUNT - 1 && (
          <button className="page-arrow right" onClick={() => setPage(page + 1)}>
            ›
          </button>
        )}
      </div>

      {/* 페이지 인디케이터 ● ○ ○ */}
      <div className="page-indicator">
        {Array.from({ length: PAGE_COUNT }, (_, i) => (
          <span key={i} className={i === page ? 'dot on' : 'dot'} />
        ))}
      </div>

      {/* 가젯 탭 바 + 선택된 가젯 패널 (모든 페이지 공통 — COM-01) */}
      <GadgetBar active={activeGadget} onSelect={handleGadgetSelect} />
      <div className="gadget-panel">
        {activeGadget === 'volume' && (
          <VolumeGadget
            volume={volume}
            metroVolume={metroVolume}
            onChange={handleVolumeChange}
            onMetroVolumeChange={handleMetroVolumeChange}
          />
        )}
        {activeGadget === 'markers' && (
          <MarkersGadget
            hasTrack={hasTrack}
            canLoopStop={loops.some((loop) => loop.end === null)}
            canClearAll={
              posMarkers.length > 0 ||
              trackS !== null ||
              trackE !== null ||
              loops.length > 0
            }
            onAddMarker={handleAddMarker}
            onLoopStart={handleLoopStart}
            onLoopStop={handleLoopStop}
            onTrackS={handleTrackS}
            onTrackE={handleTrackE}
            onClearAll={handleClearAllMarkers}
          />
        )}
        {activeGadget === 'pitch' && (
          <PitchGadget pitch={pitch} onChange={handlePitchChange} />
        )}
        {activeGadget === 'bpm' && (
          <BpmGadget
            hasTrack={hasTrack}
            analyzing={bpmAnalyzing}
            bpm={bpm}
            tempo={tempo}
            onChange={handleBpmChange}
          />
        )}
      </div>

      {/* 곡 목록 시트: 화면 위로 슬라이드 업 되는 레이어 */}
      {showPlaylist && (
        <>
          {/* 딤 배경 — 탭하면 닫힘 */}
          <div className="sheet-backdrop" onClick={() => setShowPlaylist(false)} />
          <div className="playlist-sheet">
            <div className="sheet-header">
              <span className="sheet-title">Playlist</span>
              <button className="sheet-close" onClick={() => setShowPlaylist(false)}>
                ✕
              </button>
            </div>
            <TrackListPage
              tracks={tracks}
              currentId={currentId}
              onSelect={(meta) => {
                handleSelectTrack(meta) // 곡 선택 → 재생 시작
                setShowPlaylist(false) // 시트 자동 닫힘
              }}
              onDelete={handleDeleteTrack}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default App
