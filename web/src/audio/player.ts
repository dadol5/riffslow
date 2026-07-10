// 오디오 재생 엔진 — SoundTouchJS(PitchShifter) 기반
// 템포(속도)를 20~250%로 바꿔도 음정이 유지되는 타임 스트레칭 재생
//
// 구조: AudioBuffer(디코딩된 곡) → PitchShifter(실시간 템포/피치 처리) → 스피커
// - 재생 = shifter를 스피커에 connect / 일시정지 = disconnect
// - 위치 = shifter.timePlayed (원곡 기준 초 — 템포를 바꿔도 이 값 기준은 불변)

import { PitchShifter } from 'soundtouchjs'

// 템포 범위 (원본 앱과 동일: 20% ~ 250%)
export const MIN_TEMPO = 0.2
export const MAX_TEMPO = 2.5

// 오디오 처리 단위 (클수록 안정적, 대신 지연 증가 — 모바일 안정성 우선)
const PROCESS_BUFFER_SIZE = 4096

// 1초짜리 무음 WAV를 코드로 직접 생성 (iOS 무음 스위치 대응용)
// 데이터 URI 방식은 파일이 너무 짧아 iOS가 "재생 중 미디어"로 인정하지 않는 문제가 있어
// 정상 길이의 WAV를 만들어 Blob URL로 제공
function createSilentWavUrl(): string {
  const sampleRate = 8000
  const numSamples = sampleRate // 1초 분량
  const buf = new ArrayBuffer(44 + numSamples * 2)
  const v = new DataView(buf)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  // WAV 헤더 (PCM 16bit 모노)
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + numSamples * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 모노
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeStr(36, 'data')
  v.setUint32(40, numSamples * 2, true)
  // 샘플 영역은 ArrayBuffer 초기값이 전부 0 = 무음
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

export class Player {
  private ctx: AudioContext | null = null
  private buffer: AudioBuffer | null = null
  private shifter: PitchShifter | null = null
  private playing = false
  private _tempo = 1 // 현재 템포 배율 (라이브러리가 읽기를 지원 안 해서 직접 보관)

  // A/B 구간 루프 (둘 다 설정되면 활성)
  private loopStart: number | null = null
  private loopEnd: number | null = null

  // 시작(S)/끝(E) 마커: 재생 범위 재정의 (null = 곡 처음/끝 그대로)
  private trackStart: number | null = null
  private trackEnd: number | null = null

  // 트랙 루프: E(또는 곡 끝) 도달 시 S로 복귀하며 반복
  trackLoop = false

  // iOS 무음 스위치 대응용 무음 오디오 태그 (앱 전체 1개)
  private silentAudio: HTMLAudioElement | null = null

  // 곡이 끝까지 재생됐을 때 화면에 알리는 콜백 (App에서 등록)
  onEnded: (() => void) | null = null

  // iOS 무음 모드에서도 스피커 출력 허용
  // 원리: <audio> 태그가 재생 중이면 iOS가 세션을 "미디어 재생"(음악 앱과 동일)으로
  // 분류해서, 무음 스위치와 무관하게 Web Audio도 스피커로 출력됨 (표준 우회법)
  private unlockIosSpeaker(): void {
    if (!this.silentAudio) {
      const audio = new Audio(createSilentWavUrl())
      audio.loop = true // 계속 재생 상태 유지 (미디어 세션 유지의 핵심)
      audio.setAttribute('playsinline', '') // iOS 전체화면 전환 방지
      this.silentAudio = audio
    }

    const audio = this.silentAudio
    if (!audio.paused) return // 이미 재생 중이면 할 일 없음

    audio.play().then(
      () => console.log('iOS 스피커 잠금 해제 성공'),
      () => {
        // 사용자 제스처 컨텍스트가 아니면 거부됨 → 다음 터치/클릭에서 1회 재시도
        console.warn('무음 오디오 재생 거부 — 다음 터치에서 재시도')
        const retry = () => {
          audio.play().then(
            () => console.log('iOS 스피커 잠금 해제 성공 (재시도)'),
            () => {},
          )
          document.removeEventListener('touchend', retry)
          document.removeEventListener('click', retry)
        }
        document.addEventListener('touchend', retry)
        document.addEventListener('click', retry)
      },
    )
  }

  // 오디오 컨텍스트 준비 + iOS 잠금 해제
  // ⚠️ 반드시 사용자 터치/클릭 핸들러 안에서 (await 이전에) 동기로 호출할 것
  // — iOS는 제스처 컨텍스트에서만 오디오 시작을 허용하는데, await를 거치면 제스처 인정이 풀림
  ensureContext(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    this.unlockIosSpeaker()
  }

  // 파일 로드 + 디코딩. 곡 길이(초)를 반환
  // (File 또는 동영상에서 추출된 오디오 Blob 모두 수용)
  async load(file: Blob): Promise<number> {
    this.ensureContext()
    // ensureContext()가 ctx 생성을 보장하지만, TS는 메서드 너머를 추적 못 하므로 지역 변수로 좁힘
    const ctx = this.ctx
    if (!ctx) throw new Error('오디오 컨텍스트 생성 실패')

    this.stop() // 이전 곡 정리
    this.setLoop(null, null) // 이전 곡의 루프 구간 초기화 (곡 단위 설정)
    this.setTrackMarkers(null, null) // S/E 마커도 곡 단위라 초기화 (트랙 루프 토글은 유지)

    const arrayBuffer = await file.arrayBuffer()
    this.buffer = await ctx.decodeAudioData(arrayBuffer)

    // 곡마다 새 shifter 생성 (buffer가 생성자에 묶이는 구조라 재사용 불가)
    this.shifter = new PitchShifter(
      ctx,
      this.buffer,
      PROCESS_BUFFER_SIZE,
      () => this.handleEnd(),
    )
    this.shifter.tempo = this._tempo // 직전 템포 설정 유지

    // 오디오 처리 콜백마다 루프 조건 검사 (화면 상태와 무관하게 엔진이 책임)
    this.shifter.on('play', () => this.checkLoop())

    return this.buffer.duration
  }

  get duration(): number {
    return this.buffer?.duration ?? 0
  }

  get isPlaying(): boolean {
    return this.playing
  }

  // 현재 재생 위치 (원곡 기준 초) — shifter가 재생 중 자동 갱신
  get position(): number {
    return this.shifter?.timePlayed ?? 0
  }

  // 템포 배율 (1 = 원속도, 0.5 = 절반 속도·음정 유지)
  get tempo(): number {
    return this._tempo
  }

  set tempo(value: number) {
    this._tempo = Math.max(MIN_TEMPO, Math.min(value, MAX_TEMPO))
    if (this.shifter) {
      this.shifter.tempo = this._tempo // 재생 중 실시간 반영
    }
  }

  play(): void {
    if (!this.ctx || !this.shifter || this.playing) return
    this.ensureContext() // 컨텍스트 깨우기 + 무음 모드 해제 재시도

    // S 마커보다 앞이거나 E 마커 밖이면 S부터 시작 (재생 범위 재정의)
    const start = this.effectiveStart
    if (this.position < start || (this.trackEnd !== null && this.position >= this.trackEnd)) {
      this.seek(start)
    }

    // 연결하는 순간부터 소리가 흐름
    this.shifter.connect(this.ctx.destination)
    this.playing = true
  }

  pause(): void {
    if (!this.shifter || !this.playing) return
    this.shifter.disconnect() // 연결 해제 = 정지 (위치는 shifter 내부에 유지됨)
    this.playing = false
  }

  // 지정 위치로 이동 (재생 중이면 그 위치에서 계속 흘러나옴)
  seek(pos: number): void {
    if (!this.shifter || this.duration === 0) return
    const clamped = Math.max(0, Math.min(pos, this.duration))
    // ⚠️ percentagePlayed는 쓸 때 0~1 비율을 받음 (읽을 땐 0~100 — 라이브러리 특성)
    this.shifter.percentagePlayed = clamped / this.duration
  }

  // A/B 루프 설정 (null 전달 시 해제)
  setLoop(start: number | null, end: number | null): void {
    this.loopStart = start
    this.loopEnd = end
  }

  // S/E 마커 설정: 재생 시작/끝 지점 재정의 (null = 해제)
  setTrackMarkers(start: number | null, end: number | null): void {
    this.trackStart = start
    this.trackEnd = end
  }

  // 실효 시작 지점 (S 마커 없으면 곡 처음)
  private get effectiveStart(): number {
    return this.trackStart ?? 0
  }

  // 재생 위치 감시 (오디오 콜백마다 호출)
  private checkLoop(): void {
    if (!this.playing) return

    // 1순위: A/B 구간 루프 — B를 넘으면 A로 복귀
    if (this.loopStart !== null && this.loopEnd !== null) {
      if (this.position >= this.loopEnd) {
        this.seek(this.loopStart)
      }
      return
    }

    // 2순위: E 마커 — 도달 시 S로 복귀(트랙 루프 on) 또는 정지
    if (this.trackEnd !== null && this.position >= this.trackEnd) {
      if (this.trackLoop) {
        this.seek(this.effectiveStart)
      } else {
        this.pause()
        this.seek(this.effectiveStart)
        this.onEnded?.()
      }
    }
  }

  // 곡 자연 종료 처리 (곡 데이터를 끝까지 소모한 경우)
  private handleEnd(): void {
    // A/B 루프가 걸려 있으면 (B가 곡 끝 근처인 경우) 정지하지 않고 A로 복귀
    if (this.loopStart !== null && this.loopEnd !== null) {
      this.seek(this.loopStart)
      return
    }
    // 트랙 루프: S로 복귀하며 계속 재생
    if (this.trackLoop) {
      this.seek(this.effectiveStart)
      return
    }
    this.pause()
    this.seek(this.effectiveStart)
    this.onEnded?.()
  }

  // 현재 shifter 완전 정리 (곡 교체 시)
  private stop(): void {
    if (this.shifter) {
      this.shifter.off() // 이벤트 리스너 해제
      this.shifter.disconnect()
      this.shifter = null
    }
    this.playing = false
  }
}
