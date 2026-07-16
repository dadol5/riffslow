// 오디오 재생 엔진 — Signalsmith Stretch(WASM, AudioWorklet) 기반
// 템포(속도)를 20~250%로 바꿔도 음정이 유지되는 타임 스트레칭 재생
//
// 구조: 디코딩된 채널 샘플(Float32Array[]) → StretchNode(AudioWorklet) → 마스터 볼륨 → 스피커
// - StretchNode는 앱 전체에서 하나만 만들어 재사용(곡 교체 시 dropBuffers+addBuffers로 데이터만 교체)
// - 재생/정지 = connect/disconnect가 아니라 schedule({active})로 상태만 전환(노드는 항상 연결됨)
// - 위치 = stretchNode.inputTime (원곡 기준 초 — setUpdateInterval 주기로 갱신됨)

import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'

// 템포 범위 (원본 앱과 동일: 20% ~ 250%)
export const MIN_TEMPO = 0.2
export const MAX_TEMPO = 2.5

// 위치 갱신 주기(초) — 휠 발광점/시간 표시가 이 주기로 스텝처럼 갱신됨 (너무 짧으면 메시지 낭비)
const POSITION_UPDATE_INTERVAL = 0.05

// 스트레치 분석 블록 길이(ms) — 작을수록 시크/템포 변경 반응이 빨라지고, 클수록 음질이 좋아짐
// 60ms로 낮췄더니 음질 저하가 체감돼서 라이브러리 기본값(120ms)으로 복원 (2026-07-13 실기기 튜닝)
const STRETCH_BLOCK_MS = 120

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
  private gain: GainNode | null = null // 마스터 볼륨 (stretchNode → gain → 스피커)
  private stretchNode: StretchNode | null = null
  private stretchNodeReady: Promise<StretchNode> | null = null // 노드 생성은 1회만(앱 전체 재사용)
  private audioBuffer_: AudioBuffer | null = null // 현재 곡의 디코딩 결과 (BPM 분석 등 외부 분석용)
  private duration_ = 0
  private playing = false
  private _tempo = 1 // 현재 템포 배율
  private _volume = 1 // 마스터 볼륨 (0~1)
  private _pitch = 0 // 피치 (반음 단위, ±12)

  // 구간 루프 목록 (여러 개 가능, end=null은 시작점만 있는 미완성 루프 — 재생엔 영향 없음)
  private loops: { start: number; end: number | null }[] = []

  // 시작(S)/끝(E) 마커: 재생 범위 재정의 (null = 곡 처음/끝 그대로)
  private trackStart: number | null = null
  private trackEnd: number | null = null

  // 트랙 루프: E(또는 곡 끝) 도달 시 S로 복귀하며 반복
  trackLoop = false

  // iOS 무음 스위치 대응용 무음 오디오 태그 (앱 전체 1개)
  private silentAudio: HTMLAudioElement | null = null

  // 앱 복귀 소생 리스너 중복 등록 방지 (컨텍스트 재생성 시 ensureContext가 다시 돌기 때문)
  private reviveAttached = false

  // 파이프라인 재생성 중복 실행 방지
  private rebuilding = false

  // ── 스템 모드: 스템을 메모리에 보관하고, 볼륨이 바뀌면 게인을 반영해 스테레오로
  // 미리 합친 뒤 엔진 재생 버퍼를 통째로 교체하는 방식 ──
  // (스템을 다채널 노드로 실시간 처리하는 방식은 아이폰 CPU가 못 버텨 지직거림 — 2026-07-16 실기기 확인.
  //  이 방식은 엔진 부하/음질이 일반 곡과 완전히 동일하고, 볼륨 반영만 약간(1초 안팎) 늦음)
  private stemData: { name: string; left: Int16Array; right: Int16Array }[] | null = null // Int16 = 메모리 절반
  private stemGains: number[] = [] // 현재 적용된 스템 게인 (0~1, stemData 순서)
  private remixToken = 0 // 연속 볼륨 변경 시 마지막 요청만 반영

  // ── 로드/버퍼 교체 경합 방지 ──
  // 곡 로드는 수 초 걸릴 수 있어(디코딩·합성) 그 사이 다른 곡을 선택하면 두 로드가 겹침
  // → 세대(loadSeq)가 다르면 늦게 끝난 쪽을 폐기 + 노드 버퍼 교체는 직렬화(끼어들기 금지)
  private loadSeq = 0
  private nodeOps: Promise<unknown> = Promise.resolve()

  // 노드 버퍼 교체(drop→schedule→addBuffers)가 서로 끼어들지 못하게 순서대로 실행
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.nodeOps.then(fn)
    this.nodeOps = run.catch(() => {}) // 앞 작업이 실패해도 다음 작업은 진행
    return run
  }

  // ── 메트로놈: BPM 그리드에 맞춰 클릭음을 음악 위에 얹음 ──
  private metroOn = false
  private metroBpm: number | null = null // null = 그리드 없음 (분석 실패/미분석)
  private metroOffset = 0 // 첫 박 위치 (원곡 기준 초)
  private metroNextBeat: number | null = null // 다음 예약할 박 인덱스 (null = 현재 위치에서 재계산)
  private metroScheduled: { osc: OscillatorNode; gain: GainNode }[] = [] // 예약된 클릭 (취소용)
  private stretchLatency = 0 // 스트레치 엔진 지연(초) — 클릭을 같은 만큼 늦춰야 음악과 정렬됨
  private metroGain: GainNode | null = null // 메트로놈 전용 볼륨 (음원 볼륨과 독립)
  private _metroVolume = 1 // 메트로놈 볼륨 (0~1)

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

      // 상태 변화 추적 (iOS는 다른 앱이 오디오를 쓰면 'interrupted'로 뺏김 — 언제 뺏기는지 기록)
      this.ctx.onstatechange = () => {
        console.log(`오디오 컨텍스트 상태 변화: ${this.ctx?.state}`)
      }

      // 앱 복귀 시 자동 소생 (사진 앱에서 동영상 재생 후 돌아오는 등 — iOS 표준 대응)
      // 제스처 밖이라 거부될 수 있지만, 되는 iOS 버전에선 이걸로 바로 살아남
      // (리스너는 앱 전체 1회만 — this.ctx를 매번 참조하므로 컨텍스트가 재생성돼도 유효)
      if (!this.reviveAttached) {
        this.reviveAttached = true
        const revive = () => {
          if (document.visibilityState !== 'visible') return
          if (this.ctx && this.ctx.state !== 'running') {
            console.log(`앱 복귀 감지 → 컨텍스트 소생 시도 (현재 ${this.ctx.state})`)
            this.ctx.resume().then(
              () => console.log(`복귀 소생 완료 → ${this.ctx?.state}`),
              (e) => console.warn(`복귀 소생 실패: ${e}`),
            )
          }
          // 무음 오디오도 다른 앱에 뺏기면 멈춰 있음 → 재가동 (미디어 세션 재획득)
          if (this.silentAudio?.paused) {
            this.silentAudio.play().catch(() => {})
          }
        }
        document.addEventListener('visibilitychange', revive)
        window.addEventListener('pageshow', revive)
      }
    }
    if (!this.gain) {
      // 음원 볼륨 노드: 스트레치 엔진 출력이 여기를 거쳐 스피커로 나감
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this._volume
      this.gain.connect(this.ctx.destination)
    }
    if (!this.metroGain) {
      // 메트로놈 볼륨 노드: 클릭음 전용 (음원과 개별 조절)
      this.metroGain = this.ctx.createGain()
      this.metroGain.gain.value = this._metroVolume
      this.metroGain.connect(this.ctx.destination)
    }
    // ⚠️ iOS는 'suspended' 외에 'interrupted'(전화/파일피커/앱전환 등) 상태도 있음 — running이 아니면 전부 깨움
    if (this.ctx.state !== 'running') {
      console.log(`오디오 컨텍스트 상태 ${this.ctx.state} → resume 시도`)
      this.ctx.resume().then(
        () => console.log(`resume 완료 → 상태 ${this.ctx?.state}`),
        (e) => console.warn(`resume 실패: ${e}`),
      )
    }
    this.unlockIosSpeaker()
    // 노드 생성은 await가 필요해 여기선 기다리지 않고 백그라운드로 시작만 해둠(제스처 유지)
    void this.getStretchNode()
  }

  // StretchNode를 1회만 생성해 앱 전체에서 재사용 (AudioWorklet 등록은 컨텍스트당 1회면 충분)
  private getStretchNode(): Promise<StretchNode> {
    if (!this.stretchNodeReady) {
      const ctx = this.ctx
      if (!ctx) throw new Error('오디오 컨텍스트 생성 실패')
      this.stretchNodeReady = SignalsmithStretch(ctx).then(
        (node) => {
          console.log('스트레치 노드 생성 완료 (WASM 로드 성공)')
          this.stretchNode = node
          // 시크 반응 속도 우선 튜닝 (기본 120ms 블록은 마커 이동 딜레이가 체감됨)
          node.configure({ blockMs: STRETCH_BLOCK_MS })
          // 엔진 지연 측정 (메트로놈 클릭 싱크 보정용 — configure 이후 값이어야 함)
          node.latency().then((sec) => {
            this.stretchLatency = sec
            console.log(`스트레치 엔진 지연: ${(sec * 1000).toFixed(0)}ms`)
          })
          node.setUpdateInterval(POSITION_UPDATE_INTERVAL, (pos) => this.checkPosition(pos))
          node.connect(this.gain ?? ctx.destination) // 항상 연결, active 플래그로만 소리 on/off
          return node
        },
        (e) => {
          console.error(`스트레치 노드 생성 실패: ${e}`)
          this.stretchNodeReady = null // 다음 시도에서 재생성 허용
          throw e
        },
      )
    }
    return this.stretchNodeReady
  }

  // 스템들을 게인 반영해 스테레오로 합성 (긴 곡도 화면이 멈추지 않게 조각 단위로 양보하며 처리)
  // stems를 인자로 받는 이유: 합성 도중 다른 곡이 로드돼 this.stemData가 바뀌어도 안전하게
  private async buildStemMix(
    stems: { left: Int16Array; right: Int16Array }[],
    gains: number[],
  ): Promise<{ left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }> {
    if (stems.length === 0) throw new Error('스템 데이터가 없어요')
    const len = stems[0].left.length
    const left = new Float32Array(len)
    const right = new Float32Array(len)
    const CHUNK = 1 << 20 // 약 100만 샘플씩 처리하고 이벤트 루프에 양보
    for (let start = 0; start < len; start += CHUNK) {
      const end = Math.min(len, start + CHUNK)
      for (let i = 0; i < stems.length; i++) {
        const g = (gains[i] ?? 1) / 32768 // Int16 → float 복원 스케일 겸함
        if (g === 0) continue // 뮤트된 스템은 통째로 건너뜀
        const sl = stems[i].left
        const sr = stems[i].right
        for (let k = start; k < end; k++) {
          left[k] += sl[k] * g
          right[k] += sr[k] * g
        }
      }
      if (end < len) await new Promise((r) => setTimeout(r, 0))
    }
    return { left, right }
  }

  // 파일 로드 + 디코딩. 곡 길이(초)를 반환
  // (File 또는 동영상에서 추출된 오디오 Blob 모두 수용)
  async load(file: Blob): Promise<number> {
    this.ensureContext()
    const seq = ++this.loadSeq // 이 로드의 세대 — 새 로드가 시작되면 이건 무효
    this.remixToken++ // 진행 중이던 스템 재합성도 무효화

    this.pause() // 이전 곡 재생 중지
    this.loops = [] // 이전 곡의 루프 초기화 (곡 단위 설정)
    this.setTrackMarkers(null, null) // S/E 마커도 곡 단위라 초기화

    // ensureContext()가 ctx 생성을 보장하지만, TS는 메서드 너머를 추적 못 하므로 지역 변수로 좁힘
    const ctx = this.ctx
    if (!ctx) throw new Error('오디오 컨텍스트 생성 실패')

    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const channels: Float32Array[] = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c))
    }

    // 상태 반영 + 버퍼 교체는 직렬 구간에서 — 겹친 로드가 서로의 버퍼를 덮어쓰지 못하게
    return this.runExclusive(async () => {
      if (seq !== this.loadSeq) throw new Error('로드 취소: 다른 곡 로드가 시작됨')
      this.stemData = null // 일반 곡 = 스템 상태 해제 (보관하던 스템 데이터도 메모리에서 놓아줌)
      this.stemGains = []
      this.audioBuffer_ = audioBuffer // BPM 분석 등에서 재사용 (곡 교체 시 함께 교체됨)
      this.duration_ = audioBuffer.duration

      const node = await this.getStretchNode()
      await node.dropBuffers() // 이전 곡 샘플 전부 제거
      // 재생 위치를 곡 처음으로 리셋 + 직전 템포/피치 설정 유지
      await node.schedule({ active: false, input: 0, rate: this._tempo, semitones: this._pitch })
      const bufferEnd = await node.addBuffers(channels)
      console.log(
        `곡 로드 완료: ${this.duration_.toFixed(1)}s, 버퍼 끝 ${bufferEnd.toFixed(1)}s, 채널 ${channels.length}, ctx 상태 ${ctx.state}`,
      )
      return this.duration_
    })
  }

  // 스템 곡 로드: 스템을 Int16으로 보관하고, 초기 게인을 반영한 스테레오 합성본을 재생
  // BPM/코드 분석용으로 "전부 100%" 합본 AudioBuffer도 보관. 곡 길이(초)를 반환
  async loadStemTrack(
    stems: { name: string; blob: Blob }[],
    initialGains?: number[],
  ): Promise<number> {
    if (stems.length === 0) throw new Error('스템 파일이 없어요')
    this.ensureContext()
    const seq = ++this.loadSeq // 이 로드의 세대 — 새 로드가 시작되면 이건 무효
    this.remixToken++ // 진행 중이던 스템 재합성도 무효화

    this.pause()
    this.loops = []
    this.setTrackMarkers(null, null)

    const ctx = this.ctx
    if (!ctx) throw new Error('오디오 컨텍스트 생성 실패')

    // 순차 디코딩 → Int16으로 보관 (Float 대비 메모리 절반 — 아이폰 보호), 원본 버퍼는 바로 GC로
    const data: { name: string; left: Int16Array; right: Int16Array }[] = []
    let maxLen = 0
    for (const stem of stems) {
      const buf = await ctx.decodeAudioData(await stem.blob.arrayBuffer())
      if (seq !== this.loadSeq) throw new Error('로드 취소: 다른 곡 로드가 시작됨')
      const l = buf.getChannelData(0)
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l
      const il = new Int16Array(buf.length)
      const ir = new Int16Array(buf.length)
      for (let k = 0; k < buf.length; k++) {
        il[k] = Math.max(-32768, Math.min(32767, Math.round(l[k] * 32767)))
        ir[k] = Math.max(-32768, Math.min(32767, Math.round(r[k] * 32767)))
      }
      data.push({ name: stem.name, left: il, right: ir })
      if (buf.length > maxLen) maxLen = buf.length
    }
    // 길이 통일 (짧은 스템은 뒤를 무음으로 — 같은 곡에서 분리했으면 거의 동일)
    for (let i = 0; i < data.length; i++) {
      if (data[i].left.length < maxLen) {
        const pl = new Int16Array(maxLen)
        pl.set(data[i].left)
        const pr = new Int16Array(maxLen)
        pr.set(data[i].right)
        data[i] = { name: data[i].name, left: pl, right: pr }
      }
    }
    const gains = data.map((_, i) => initialGains?.[i] ?? 1)

    // 분석용 합본은 "전부 100%" 기준 (스템 합 = 원곡 — 믹서 게인과 무관해야 분석이 일관됨)
    const full = await this.buildStemMix(data, data.map(() => 1))
    const mix = new AudioBuffer({ numberOfChannels: 2, length: maxLen, sampleRate: ctx.sampleRate })
    mix.copyToChannel(full.left, 0)
    mix.copyToChannel(full.right, 1)

    // 재생용 합성본: 게인이 전부 100%면 분석용과 동일하니 재활용 (재합성 생략)
    const allOne = gains.every((g) => g === 1)
    const playback = allOne ? full : await this.buildStemMix(data, gains)

    // 상태 반영 + 버퍼 교체는 직렬 구간에서 — 겹친 로드가 서로의 버퍼를 덮어쓰지 못하게
    return this.runExclusive(async () => {
      if (seq !== this.loadSeq) throw new Error('로드 취소: 다른 곡 로드가 시작됨')
      this.stemData = data
      this.stemGains = gains
      this.audioBuffer_ = mix
      this.duration_ = maxLen / ctx.sampleRate

      const node = await this.getStretchNode()
      await node.dropBuffers() // 이전 곡 샘플 전부 제거 (시간축도 0으로 리셋됨)
      await node.schedule({ active: false, input: 0, rate: this._tempo, semitones: this._pitch })
      // transfer로 소유권 이전 — 대용량 복사 방지 (audioBuffer_에는 이미 복사돼 있어 안전)
      const bufferEnd = await node.addBuffers(
        [playback.left, playback.right],
        [playback.left.buffer as ArrayBuffer, playback.right.buffer as ArrayBuffer],
      )
      console.log(
        `스템 곡 로드 완료: ${this.duration_.toFixed(1)}s, 버퍼 끝 ${bufferEnd.toFixed(1)}s, 스템 ${data.map((s) => s.name).join('/')}, 게인 [${gains.join(', ')}]`,
      )
      return this.duration_
    })
  }

  // 분석용 합성: 스템별 가중치로 합친 AudioBuffer를 반환 (스템 곡이 아니면 null)
  // 용도 = 코드 분석은 드럼 제거+보컬 감량(크로마 오염 억제), BPM 분석은 드럼만(비트의 근원)
  async buildAnalysisMix(weight: (name: string) => number): Promise<AudioBuffer | null> {
    const stems = this.stemData
    const ctx = this.ctx
    if (!stems || !ctx) return null
    const gains = stems.map((s) => weight(s.name))
    // 남는 스템이 없으면 의미 없음 — 호출부가 전체 믹스로 폴백
    if (gains.every((g) => g === 0)) return null
    const mixed = await this.buildStemMix(stems, gains)
    const buf = new AudioBuffer({
      numberOfChannels: 2,
      length: mixed.left.length,
      sampleRate: ctx.sampleRate,
    })
    buf.copyToChannel(mixed.left, 0)
    buf.copyToChannel(mixed.right, 1)
    return buf
  }

  // 스템 볼륨 적용: 게인 반영해 다시 합친 뒤 재생 버퍼를 통째로 교체 (위치/재생 상태 유지)
  // 실시간 게인이 아니라 반영이 약간 늦음 — 아이폰 CPU(지직거림)와 음질을 위한 절충
  async applyStemGains(gains: number[]): Promise<void> {
    const stems = this.stemData
    if (!stems) {
      console.warn('스템 믹스 무시: 스템 데이터 없음 (일반 곡이거나 로드 전)')
      return
    }
    // 같은 값이면 스킵 (로드 직후 App 이펙트가 저장값을 한 번 더 밀어넣는 경우 등)
    if (
      gains.length === this.stemGains.length &&
      gains.every((g, i) => g === this.stemGains[i])
    ) {
      console.log('스템 믹스 스킵: 게인 변화 없음')
      return
    }
    this.stemGains = gains.slice()
    const token = ++this.remixToken
    console.log(`스템 재합성 시작: [${gains.map((g) => Math.round(g * 100)).join(', ')}]%`)
    const t0 = performance.now()
    try {
      const mixed = await this.buildStemMix(stems, gains)
      await this.runExclusive(async () => {
        // 합성하는 사이 새 변경/다른 곡 로드가 들어왔으면 이 결과는 폐기
        if (token !== this.remixToken || this.stemData !== stems) {
          console.log('스템 믹스 폐기: 합성 중 새 변경/곡 교체 발생')
          return
        }
        const node = this.stretchNode
        if (!node) return
        const pos = this.position
        await node.dropBuffers()
        await node.addBuffers(
          [mixed.left, mixed.right],
          [mixed.left.buffer as ArrayBuffer, mixed.right.buffer as ArrayBuffer],
        )
        node.schedule({ input: pos }) // 위치 유지 — 재생 중이면 그 자리에서 새 믹스로 이어짐
        console.log(
          `스템 믹스 적용: [${gains.map((g) => Math.round(g * 100)).join(', ')}]% (${((performance.now() - t0) / 1000).toFixed(1)}초)`,
        )
      })
    } catch (err) {
      // 실패를 조용히 삼키지 않음 — 폰(eruda)에서 원인 확인용
      console.error('스템 믹스 실패:', err)
      throw err
    }
  }

  get duration(): number {
    return this.duration_
  }

  // 현재 곡의 디코딩된 버퍼 (BPM 분석용 — 곡이 없으면 null)
  get audioBuffer(): AudioBuffer | null {
    return this.audioBuffer_
  }

  get isPlaying(): boolean {
    return this.playing
  }

  // 현재 재생 위치 (원곡 기준 초) — setUpdateInterval 콜백마다 자동 갱신
  get position(): number {
    return this.stretchNode?.inputTime ?? 0
  }

  // 스트레치 엔진 출력 지연(실시간 초) — 화면 표시를 "지금 들리는 소리"에 맞출 때 보정용
  get playbackLatency(): number {
    return this.stretchLatency
  }

  // 템포 배율 (1 = 원속도, 0.5 = 절반 속도·음정 유지)
  get tempo(): number {
    return this._tempo
  }

  set tempo(value: number) {
    this._tempo = Math.max(MIN_TEMPO, Math.min(value, MAX_TEMPO))
    this.stretchNode?.schedule({ rate: this._tempo }) // 재생 중 실시간 반영
    this.cancelClicks() // 예약된 클릭 시각은 이전 배속 기준 — 전부 다시 계산
  }

  // 음원 볼륨 (0~1)
  get volume(): number {
    return this._volume
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(value, 1))
    if (this.gain) {
      this.gain.gain.value = this._volume
    }
  }

  // 메트로놈 볼륨 (0~1 — 음원 볼륨과 독립)
  get metroVolume(): number {
    return this._metroVolume
  }

  set metroVolume(value: number) {
    this._metroVolume = Math.max(0, Math.min(value, 1))
    if (this.metroGain) {
      this.metroGain.gain.value = this._metroVolume
    }
  }

  // 피치 (반음 단위, ±12 — 템포와 독립, 재생 중 실시간 반영)
  get pitchSemitones(): number {
    return this._pitch
  }

  set pitchSemitones(value: number) {
    this._pitch = Math.max(-12, Math.min(value, 12))
    this.stretchNode?.schedule({ semitones: this._pitch })
  }

  play(): void {
    if (!this.ctx || !this.stretchNode || this.playing) {
      // 재생이 조용히 무시되는 케이스 추적 (iOS 디버깅용)
      console.warn(
        `재생 무시됨: ctx=${!!this.ctx}, node=${!!this.stretchNode}, playing=${this.playing}`,
      )
      return
    }
    this.ensureContext() // 컨텍스트 깨우기 + 무음 모드 해제 재시도
    console.log(`재생 시작: 위치 ${this.position.toFixed(2)}s, ctx 상태 ${this.ctx.state}`)

    // S 마커보다 앞이거나 E 마커 밖이면 S부터 시작 (재생 범위 재정의)
    const start = this.effectiveStart
    if (this.position < start || (this.trackEnd !== null && this.position >= this.trackEnd)) {
      this.seek(start)
    }

    this.stretchNode.schedule({ active: true })
    this.playing = true
    this.scheduleMetronome(this.position) // 첫 위치 갱신(50ms)을 기다리지 않고 바로 예약 시작

    // 1초 뒤 위치가 안 움직였으면 엔진이 실제로 안 도는 것 → 자동 소생 시도 (iOS 중단 복구)
    const posAtStart = this.position
    setTimeout(() => {
      if (!this.playing) return
      if (this.position !== posAtStart) {
        console.log(`재생 진행 확인: ${posAtStart.toFixed(2)}s → ${this.position.toFixed(2)}s`)
        return
      }

      console.warn(
        `⚠️ 재생 1초 경과에도 위치 정지 (${posAtStart.toFixed(2)}s), ctx 상태 ${this.ctx?.state} → 소생 재시도`,
      )
      // 소생 재시도: 컨텍스트 resume + 재생 상태 재점화
      this.ctx?.resume().then(
        () => console.log(`소생 resume 완료 → ${this.ctx?.state}`),
        (e) => console.warn(`소생 resume 실패: ${e}`),
      )
      this.stretchNode?.schedule({ active: true })

      // 그래도 안 움직이면 좀비 확정 → 파이프라인 전체 재생성 (실기기에서 확인된 케이스)
      setTimeout(() => {
        if (this.playing && this.position === posAtStart) {
          console.error(
            `❌ 소생 실패: 엔진 정지 상태 지속, ctx 상태 ${this.ctx?.state} → 파이프라인 재생성`,
          )
          void this.rebuildPipeline(posAtStart)
        } else if (this.playing) {
          console.log(`소생 성공: ${this.position.toFixed(2)}s부터 재생 재개`)
        }
      }, 1000)
    }, 1000)
  }

  // 스템 분리 결과 등 임시 버퍼 미리듣기 (실험용) — 기존 컨텍스트/볼륨 경로 재사용
  // (새 AudioContext는 제스처 밖에서 재생이 막히지만, 이미 살아있는 컨텍스트는 가능)
  private previewSource: AudioBufferSourceNode | null = null

  playPreview(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
    startSec: number,
    durSec: number,
  ): void {
    if (!this.ctx || !this.gain) return
    this.pause() // 본 재생과 겹치지 않게
    try {
      this.previewSource?.stop()
    } catch {
      // 이미 끝난 소스면 무시
    }
    const startIdx = Math.floor(startSec * sampleRate)
    const len = Math.min(Math.floor(durSec * sampleRate), left.length - startIdx)
    if (len <= 0) return
    const buf = this.ctx.createBuffer(2, len, sampleRate)
    buf.getChannelData(0).set(left.subarray(startIdx, startIdx + len))
    buf.getChannelData(1).set(right.subarray(startIdx, startIdx + len))
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.gain)
    src.start()
    this.previewSource = src
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false // 노드가 없어도(재생성 중) 상태는 확실히 내림 — 재생성 후 오동작 방지
    this.stretchNode?.schedule({ active: false }) // 위치는 노드 내부에 유지됨
    this.cancelClicks() // 음악이 멈추면 예약된 클릭도 안 나가야 함
  }

  // 오디오 파이프라인 전체 재생성 (iOS 좀비 컨텍스트 복구 — running인데 렌더링 스레드가 죽은 상태)
  // 다른 앱(동영상/음악)이 오디오 세션을 뺏은 뒤 복귀하면 resume으로 못 살리는 경우가 있음
  private async rebuildPipeline(resumePos: number): Promise<void> {
    if (this.rebuilding || !this.audioBuffer_) return
    this.rebuilding = true
    console.warn('오디오 파이프라인 재생성 시작 (좀비 컨텍스트 복구)')
    try {
      this.cancelClicks()
      // 옛 컨텍스트 폐기 (닫기 실패는 무시 — 어차피 죽은 컨텍스트)
      const old = this.ctx
      this.ctx = null
      this.gain = null
      this.metroGain = null
      this.stretchNode = null
      this.stretchNodeReady = null
      old?.close().catch(() => {})

      // 새 컨텍스트 + 볼륨 노드 + 스트레치 노드 생성 (설정값은 필드에 남아 있어 그대로 복원됨)
      this.ensureContext()
      const node = await this.getStretchNode()

      // 재생 데이터 재주입 + 멈췄던 위치/템포/피치 복원
      // 스템 곡: 보관 중인 스템에서 현재 게인 그대로 다시 합성 (뮤트 상태까지 복원됨)
      let channels: Float32Array[]
      let transfer: ArrayBuffer[] | undefined
      if (this.stemData) {
        const mixed = await this.buildStemMix(this.stemData, this.stemGains)
        channels = [mixed.left, mixed.right]
        transfer = [mixed.left.buffer as ArrayBuffer, mixed.right.buffer as ArrayBuffer]
      } else {
        channels = []
        for (let c = 0; c < this.audioBuffer_!.numberOfChannels; c++) {
          channels.push(this.audioBuffer_!.getChannelData(c))
        }
      }
      await node.schedule({
        active: false,
        input: resumePos,
        rate: this._tempo,
        semitones: this._pitch,
      })
      await node.addBuffers(channels, transfer)

      // 재생 중이었다면(그 사이 사용자가 일시정지 안 했다면) 이어서 재생
      if (this.playing) {
        node.schedule({ active: true })
      }
      // (TS가 위의 this.ctx = null 대입만 보고 타입을 좁혀버려서 단언으로 풀어줌 — ensureContext()가 재생성함)
      const ctx = this.ctx as AudioContext | null
      console.log(`파이프라인 재생성 완료: 위치 ${resumePos.toFixed(2)}s, ctx 상태 ${ctx?.state}`)
    } catch (err) {
      console.error(`파이프라인 재생성 실패: ${err}`)
    } finally {
      this.rebuilding = false
    }
  }

  // 지정 위치로 이동 (재생 중이면 그 위치에서 계속 흘러나옴)
  seek(pos: number): void {
    if (!this.stretchNode || this.duration_ === 0) return
    const clamped = Math.max(0, Math.min(pos, this.duration_))
    this.stretchNode.schedule({ input: clamped })
    this.cancelClicks() // 위치가 점프하면 예약된 클릭 시각은 전부 무효 (루프 복귀 포함)
  }

  // 구간 루프 목록 교체 (화면의 루프 상태와 동기화)
  setLoops(loops: { start: number; end: number | null }[]): void {
    this.loops = loops
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

  // ── 메트로놈 ──

  // 메트로놈 on/off (그리드가 없으면 켜도 소리 안 남)
  get metronome(): boolean {
    return this.metroOn
  }

  set metronome(on: boolean) {
    this.metroOn = on
    this.cancelClicks() // 끄면 예약분 제거, 켜면 다음 위치 갱신부터 새로 예약
  }

  // BPM 그리드 설정 (분석 결과 또는 ×2/÷2 교정값 — 곡/값 변경 시마다 호출)
  setBpmGrid(bpm: number | null, offset: number | null): void {
    this.metroBpm = bpm
    this.metroOffset = offset ?? 0
    this.cancelClicks() // 그리드가 바뀌면 기존 예약은 전부 무효
  }

  // 예약된 클릭 전부 취소 + 박 인덱스 재계산 예약
  // (시크/루프 점프/템포 변경/그리드 변경 — 기존 예약 시각이 전부 틀어지는 경우)
  private cancelClicks(): void {
    for (const { osc, gain } of this.metroScheduled) {
      try {
        osc.stop()
      } catch {
        // 이미 끝난 클릭이면 무시
      }
      gain.disconnect()
    }
    this.metroScheduled = []
    this.metroNextBeat = null
  }

  // 클릭음 1개 예약 (파일 없이 합성, 메트로놈 볼륨 경유)
  // 1kHz 사인은 부드러워서 음원에 묻힘(실기기 피드백) → 배음 많은 사각파 + 귀가 민감한
  // 2kHz 근처 고음으로 교체 = 믹스를 뚫고 나오는 날카로운 "틱" 소리
  private scheduleClick(at: number): void {
    const ctx = this.ctx
    if (!ctx || !this.metroGain) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square' // 배음이 많아 사인보다 체감 음량이 훨씬 큼
    osc.frequency.value = 1800
    gain.gain.setValueAtTime(1.0, at)
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.025) // 더 짧은 감쇠 = 또렷한 "틱"
    osc.connect(gain)
    gain.connect(this.metroGain)
    osc.start(at)
    osc.stop(at + 0.03)

    const entry = { osc, gain }
    this.metroScheduled.push(entry)
    // 끝난 클릭은 목록에서 제거 (취소 대상은 미래 예약분만 남게)
    osc.onended = () => {
      this.metroScheduled = this.metroScheduled.filter((e) => e !== entry)
    }
  }

  // 다가오는 박들을 미리 예약 (위치 갱신 콜백 50ms 주기마다 호출됨)
  // 원곡 시간 그리드 → 재생 배속 환산 + 엔진 지연 보정으로 실제 클릭 시각 계산
  private scheduleMetronome(pos: number): void {
    if (!this.metroOn || this.metroBpm === null || !this.ctx || !this.playing) return

    const spb = 60 / this.metroBpm // 박 간격 (원곡 기준 초)
    const rate = this._tempo
    const now = this.ctx.currentTime
    // 앞으로 0.25초(실시간) 안에 나올 박까지 예약 — 갱신 주기(50ms)보다 넉넉하게
    const horizon = pos + 0.25 * rate

    // 시크/재시작 직후에는 현재 위치 기준으로 다음 박 인덱스 재계산
    let k =
      this.metroNextBeat ?? Math.ceil((pos - this.metroOffset) / spb - 1e-6)

    while (this.metroOffset + k * spb <= horizon) {
      const beatTime = this.metroOffset + k * spb
      if (beatTime >= pos - 1e-3) {
        // 원곡 시간 차이를 배속으로 나누면 실시간 차이 + 엔진 지연만큼 지연
        this.scheduleClick(now + (beatTime - pos) / rate + this.stretchLatency)
      }
      k++
    }
    this.metroNextBeat = k
  }

  // 루프 끝점 통과 판정 여유 (위치 갱신 주기보다 넉넉하게)
  // 이 범위를 벗어난 위치에서는 루프가 안 걸림 → 휠로 구간 밖 탐색 시 강제로 안 끌려옴
  private static readonly LOOP_MARGIN = 0.35

  // 재생 위치 감시 (StretchNode의 위치 갱신 콜백마다 호출)
  private checkPosition(pos: number): void {
    if (!this.playing) return

    // 메트로놈: 다가오는 박 클릭 예약
    this.scheduleMetronome(pos)

    // 1순위: 구간 루프 — "끝점을 방금 지난" 루프만 시작점으로 복귀
    // (구간 안에서 재생 중일 때만 반복되고, 밖으로 탐색해 나가면 자유)
    let target: number | null = null
    let bestEnd = -Infinity
    for (const loop of this.loops) {
      if (
        loop.end !== null &&
        pos >= loop.end &&
        pos - loop.end <= Player.LOOP_MARGIN &&
        loop.end > bestEnd
      ) {
        bestEnd = loop.end
        target = loop.start
      }
    }
    if (target !== null) {
      this.seek(target)
      return
    }

    // 2순위: 실효 끝 지점(E 마커 또는 곡 자연 끝) 도달 시 S로 복귀(트랙 루프 on) 또는 정지
    const effectiveEnd = this.trackEnd ?? this.duration_
    if (pos >= effectiveEnd) {
      if (this.trackLoop) {
        this.seek(this.effectiveStart)
      } else {
        this.pause()
        this.seek(this.effectiveStart)
        this.onEnded?.()
      }
    }
  }
}
