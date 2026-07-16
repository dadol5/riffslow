// signalsmith-stretch는 타입 정의가 없는 순수 JS(+WASM) 라이브러리라서 직접 선언 (우리가 쓰는 부분만)
// 실제 구현: node_modules/signalsmith-stretch/SignalsmithStretch.mjs
declare module 'signalsmith-stretch' {
  /** schedule()에 넘기는 예약 필드 — 생략한 필드는 직전 상태에서 이어짐 */
  interface StretchScheduleOptions {
    /** 이 변경이 적용될 AudioContext 시각(초). 생략 시 즉시(currentTime) */
    output?: number
    /** 처리 활성 여부 (false면 무음 출력, 곡 데이터는 유지) */
    active?: boolean
    /** 입력(원곡) 버퍼 내 위치(초). 생략 시 직전 재생률로 자연히 이어짐 */
    input?: number
    /** 재생 속도 배율 (1 = 원속도) */
    rate?: number
    /** 피치 시프트 (반음 단위) */
    semitones?: number
    loopStart?: number
    loopEnd?: number
  }

  /** SignalsmithStretch(audioContext)가 반환하는 AudioWorkletNode 확장 객체 */
  export interface StretchNode extends AudioNode {
    /** 입력(원곡) 버퍼 내 현재 재생 위치(초) — setUpdateInterval 주기로 비동기 갱신됨 */
    inputTime: number

    /** 예약 변경 적용 (템포/피치/시크/재생상태 등) */
    schedule(options: StretchScheduleOptions): Promise<StretchScheduleOptions>
    /** inputTime 갱신 주기(초) 설정 + 갱신될 때마다 호출되는 콜백 등록 */
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<void>
    /** 채널별 오디오 샘플(Float32Array)을 재생 버퍼 끝에 추가. 버퍼 끝 시각(초)을 반환
     *  transfer를 주면 소유권 이전(zero-copy) — 대용량(스템 다채널) 복사 방지, 넘긴 배열은 이후 사용 불가 */
    addBuffers(channelBuffers: Float32Array[], transfer?: ArrayBuffer[]): Promise<number>
    /** 재생 버퍼 전체(인자 없음) 또는 지정 시각 이전 구간을 제거 */
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>
    /** 처리/출력 지연시간 합(초) */
    latency(): Promise<number>
    /** 처리 파라미터 재설정 — blockMs가 작을수록 반응 빠름/음질 손해 (내부 상태 리셋됨) */
    configure(options: { blockMs?: number; intervalMs?: number; splitComputation?: boolean }): Promise<void>
  }

  function SignalsmithStretch(
    audioContext: AudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>

  export default SignalsmithStretch
}
