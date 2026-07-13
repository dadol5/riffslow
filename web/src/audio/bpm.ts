// BPM 자동 분석 — web-audio-beat-detector (MIT)
//
// 원리: 저역(킥드럼 대역, 240Hz 이하)만 남긴 뒤 피크 간격을 통계 내서 템포를 추정
// - bpm: 추정 템포 (라이브러리가 90~180 범위로 정규화 — 느린 곡은 2배로 나올 수 있음)
// - offset: 첫 박이 떨어지는 시각 (원곡 기준 초) — 메트로놈 그리드의 기준점
//
// ⚠️ 라이브러리 내부 게이트: 저역 필터 후 최대 진폭이 0.25 이하면 탐색 없이 즉시 실패함.
// 동영상 추출 오디오(폰 카메라 = 저음 빈약, 낮은 녹음 음량)가 여기 걸리는 경우가 많아
// 실패 시 저역 실측 진폭 기준으로 증폭한 사본을 만들어 한 번 더 시도한다.
import { guess } from 'web-audio-beat-detector'

export interface BpmResult {
  bpm: number // 추정 BPM (정수)
  offset: number // 첫 박 위치 (원곡 기준 초)
}

// 라이브러리와 동일한 전처리 조건 (게이트 통과 여부를 우리가 미리 재현하기 위함)
const LOWPASS_HZ = 240
const AMPLITUDE_GATE = 0.25

// 저역 필터 통과 후 최대 진폭 측정 (라이브러리가 보는 것과 같은 신호 기준)
async function measureLowBandPeak(buffer: AudioBuffer): Promise<number> {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = LOWPASS_HZ
  source.buffer = buffer
  source.connect(lowpass).connect(ctx.destination)
  source.start(0)
  const rendered = await ctx.startRendering()
  const data = rendered.getChannelData(0)
  let max = 0
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i])
    if (abs > max) max = abs
  }
  return max
}

// 채널 0을 증폭한 모노 사본 생성 (라이브러리도 채널 0만 분석하므로 모노면 충분 — 메모리 절약)
function buildBoostedMono(buffer: AudioBuffer, gain: number): AudioBuffer {
  const mono = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: 1,
    sampleRate: buffer.sampleRate,
  })
  const src = buffer.getChannelData(0)
  const dst = mono.getChannelData(0)
  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i] * gain // float 버퍼라 1.0 초과해도 클리핑 없음 (분석용이라 무관)
  }
  return mono
}

// 곡 전체를 분석 (수 분짜리 곡도 오프라인 렌더링이라 수 초 안에 끝남)
// 실패(비트 불명확) 시 null 반환 — 호출부는 "분석 실패"로 저장해 재시도하지 않음
export async function analyzeBpm(buffer: AudioBuffer): Promise<BpmResult | null> {
  try {
    const { bpm, offset } = await guess(buffer)
    console.log(`BPM 분석 완료: ${bpm} BPM, 첫 박 ${offset.toFixed(3)}s`)
    return { bpm, offset }
  } catch (err) {
    console.warn(`BPM 1차 분석 실패: ${err}`)
  }

  // ── 폴백: 저역 진폭이 게이트(0.25)에 못 미쳐 실패한 경우 증폭 후 재시도 ──
  try {
    const lowPeak = await measureLowBandPeak(buffer)
    if (lowPeak >= AMPLITUDE_GATE) {
      // 게이트는 통과했는데 실패한 것 → 진폭 문제가 아님 (비트 자체가 불명확) → 증폭 무의미
      console.warn(`BPM 분석 실패 확정: 저역 진폭 ${lowPeak.toFixed(3)}은 충분 — 비트가 뚜렷하지 않은 곡`)
      return null
    }
    if (lowPeak < 1e-4) {
      console.warn('BPM 분석 실패 확정: 저역 성분이 사실상 없음')
      return null
    }

    const gain = 0.9 / lowPeak // 필터 후 최대 진폭이 0.9가 되도록 증폭
    console.log(`저역 진폭 ${lowPeak.toFixed(3)} < 게이트 ${AMPLITUDE_GATE} → ${gain.toFixed(1)}배 증폭 후 재분석`)
    const { bpm, offset } = await guess(buildBoostedMono(buffer, gain))
    console.log(`BPM 분석 완료 (증폭 재시도): ${bpm} BPM, 첫 박 ${offset.toFixed(3)}s`)
    return { bpm, offset }
  } catch (err) {
    console.warn(`BPM 분석 실패 확정 (증폭 재시도도 실패): ${err}`)
    return null
  }
}
