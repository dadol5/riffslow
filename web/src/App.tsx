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
import ChordsGadget from './components/gadgets/ChordsGadget'
import { analyzeBpm } from './audio/bpm'
import { analyzeChords, type ChordSegment } from './audio/chords'
import { guessStemName, mixStemsToWav, stemSetTitle, STEM_ORDER } from './audio/stems'
import MixerSheet from './components/MixerSheet'
import { keepScreenAwake } from './utils/wakeLock'
import {
  addTrack,
  deleteTrack,
  getAllTracks,
  getStems,
  getTrack,
  getTrackFile,
  saveStems,
  updateSettings,
  type Loop,
  type StemFile,
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
  // Stems 탭은 패널 전환 없이 바로 믹서 시트를 띄움 (사용자 결정)
  const handleGadgetSelect = (id: GadgetId) => {
    if (id === 'stems') {
      setShowMixer(true)
      return
    }
    setActiveGadget(id)
  }
  const [volume, setVolume] = useState(100) // 마스터 볼륨 % (전역 설정)
  const [pitch, setPitch] = useState(0) // 피치 반음 (곡별 저장)

  // ── BPM (곡별 저장): undefined = 미분석, null = 분석 실패 확정, number = 값 ──
  // 분석 로직 버전 — 로직이 바뀌면 올려서 기존 저장 데이터를 자동 재분석
  // (v2: 스템 곡은 드럼 스템으로 분석 + 소수점 BPM — 정수 그리드의 누적 드리프트 해결)
  const BPM_ANALYSIS_VERSION = 2
  const [bpm, setBpm] = useState<number | null | undefined>(undefined)
  const [bpmOffset, setBpmOffset] = useState<number | null>(null) // 첫 박 위치 (메트로놈용)
  const [bpmVer, setBpmVer] = useState(BPM_ANALYSIS_VERSION)
  const [bpmAnalyzing, setBpmAnalyzing] = useState(false)
  const [metroOn, setMetroOn] = useState(false) // 메트로놈 on/off (세션 한정 — 저장 안 함)
  const [bpmLocked, setBpmLocked] = useState(true) // BPM 자물쇠 (잠김 = 조절 불가 + 속도 반영 표시)
  const [metroVolume, setMetroVolume] = useState(100) // 메트로놈 볼륨 % (음원과 개별)

  // ── 스템 믹서: 볼륨/뮤트는 곡별 저장(stemMix), 솔로는 세션 한정 ──
  // 현재 곡에 붙은 스템 이름 목록 (목록 메타에서 파생 — 스템 세트 추가 시 자동 반영)
  const currentStemNames = tracks.find((t) => t.id === currentId)?.stemNames
  const [showMixer, setShowMixer] = useState(false)
  const [stemMix, setStemMix] = useState<Record<string, { volume: number; muted: boolean }>>({})
  const [soloStems, setSoloStems] = useState<Set<string>>(new Set())

  const handleStemVolume = (name: string, volume: number) => {
    setStemMix((m) => ({ ...m, [name]: { volume, muted: m[name]?.muted ?? false } }))
  }
  const handleStemMute = (name: string) => {
    setStemMix((m) => ({
      ...m,
      [name]: { volume: m[name]?.volume ?? 1, muted: !(m[name]?.muted ?? false) },
    }))
  }
  const handleStemSolo = (name: string) => {
    setSoloStems((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 연습 중 폰 화면이 자동으로 꺼지지 않게 (앱이 화면에 떠 있는 동안 유지)
  useEffect(() => {
    keepScreenAwake()
  }, [])

  // 믹서 상태 → 엔진 반영 (솔로가 있으면 솔로만 들림, 없으면 뮤트 제외 전부)
  // 반영 = 스템 재합성(무거움)이라 연속 변경(페이더 드래그)은 250ms 디바운스로 마지막 값만
  useEffect(() => {
    if (!currentStemNames || currentStemNames.length === 0) return
    const gains = currentStemNames.map((name) => {
      const m = stemMix[name]
      const vol = m?.volume ?? 1
      const muted = m?.muted ?? false
      return soloStems.size > 0 ? (soloStems.has(name) ? vol : 0) : muted ? 0 : vol
    })
    const timer = setTimeout(() => {
      void player.applyStemGains(gains)
    }, 250)
    return () => clearTimeout(timer)
  }, [player, currentStemNames, stemMix, soloStems])

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
  // 결과를 반환해서 후속 코드 분석이 박 정렬 그리드로 바로 쓸 수 있게 함 (state는 반영이 늦음)
  const runBpmAnalysis = async (trackId: number) => {
    const base = player.audioBuffer
    if (!base) return null
    setBpmAnalyzing(true)
    // 스템 곡이면 드럼 스템만으로 분석 (비트의 근원 — 재구성 믹스보다 정확)
    // 드럼 스템이 없거나 드럼 기반 분석이 실패하면 전체 믹스로 폴백
    const drums = await player.buildAnalysisMix((n) => (n === 'drums' ? 1 : 0))
    let result = drums ? await analyzeBpm(drums) : null
    if (drums) {
      console.log(`BPM 분석 입력: 드럼 스템 (${result ? '성공' : '실패 → 전체 믹스 재시도'})`)
    }
    if (!result) result = await analyzeBpm(base)
    // 분석 도중 다른 곡으로 바뀌었으면 결과 폐기 (그 곡의 로드 흐름이 상태를 관리)
    if (currentIdRef.current !== trackId) return null
    setBpmAnalyzing(false)
    setBpm(result?.bpm ?? null) // 실패는 null 저장 → 다음 로드 때 재분석됨
    setBpmOffset(result?.offset ?? null)
    setBpmVer(BPM_ANALYSIS_VERSION)
    return result
  }

  // ── 코드/KEY (곡별 저장): undefined = 미분석, null = 실패, 배열 = 값 ──
  // 분석 로직 버전 — 로직이 바뀌면 올려서 기존 저장 데이터를 자동 재분석
  // (v4: 박 정렬, v5: HPSS+베이스 루트+다이어토닉+Viterbi, v6: 드럼 구간 게이트+마디 스냅,
  //  v7: 스템 곡은 드럼/보컬 제외 반주만으로 분석 — 크로마 오염 원천 제거,
  //  v8: KEY를 코드 진행 적합도로 재판정 — KeyExtractor의 이웃 조 혼동(F↔Bb) 교정,
  //  v9: 상대 장/단조(F↔Dm) 판별 — 자연단조 기준 동점 + 종지/끝코드/으뜸화음 순 결정,
  //  v10: 표기를 플랫 기준으로 (A# → Bb — 사용자 선호),
  //  v11: 도미넌트 7th(X7) 사전 추가 — A7이 Em으로 미끄러지던 문제,
  //  v12: 보컬을 35% 가중치로 분석에 재포함 — 반주 옅은 구간의 화성 힌트 복원)
  const CHORDS_ANALYSIS_VERSION = 14
  const [chords, setChords] = useState<ChordSegment[] | null | undefined>(undefined)
  const [songKey, setSongKey] = useState<string | null | undefined>(undefined)
  const [chordsVer, setChordsVer] = useState(CHORDS_ANALYSIS_VERSION)
  const [chordsAnalyzing, setChordsAnalyzing] = useState(false)

  // 코드/KEY 자동 분석 (워커에서 수행 — 수~수십 초 걸리지만 UI/재생에 영향 없음)
  // beatGrid가 있으면 코드 경계가 박자에 정렬됨
  const runChordAnalysis = async (
    trackId: number,
    beatGrid: { bpm: number; offset: number } | null,
  ) => {
    const base = player.audioBuffer
    if (!base) return
    setChordsAnalyzing(true)
    // 스템 곡이면 드럼 제거 + 보컬 35%로 분석 (v7: 보컬 완전 제거 → v12: 감량 포함)
    // 반주가 옅은 구간에선 보컬 멜로디가 화성의 주요 힌트라 완전히 빼면 이웃 화음으로 미끄러짐
    const harmonic = await player.buildAnalysisMix((n) =>
      n === 'drums' ? 0 : n === 'vocals' ? 0.35 : 1,
    )
    const buffer = harmonic ?? base
    console.log(
      `코드/KEY 분석 시작 (백그라운드, 박 정렬 ${beatGrid ? 'ON' : 'OFF'}, 입력 ${harmonic ? '반주 스템(드럼/보컬 제외)' : '전체 믹스'})...`,
    )
    const started = performance.now()
    const result = await analyzeChords(buffer, beatGrid)
    if (currentIdRef.current !== trackId) return
    setChordsAnalyzing(false)
    setChords(result?.segments ?? null)
    setSongKey(result?.key ?? null)
    setChordsVer(CHORDS_ANALYSIS_VERSION)
    if (result) {
      // 1단계 검증용 로그: KEY + 앞부분 코드 진행을 눈으로 확인
      const preview = result.segments
        .slice(0, 20)
        .map((s) => `${s.start.toFixed(1)}~${s.end.toFixed(1)} ${s.chord}`)
        .join(' | ')
      console.log(
        `코드 분석 완료 (${((performance.now() - started) / 1000).toFixed(1)}초): KEY = ${result.key}, 구간 ${result.segments.length}개`,
      )
      console.log(`앞부분 진행: ${preview}`)
    }
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
        bpmVer,
        chords,
        songKey,
        chordsVer,
        stemMix,
      })
    }, 300)
    return () => clearTimeout(timer) // 300ms 안에 또 바뀌면 이전 예약 취소 (디바운스)
  }, [currentId, tempo, pitch, loops, posMarkers, trackS, trackE, bpm, bpmOffset, bpmVer, chords, songKey, chordsVer, stemMix])

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

  // 새 곡을 엔진에 로드하고 라이브러리에 저장 (일반 곡 / 스템 세트 공용)
  const registerNewTrack = async (name: string, source: Blob, stems?: StemFile[]) => {
    setLoadingText('디코딩 중...')
    // 스템 세트는 스템 재생 엔진으로 (악기별 볼륨 즉시 가능), 일반 곡은 기존 경로
    const dur =
      stems && stems.length > 0 ? await player.loadStemTrack(stems) : await player.load(source)
    setFileName(name)
    setDuration(dur)
    setPosition(0)
    // 곡 단위 설정 초기화 (엔진 쪽 루프/S/E는 load()가 정리함)
    // 템포도 새 곡은 100%부터 — 이전 곡의 배속이 새 곡 설정으로 저장되는 것 방지
    setTempo(100)
    player.tempo = 1
    setLoops([])
    setPosMarkers([])
    setTrackS(null)
    setTrackE(null)
    setPitch(0)
    player.pitchSemitones = 0
    setBpm(undefined)
    setBpmOffset(null)
    setChords(undefined)
    setSongKey(undefined)
    setStemMix({})
    setSoloStems(new Set())

    // 라이브러리에 저장 (동영상은 추출된 오디오만 저장 — 용량 절약 + 다음부턴 추출 생략)
    const meta = await addTrack(name, source, dur)
    if (stems && stems.length > 0) await saveStems(meta.id, stems)
    setCurrentId(meta.id)
    setTracks(await getAllTracks())
    console.log(`디코딩 완료: ${name} (길이 ${dur.toFixed(1)}초) — 라이브러리 저장됨`)

    // BPM → 코드/KEY 순차 자동 분석 (백그라운드 — 동시에 돌리면 폰 CPU 부담이라 순차로)
    // BPM 결과가 있으면 코드 경계를 박자에 정렬
    void runBpmAnalysis(meta.id).then((b) =>
      runChordAnalysis(meta.id, b ? { bpm: b.bpm, offset: b.offset } : null),
    )
  }

  // 파일 선택 → 엔진에 로드 + 라이브러리에 저장
  // 여러 개 선택 = 스템 세트 (사용자 결정: 추가할 때부터 일반 곡과 구분)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0) return
    const file = files[0]

    // 스템 세트 확인 (합치면 원곡이 되므로 원곡 파일은 따로 필요 없음)
    let stemMode = false
    if (files.length > 1) {
      stemMode = confirm(
        `선택한 ${files.length}개 파일을 "스템 세트"(분리된 악기들)로 묶어 한 곡으로 추가할까요?\n\n· 예 = 스템들을 합쳐 한 곡으로 등록 (믹서에서 악기별 조절 예정)\n· 아니오 = 취소 (여러 곡 일괄 추가는 지원하지 않아요 — 한 곡씩 추가해 주세요)`,
      )
      if (!stemMode) return
    }

    player.ensureContext() // 제스처 컨텍스트가 살아있을 때(await 이전) 오디오 준비
    setIsPlaying(false)
    setIsLoading(true)
    try {
      if (stemMode) {
        // 파일명에서 스템 이름 추측 — 못 알아보거나 겹치면 파일명 그대로 사용
        const used = new Set<string>()
        const stems: StemFile[] = files.map((f) => {
          let name = guessStemName(f.name)
          if (!name || used.has(name)) {
            const base = f.name.replace(/\.[^.]+$/, '')
            name = base
            let n = 2
            while (used.has(name)) name = `${base}${n++}`
          }
          used.add(name)
          return { name, blob: f }
        })
        // 표준 순서(보컬→드럼→베이스→기타→피아노→나머지)로 정렬
        stems.sort((a, b) => {
          const ai = STEM_ORDER.indexOf(a.name)
          const bi = STEM_ORDER.indexOf(b.name)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })

        // 스템 합산 = 원곡 복원 → 합본이 이 곡의 재생 소스가 됨
        setLoadingText(`스템 합치는 중... (0/${stems.length})`)
        const { blob: mixed } = await mixStemsToWav(
          stems.map((s) => s.blob),
          (done, total) => setLoadingText(`스템 합치는 중... (${done}/${total})`),
        )
        await registerNewTrack(stemSetTitle(files.map((f) => f.name)), mixed, stems)
        console.log(`스템 세트 등록: ${stems.map((s) => s.name).join(', ')}`)
      } else {
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

        await registerNewTrack(file.name, source)
      }
    } catch (err) {
      // 다른 곡 로드가 시작돼 취소된 경우는 정상 흐름 — 조용히 넘어감
      if (err instanceof Error && err.message.startsWith('로드 취소')) return
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

  // BPM 자물쇠 토글 (열림 = 100% 기준값 조절 모드, 잠김 = 설정한 값이 100% 기준으로 확정)
  const handleBpmLockToggle = () => {
    setBpmLocked((locked) => !locked)
  }

  // 메트로놈 토글 (BPM 가젯 — 재생 중 음악 위에 클릭음 얹기)
  const handleMetroToggle = () => {
    const next = !metroOn
    setMetroOn(next)
    player.metronome = next
  }

  // 첫 박 위치(오프셋) 미세조정 — 자동 분석이 잡은 첫 박이 어긋났을 때 귀로 맞추는 용도
  // 코드(v6)는 이 그리드에 스냅해 만들어지므로 코드 타임라인도 같은 만큼 함께 이동시킴
  const handleOffsetNudge = (deltaSec: number) => {
    setBpmOffset((prev) => (prev ?? 0) + deltaSec)
    setChords((prev) =>
      prev == null
        ? prev
        : prev.map((seg) => ({
            ...seg,
            start: Math.max(0, seg.start + deltaSec),
            end: seg.end + deltaSec,
          })),
    )
  }

  // ── 박자 탭: 재생 중 박자에 맞춰 탭하면 탭 위상의 평균으로 첫 박을 자동 정렬 ──
  // (10ms 버튼 연타는 귀로 맞추기 힘들다는 피드백 → 탭 방식으로 교체)
  const beatTapsRef = useRef<number[]>([]) // 탭 순간 "들리던 소리"의 원곡 시간들
  const lastTapWallRef = useRef(0)
  const [tapCount, setTapCount] = useState(0)

  const handleBeatTap = () => {
    if (bpm == null || !isPlaying) return
    const now = performance.now()
    // 잠깐(2.5초) 쉬면 새 탭 세션으로 시작
    if (now - lastTapWallRef.current > 2500) beatTapsRef.current = []
    lastTapWallRef.current = now

    // 탭 순간 실제로 들리던 위치 = 엔진 위치 − 출력 지연(배속 환산) — 코드 표시와 같은 보정
    const heard = Math.max(0, player.position - player.playbackLatency * (tempo / 100))
    const taps = beatTapsRef.current
    taps.push(heard)
    if (taps.length > 8) taps.shift() // 최근 8탭만 (초반 어긋난 탭의 영향 축소)
    setTapCount(taps.length)

    // 3탭부터 정렬 시작: 박 주기 위의 위상들을 원형 평균 → 그 위상으로 오프셋 이동
    if (taps.length < 3) return
    const period = 60 / bpm // 원곡 시간 기준 박 간격 (position이 원곡 시간축이라 배속 무관)
    const twoPi = Math.PI * 2
    let sx = 0
    let sy = 0
    for (const t of taps) {
      const ph = ((t % period) / period) * twoPi
      sx += Math.cos(ph)
      sy += Math.sin(ph)
    }
    let meanPhase = (Math.atan2(sy, sx) / twoPi) * period
    if (meanPhase < 0) meanPhase += period
    const curPhase = (((bpmOffset ?? 0) % period) + period) % period
    let delta = meanPhase - curPhase
    // 최단 방향으로 이동 (반 주기 이상 차이면 반대쪽이 가까움)
    if (delta > period / 2) delta -= period
    if (delta < -period / 2) delta += period
    handleOffsetNudge(delta)
  }

  // (앱 내 스템 추출 UI는 제거됨 — 추출은 PC의 UVR로 하는 게 확정 흐름.
  //  엔진 코드는 src/audio/stems.ts의 separateStems/encodeWavStereo로 남아 있어
  //  추후 SET-01 설정 화면에서 백업 기능으로 부활 가능)

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
    if (isLoading) return // 로드 중 다른 곡 선택 무시 (겹친 로드가 상태를 뒤섞는 것 방지)
    setIsPlaying(false)
    setIsLoading(true)
    setLoadingText('불러오는 중...')
    try {
      // 최신 메타 (목록의 메타는 오래됐을 수 있음 — 설정/스템 유무 판단에 사용)
      const fresh = (await getTrack(meta.id)) ?? meta

      // 스템 곡이면 스템 재생 엔진으로 (악기별 볼륨), 아니면 원본 파일로
      let dur: number
      const stems = fresh.stemNames?.length ? await getStems(meta.id) : undefined
      if (stems && stems.length > 0) {
        // 저장된 믹서 상태를 초기 게인으로 넘김 — 로드 직후 불필요한 재합성 방지
        const savedMix = fresh.settings.stemMix ?? {}
        const gains = stems.map((st) => {
          const m = savedMix[st.name]
          return m?.muted ? 0 : (m?.volume ?? 1)
        })
        dur = await player.loadStemTrack(stems, gains)
      } else {
        const blob = await getTrackFile(meta.id)
        if (!blob) throw new Error('저장된 파일을 찾을 수 없어요')
        dur = await player.load(blob)
      }
      setFileName(meta.name)
      setDuration(dur)
      setPosition(0)
      setCurrentId(meta.id)

      // 저장된 곡별 설정 복원
      const s = fresh.settings
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

      // BPM/코드/KEY 복원 — 유효한 값이 없으면(미분석/구버전/직전 실패) 다시 분석
      // (실패도 재시도하는 이유: 분석 로직이 개선되면 자동으로 다시 혜택받도록 — 백그라운드라 부담 없음)
      setBpm(s.bpm)
      setBpmOffset(s.bpmOffset ?? null)
      setBpmVer(s.bpmVer ?? 1)
      setBpmAnalyzing(false)
      setChords(s.chords)
      setSongKey(s.songKey)
      setChordsVer(s.chordsVer ?? 1)
      setChordsAnalyzing(false)
      // 스템 믹서 복원 (볼륨/뮤트는 곡별 저장, 솔로는 세션 한정이라 초기화)
      setStemMix(s.stemMix ?? {})
      setSoloStems(new Set())
      if (s.chords != null) {
        console.log(`저장된 코드 복원: KEY = ${s.songKey}, 구간 ${s.chords.length}개`)
      }
      // 미분석/실패뿐 아니라 구버전 로직으로 분석된 데이터도 재분석 대상
      const needBpm = s.bpm == null || (s.bpmVer ?? 1) < BPM_ANALYSIS_VERSION
      // 디버그 모드(판정 근거 로그)면 로드할 때마다 강제 재분석 — 로그는 분석 중에만 나오므로
      const chordsDebug = localStorage.getItem('riffslow-chords-debug') === '1'
      // BPM이 다시 분석되면 그리드가 바뀌므로 코드도 새 그리드로 다시 정렬해야 함
      const needChords =
        s.chords == null || (s.chordsVer ?? 1) < CHORDS_ANALYSIS_VERSION || needBpm || chordsDebug
      if (needBpm || needChords) {
        // 필요한 것만 순차 실행 (동시에 돌리면 폰 CPU 부담)
        void (async () => {
          // 박 정렬용 그리드: 저장된 BPM이 있으면 그것, 없으면 방금 분석한 결과
          let grid =
            s.bpm != null && s.bpmOffset != null ? { bpm: s.bpm, offset: s.bpmOffset } : null
          if (needBpm) {
            const b = await runBpmAnalysis(meta.id)
            grid = b ? { bpm: b.bpm, offset: b.offset } : null
          }
          if (needChords) await runChordAnalysis(meta.id, grid)
        })()
      }

      if (autoPlay) {
        player.play()
        setIsPlaying(player.isPlaying)
      }
    } catch (err) {
      // 다른 곡 로드가 시작돼 취소된 경우는 정상 흐름 — 조용히 넘어감
      if (err instanceof Error && err.message.startsWith('로드 취소')) return
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
      <GadgetBar
        active={activeGadget}
        showStems={currentStemNames != null && currentStemNames.length > 0}
        onSelect={handleGadgetSelect}
      />
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
          <PitchGadget pitch={pitch} songKey={songKey} onChange={handlePitchChange} />
        )}
        {activeGadget === 'chords' && (
          <ChordsGadget
            hasTrack={hasTrack}
            analyzing={chordsAnalyzing}
            chords={chords}
            duration={duration}
            pitch={pitch}
            // 재생 중엔 엔진 출력 지연만큼 앞서가는 위치를 "지금 들리는 소리" 기준으로 보정
            position={
              isPlaying
                ? Math.max(0, position - player.playbackLatency * (tempo / 100))
                : position
            }
            onSeek={handleSeek}
          />
        )}
        {activeGadget === 'bpm' && (
          <BpmGadget
            hasTrack={hasTrack}
            analyzing={bpmAnalyzing}
            bpm={bpm}
            tempo={tempo}
            locked={bpmLocked}
            onChange={handleBpmChange}
            onToggleLock={handleBpmLockToggle}
            onOffsetNudge={handleOffsetNudge}
            playing={isPlaying}
            tapCount={tapCount}
            onBeatTap={handleBeatTap}
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

      {/* 스템 믹서 시트 (레이어) — 스템 곡에서만 */}
      {showMixer && currentStemNames != null && currentStemNames.length > 0 && (
        <MixerSheet
          names={currentStemNames}
          mix={stemMix}
          solos={soloStems}
          onVolume={handleStemVolume}
          onToggleMute={handleStemMute}
          onToggleSolo={handleStemSolo}
          onClose={() => setShowMixer(false)}
        />
      )}

    </div>
  )
}

export default App
