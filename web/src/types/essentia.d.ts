// essentia.js 딥 임포트 경로용 타입 선언 (패키지가 ES 빌드에 d.ts를 제공하지 않음)
// 알고리즘 시그니처는 dist/core_api.d.ts 참고 — 여기선 워커에서 쓰는 만큼만 느슨하게 선언

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  // Emscripten 모듈 (WASM 바이너리 임베드 — 파일 하나로 동작)
  export const EssentiaWASM: unknown
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  // 알고리즘이 200개+ 라 인덱스 시그니처로 통칭 (사용처에서 반환값 형태 주석으로 보완)
  export default class Essentia {
    constructor(wasm: unknown, isDebug?: boolean)
    module: {
      VectorVectorFloat: new () => {
        push_back(v: unknown): void
        size(): number
        delete(): void
      }
    }
    arrayToVector(arr: Float32Array): unknown
    vectorToArray(vec: unknown): Float32Array
    FrameGenerator(audio: Float32Array, frameSize?: number, hopSize?: number): {
      size(): number
      get(i: number): unknown
      delete(): void
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [algorithm: string]: any
  }
}
