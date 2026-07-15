// 스템 분리 (실험 스파이크) — demucs-web (MIT, htdemucs ONNX ~172MB)
//
// ⚠️ 사용자 방침: 자동 실행 금지 — 반드시 버튼(온디맨드)으로만 호출할 것
//
// 처리 흐름: 44.1kHz 스테레오 리샘플(모델 요구사항) → ONNX Runtime Web(WebGPU 우선,
// WASM 폴백)으로 drums/bass/other/vocals 4개 스템 분리
// 모델은 최초 1회만 다운로드하고 Cache API에 보관 (오프라인/재실행 시 재사용)
import type { SeparationResult } from 'demucs-web'

export type { SeparationResult }

const MODEL_URL =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx'
const MODEL_CACHE = 'riffslow-models'
const DEMUCS_SAMPLE_RATE = 44100 // htdemucs 모델 고정 요구사항

// onnxruntime-web의 WASM 어셋(~25MB)은 CDN에서 받음 — 앱 번들/서비스워커 캐시 비대화 방지
// ⚠️ package.json의 onnxruntime-web 버전과 반드시 일치시킬 것
const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'

// 모델 다운로드 (Cache API 캐시 우선, 미스 시 다운로드 후 저장)
// ⚠️ 메모리 절약이 최우선 (아이폰 OOM 방지): 다운로드 스트림을 JS 힙에 쌓지 않고
// 바로 디스크(Cache API)로 흘린 뒤, 힙에는 ArrayBuffer 1벌만 올린다
async function fetchModelWithCache(onLog: (msg: string) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE)
  let res = await cache.match(MODEL_URL)
  if (res) {
    onLog('모델 캐시 적중 — 다운로드 생략')
  } else {
    onLog('모델 다운로드 중 (~172MB, 최초 1회만 — WiFi 권장, 진행률 표시 없음)')
    const netRes = await fetch(MODEL_URL)
    if (!netRes.ok) {
      throw new Error(`모델 다운로드 실패: HTTP ${netRes.status}`)
    }
    try {
      // 스트림을 그대로 디스크 캐시에 기록 (힙 경유 없음)
      await cache.put(MODEL_URL, netRes.clone())
      netRes.body?.cancel() // 원본 스트림은 사용 안 함
      res = await cache.match(MODEL_URL)
      onLog('다운로드 완료 — 캐시 저장됨 (다음부턴 생략)')
    } catch {
      onLog('캐시 저장 실패 (용량 부족?) — 메모리로 직접 로드')
    }
    if (!res) {
      // 캐시 실패 폴백: 어쩔 수 없이 메모리로 (스트림이 이미 소비됐으면 재요청)
      const retry = await fetch(MODEL_URL)
      if (!retry.ok) throw new Error(`모델 다운로드 실패: HTTP ${retry.status}`)
      return retry.arrayBuffer()
    }
  }
  return res.arrayBuffer()
}

// 스템 분리 실행: 곡 앞부분 maxSeconds 만큼만 처리 (스파이크 = 타당성 측정이 목적)
export async function separateStems(
  buffer: AudioBuffer,
  maxSeconds: number,
  onLog: (msg: string) => void,
): Promise<{ stems: SeparationResult; seconds: number; sampleRate: number }> {
  const seconds = Math.min(maxSeconds, buffer.duration)

  onLog(`44.1kHz 스테레오 변환 중 (${seconds.toFixed(0)}초 분량)...`)
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * DEMUCS_SAMPLE_RATE), DEMUCS_SAMPLE_RATE)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0)
  const rendered = await ctx.startRendering()

  // 무거운 모듈은 버튼을 눌렀을 때만 로드 (앱 시작 성능 보호)
  const ort = await import('onnxruntime-web')
  ort.env.wasm.wasmPaths = ORT_WASM_CDN
  // 멀티스레드는 crossOriginIsolated(COOP/COEP 헤더)가 전제 — 그 헤더가 iOS Safari를
  // 반복 크래시시켜서 제거했으므로(vite.config 참고), 격리 안 된 환경에선 단일 스레드.
  // 대신 WebGPU가 되는 기기(iOS 18+/데스크톱)에선 GPU가 대부분을 처리해 속도 확보
  ort.env.wasm.numThreads = crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1
  onLog(
    `백엔드: WebGPU ${'gpu' in navigator ? '가능' : '불가'} / WASM 스레드 ${ort.env.wasm.numThreads}개`,
  )
  const { DemucsProcessor } = await import('demucs-web')

  const processor = new DemucsProcessor({
    ort,
    onProgress: ({ progress, currentSegment, totalSegments }) =>
      onLog(`분리 진행 ${(progress * 100).toFixed(0)}% (구간 ${currentSegment}/${totalSegments})`),
    onLog: (phase, message) => console.log(`[demucs:${phase}] ${message}`),
  })

  // 모델 버퍼는 세션 생성 직후 참조를 끊어 GC 대상으로 (힙 172MB 조기 반환)
  let modelBuf: ArrayBuffer | null = await fetchModelWithCache(onLog)
  onLog('모델 초기화 중... (WebGPU 시도 → 실패 시 WASM 폴백)')
  await processor.loadModel(modelBuf)
  modelBuf = null
  void modelBuf // 참조 해제가 목적 (린트 억제)

  onLog('분리 시작 — 시간이 좀 걸립니다 (화면 꺼지지 않게 유지)')
  const stems = await processor.separate(rendered.getChannelData(0), rendered.getChannelData(1))

  return { stems, seconds, sampleRate: DEMUCS_SAMPLE_RATE }
}
