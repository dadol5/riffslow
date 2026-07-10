// soundtouchjs는 타입 정의가 없는 순수 JS 라이브러리라서 직접 선언 (우리가 쓰는 부분만)
// 실제 구현: node_modules/soundtouchjs/dist/soundtouch.js
declare module 'soundtouchjs' {
  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize: number,
      onEnd?: () => void, // 곡 데이터를 끝까지 소모하면 호출됨
    )

    /** 템포 배율 (0.2~2.5 = 20%~250%). 쓰기 전용 — 읽으면 undefined */
    tempo: number
    /** 피치 배율 (쓰기 전용) */
    pitch: number
    /** 피치 반음 단위 (쓰기 전용, ±12) */
    pitchSemitones: number

    /** 원곡 기준 재생 위치(초) — 재생 중 오디오 콜백마다 자동 갱신 */
    timePlayed: number
    /** 원곡 기준 재생 위치(프레임) */
    sourcePosition: number
    /** ⚠️ 비대칭 API: 읽을 땐 0~100(%), 쓸 땐 0~1(비율) */
    percentagePlayed: number

    readonly node: AudioNode
    duration: number

    connect(toNode: AudioNode): void
    disconnect(): void
    on(eventName: string, cb: (detail: unknown) => void): void
    off(eventName?: string): void
  }
}
