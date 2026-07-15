// demucs-web 패키지 타입 선언 (패키지가 d.ts를 제공하지 않음 — README/소스 기준 최소 선언)
declare module 'demucs-web' {
  export interface StemChannels {
    left: Float32Array
    right: Float32Array
  }

  export interface SeparationResult {
    drums: StemChannels
    bass: StemChannels
    other: StemChannels
    vocals: StemChannels
  }

  export interface DemucsProgressInfo {
    progress: number // 0~1
    currentSegment: number
    totalSegments: number
  }

  export class DemucsProcessor {
    constructor(options: {
      ort: unknown // onnxruntime-web 모듈
      modelPath?: string
      sessionOptions?: unknown
      onProgress?: (info: DemucsProgressInfo) => void
      onLog?: (phase: string, message: string) => void
      onDownloadProgress?: (loaded: number, total: number) => void
    })
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>
  }

  export const CONSTANTS: { DEFAULT_MODEL_URL: string }
}
