// 스템 분리 (실험 스파이크) — demucs-web (MIT, htdemucs ONNX ~172MB)
//
// ⚠️ 사용자 방침: 자동 실행 금지 — 반드시 버튼(온디맨드)으로만 호출할 것
//
// 처리 흐름: 44.1kHz 스테레오 리샘플(모델 요구사항) → ONNX Runtime Web(WebGPU 우선,
// WASM 폴백)으로 drums/bass/other/vocals 4개 스템 분리
// 모델은 최초 1회만 다운로드하고 Cache API에 보관 (오프라인/재실행 시 재사용)
import type { SeparationResult } from 'demucs-web'

export type { SeparationResult }

// 스템 표준 표시 순서 (믹서에서 이 순서로 정렬 — 목록에 없는 이름은 뒤로)
export const STEM_ORDER: readonly string[] = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
]

// 파일명에서 스템 이름 추측 (UVR/Demucs 등의 관례적 이름 대응) — 못 알아보면 null
export function guessStemName(fileName: string): string | null {
  const n = fileName.toLowerCase()
  if (/vocal|voice|보컬/.test(n)) return 'vocals'
  if (/drum|드럼/.test(n)) return 'drums'
  if (/bass|베이스/.test(n)) return 'bass'
  if (/guitar|gtr/.test(n)) return 'guitar'
  if (/piano|keys|피아노|건반/.test(n)) return 'piano'
  // UVR 2스템 분리의 반주 쪽은 "(Instrumental)"로 나옴
  if (/other|instrumental|inst\b|accomp|반주/.test(n)) return 'other'
  return null
}

// 스템 파일명들의 공통 앞부분에서 곡 제목 추출
// (예: "1_곡명_(Vocals).wav" + "1_곡명_(Drums).wav" → "1_곡명")
export function stemSetTitle(fileNames: string[]): string {
  const bases = fileNames.map((n) => n.replace(/\.[^.]+$/, ''))
  let p = bases[0] ?? ''
  for (const b of bases.slice(1)) {
    let i = 0
    while (i < p.length && i < b.length && p[i] === b[i]) i++
    p = p.slice(0, i)
  }
  p = p.replace(/[\s._\-()[\]]+$/, '') // 꼬리에 남은 구분자 제거
  return p || bases[0] || '스템 곡'
}

// 스템 여러 개를 디코딩해 합산(합치면 원곡과 거의 동일) 후 WAV로 인코딩
// 폰 메모리 보호: 하나씩 순차 디코딩해 누적하고 바로 버림 (동시 상주 = 누적분 + 스템 1개)
export async function mixStemsToWav(
  blobs: Blob[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; duration: number }> {
  const SR = 44100
  let left: Float32Array | null = null
  let right: Float32Array | null = null
  for (let i = 0; i < blobs.length; i++) {
    const data = await blobs[i].arrayBuffer()
    // OfflineAudioContext로 디코딩 — 44.1kHz로 자동 리샘플되고 실시간 컨텍스트를 소모하지 않음
    const ctx = new OfflineAudioContext(2, 1, SR)
    const buf = await ctx.decodeAudioData(data)
    const l = buf.getChannelData(0)
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l
    if (!left || !right) {
      left = new Float32Array(buf.length)
      right = new Float32Array(buf.length)
    } else if (buf.length > left.length) {
      // 더 긴 스템이 나오면 누적 버퍼 확장
      const nl = new Float32Array(buf.length)
      nl.set(left)
      left = nl
      const nr = new Float32Array(buf.length)
      nr.set(right)
      right = nr
    }
    for (let k = 0; k < l.length; k++) {
      left[k] += l[k]
      right[k] += r[k]
    }
    onProgress?.(i + 1, blobs.length)
  }
  if (!left || !right) throw new Error('스템 파일이 없어요')
  // 합산이 ±1을 넘으면 전체를 비율로 줄여 클리핑(찌그러짐) 방지
  let peak = 0
  for (let k = 0; k < left.length; k++) {
    const a = Math.abs(left[k])
    if (a > peak) peak = a
    const b = Math.abs(right[k])
    if (b > peak) peak = b
  }
  if (peak > 1) {
    const g = 1 / peak
    for (let k = 0; k < left.length; k++) {
      left[k] *= g
      right[k] *= g
    }
  }
  return { blob: encodeWavStereo(left, right, SR), duration: left.length / SR }
}

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

// 스템(Float32 좌우 채널)을 표준 WAV(16bit PCM 스테레오)로 인코딩 — PC 저장/타 앱 호환용
export function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Blob {
  const frames = left.length
  const dataSize = frames * 2 * 2 // 2채널 × 16bit
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  // RIFF/WAVE 헤더 (44바이트 표준 PCM 헤더)
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 청크 크기
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // 스테레오
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true) // 초당 바이트 (2ch × 2byte)
  view.setUint16(32, 4, true) // 프레임당 바이트
  view.setUint16(34, 16, true) // 비트 수
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  // 샘플 기록 — 분리 결과가 ±1을 살짝 넘을 수 있어 클리핑 후 16bit 정수화
  let off = 44
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    off += 2
    view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    off += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// 스템 분리 실행: 곡 앞부분 maxSeconds 만큼만 처리 (전체 곡 = buffer.duration 전달)
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
