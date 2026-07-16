// 코드(화음)/KEY 자동 분석 진입점 — essentia.js (AGPL, WASM)
//
// 정확도 기대치(사용자 합의): 깔끔한 믹스는 준수, 디스토션/복잡한 밴드 믹스는 참고용 수준.
// 세븐스/텐션은 단순 트라이어드로 나옴 (Cm7 → Cm)
//
// 처리 흐름: 모노+16kHz 다운샘플(메모리/시간 절약) → 워커에서 WASM 분석 → 구간 목록 반환
// 워커는 분석 1회용으로 만들고 종료 (WASM 힙 정리를 terminate에 맡김)
import type { AnalyzeResponse, ChordSegment } from './chordWorker'

export type { ChordSegment }

export interface ChordAnalysis {
  key: string // 예: "C minor"
  segments: ChordSegment[]
}

// 분석용 샘플레이트 — 코드 성분(3.5kHz 이하)에는 16kHz면 충분
const ANALYZE_SAMPLE_RATE = 16000

// beatGrid(BPM+첫 박)가 있으면 코드 경계를 박자에 정렬 — 마디 지점에서 바뀌는 자연스러운 결과
export async function analyzeChords(
  buffer: AudioBuffer,
  beatGrid?: { bpm: number; offset: number } | null,
): Promise<ChordAnalysis | null> {
  // 모노 + 16kHz 다운샘플 렌더링
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * ANALYZE_SAMPLE_RATE),
    ANALYZE_SAMPLE_RATE,
  )
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0)
  const rendered = await ctx.startRendering()

  // getChannelData의 버퍼는 소유권 이전(transfer)이 안 될 수 있어 사본을 만들어 넘김
  const samples = new Float32Array(rendered.getChannelData(0))

  return new Promise((resolve) => {
    const worker = new Worker(new URL('./chordWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
      worker.terminate()
      // 박별 판정 로그 (debug 요청 시) — 워커 콘솔은 환경에 따라 안 보여서 여기서 출력
      e.data.debugLines?.forEach((line) => console.log(line))
      if (e.data.error) {
        console.warn(`코드 분석 실패: ${e.data.error}`)
        resolve(null)
        return
      }
      resolve({ key: e.data.key!, segments: e.data.segments! })
    }
    worker.onerror = (e) => {
      worker.terminate()
      console.warn(`코드 분석 워커 에러: ${e.message}`)
      resolve(null)
    }
    worker.postMessage(
      {
        samples,
        sampleRate: ANALYZE_SAMPLE_RATE,
        beatGrid: beatGrid ?? null,
        // 박별 판정 수치 로그 (튜닝용) — 콘솔에서 localStorage.setItem('riffslow-chords-debug','1') 후 재분석
        debug: localStorage.getItem('riffslow-chords-debug') === '1',
      },
      [samples.buffer],
    )
  })
}
