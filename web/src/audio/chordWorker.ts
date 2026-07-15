// 코드/KEY 분석 워커 — essentia.js(WASM) + 자체 후처리 파이프라인 (v5)
//
// 파이프라인 (정확도 개선 설계 — 2026-07-13 사용자 협의):
// ① HPSS-lite: 스펙트로그램 시간축 중앙값 필터로 드럼(순간음) 제거 → 화성 성분만
// ② 프레임별 크로마 2종: 전체 대역(코드 성질용) + 저역 40~262Hz(베이스 루트용)
// ③ 박 단위 구간별 코드 채점: 템플릿 매칭 + 베이스 루트 가산점 + 다이어토닉(KEY) 가산점
// ④ Viterbi 스무딩: 한 박짜리 튀는 오검출을 문맥으로 흡수
//
// ⚠️ essentia.js는 같은 컨텍스트에서 "두 번째 분석 요청"부터 emval 핸들이 깨짐
// (합성 테스트로 확인) → 이 워커는 반드시 요청 1회 처리 후 terminate (chords.ts가 보장)
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'

export interface ChordSegment {
  start: number // 구간 시작 (초)
  end: number // 구간 끝 (초)
  chord: string // 코드명 (샤프 표기: C, Cm, A#, G#m ...)
}

export interface AnalyzeRequest {
  samples: Float32Array // 모노 다운믹스 샘플
  sampleRate: number
  // BPM 그리드 (있으면 코드 경계를 박자에 정렬, 없으면 0.5초 가상 그리드)
  beatGrid?: { bpm: number; offset: number } | null
  debug?: boolean // true면 박별 판정 수치를 콘솔에 출력 (테스트/튜닝용)
}

export interface AnalyzeResponse {
  key?: string // 예: "C minor"
  segments?: ChordSegment[]
  error?: string
}

// ── 분석 파라미터 (16kHz 모노 입력 기준) ──
const FRAME_SIZE = 4096 // 프레임 길이 (256ms — 저음 분해능 확보)
const HOP_SIZE = 2048 // 프레임 간격 (128ms)
const MAX_FREQ = 3500 // 이 위 대역은 무시 (심벌 노이즈 배제)
const BASS_MIN_FREQ = 40 // 저역 크로마 대역 (베이스 루트용)
const BASS_MAX_FREQ = 262
const SILENCE_RMS = 0.002 // 무음 박 판정 (약 -54dB)
// 화성 성분 게이트: 박의 화성(HPSS 후) 에너지가 곡 중앙값의 이 비율 미만이면 코드 없음 처리
// (드럼 카운트인/드럼 브레이크 구간에 억지 코드가 붙는 것 방지 — 실기기 피드백)
// (계측 결과: 드럼 카운트인 박 = 0.05~0.20, 코드 박 ≈ 1.0 — 0.25가 안전한 경계)
const HARMONIC_GATE_RATIO = 0.25
// 매칭 신뢰 게이트: 최고 코사인 점수가 이보다 낮으면 코드 없음 처리
// (드럼 잔여물은 크로마가 평평해서 어느 템플릿과도 ~0.5 수준 — 진짜 코드는 0.7+)
const MIN_CHORD_COS = 0.6
// 시간축 중앙값 창: 9프레임 ≈ 1.15초 — 드럼은 지우면서 코드 경계 번짐(±0.5초)은 최소화
// (15프레임이었을 때 드럼 카운트인 끝 1초에 다음 코드가 새어 들어오는 문제 확인)
const HPSS_MEDIAN_FRAMES = 9
const PSEUDO_BEAT_SEC = 0.5 // BPM 없는 곡의 가상 박 간격

// ── 채점 가중치 (합성 테스트로 1차 튜닝, 실곡 피드백으로 조정 예정) ──
const BASS_ROOT_BONUS = 0.15 // 베이스 음 = 코드 루트
// 판정용 크로마에 저역(베이스) 크로마를 섞는 가중치 — 코드 크로마가 100Hz 미만을
// 버리는 대신(드럼 오인 방지) 베이스의 근음 증거를 여기로 되살림 (HPSS 후라 킥 잔여물 적음)
const BASS_BLEND = 0.6
const BASS_CHORDTONE_BONUS = 0.05 // 베이스 음 = 3음/5음 (전위 화음)
const DIATONIC_BONUS = 0.06 // KEY의 다이어토닉 화음
const SWITCH_PENALTY = 0.12 // Viterbi: 코드가 바뀔 때의 벌점 (클수록 안정/둔감)
const BASS_CONF_RATIO = 1.25 // 베이스 음 신뢰 조건: 1등 크로마가 2등의 몇 배인가

// 음이름 (essentia 표기와 동일한 샤프 기준) — 코드 id = 근음pc*2 + (단조? 1 : 0)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

const GAP = '' // 무음/판정불가 구간 내부 라벨 (최종 결과에서 제외)

// 24개(12근음 × 장/단) 코드 템플릿 — 구성음 3개 이진 벡터를 단위 길이로 정규화
const TEMPLATES: Float32Array[] = []
for (let root = 0; root < 12; root++) {
  for (const intervals of [[0, 4, 7], [0, 3, 7]]) {
    const t = new Float32Array(12)
    for (const iv of intervals) t[(root + iv) % 12] = 1 / Math.sqrt(3)
    TEMPLATES.push(t)
  }
}

function chordName(id: number): string {
  return NOTE_NAMES[Math.floor(id / 2)] + (id % 2 === 1 ? 'm' : '')
}

// KEY의 다이어토닉 3화음 집합 (코드 id) — 단조는 화성단음계의 V(장3화음)도 포함
function diatonicSet(keyRoot: number, minorKey: boolean): Set<number> {
  const set = new Set<number>()
  const add = (deg: number, minorChord: boolean) =>
    set.add(((keyRoot + deg) % 12) * 2 + (minorChord ? 1 : 0))
  if (!minorKey) {
    add(0, false); add(2, true); add(4, true); add(5, false); add(7, false); add(9, true)
  } else {
    add(0, true); add(3, false); add(5, true); add(7, true); add(7, false); add(8, false); add(10, false)
  }
  return set
}

// essentia HPCP는 인덱스 0 = A(기준 주파수 440Hz) — 인덱스 0 = C 기준으로 회전
// (검증: C장3화음이 그대로 쓰면 D#로 판정됨 — +3반음 오프셋)
function rotateHpcpToC(v: Float32Array): Float32Array {
  const out = new Float32Array(12)
  for (let p = 0; p < 12; p++) out[p] = v[(p + 3) % 12]
  return out
}

// 구간 [startSec, endSec)의 RMS — 무음 박 판정용
function rangeRms(samples: Float32Array, startSec: number, endSec: number, sampleRate: number): number {
  const start = Math.max(0, Math.floor(startSec * sampleRate))
  const end = Math.min(samples.length, Math.floor(endSec * sampleRate))
  if (end <= start) return 0
  let sum = 0
  for (let i = start; i < end; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (end - start))
}

// 시간축 중앙값 필터 (bin별) — 드럼 같은 순간음을 지우고 지속음(화성)만 남김
function medianFilterTime(spec: Float32Array[], bins: number, half: number): Float32Array[] {
  const frameCount = spec.length
  const out: Float32Array[] = []
  for (let t = 0; t < frameCount; t++) out.push(new Float32Array(bins))
  const windowBuf: number[] = []
  for (let f = 0; f < bins; f++) {
    for (let t = 0; t < frameCount; t++) {
      const lo = Math.max(0, t - half)
      const hi = Math.min(frameCount - 1, t + half)
      windowBuf.length = 0
      for (let k = lo; k <= hi; k++) windowBuf.push(spec[k][f])
      windowBuf.sort((a, b) => a - b)
      out[t][f] = windowBuf[Math.floor(windowBuf.length / 2)]
    }
  }
  return out
}

// Viterbi: 박별 24코드 점수 배열 → 전환 벌점을 반영한 최적 코드열
function viterbi(emissions: Float32Array[]): number[] {
  const n = emissions.length
  if (n === 0) return []
  const states = 24
  let prev = new Float32Array(emissions[0])
  const backPtr: Int8Array[] = []
  for (let t = 1; t < n; t++) {
    const cur = new Float32Array(states)
    const back = new Int8Array(states)
    // 이전 박에서 가장 점수 높은 상태 (전환 시 벌점 적용 기준)
    let bestPrev = 0
    for (let s = 1; s < states; s++) if (prev[s] > prev[bestPrev]) bestPrev = s
    for (let s = 0; s < states; s++) {
      const stay = prev[s] // 같은 코드 유지 (벌점 없음)
      const move = prev[bestPrev] - SWITCH_PENALTY // 최고 상태에서 전환
      if (stay >= move) {
        cur[s] = stay + emissions[t][s]
        back[s] = -1 // 유지 표시
      } else {
        cur[s] = move + emissions[t][s]
        back[s] = bestPrev as unknown as number
      }
    }
    backPtr.push(back)
    prev = cur
  }
  // 역추적
  let last = 0
  for (let s = 1; s < states; s++) if (prev[s] > prev[last]) last = s
  const path = new Array<number>(n)
  path[n - 1] = last
  for (let t = n - 2; t >= 0; t--) {
    const back = backPtr[t][path[t + 1]]
    path[t] = back === -1 ? path[t + 1] : back
  }
  return path
}

let essentiaInstance: Essentia | null = null

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { samples, sampleRate, beatGrid, debug } = e.data
  try {
    const essentia = (essentiaInstance ??= new Essentia(EssentiaWASM))
    const duration = samples.length / sampleRate

    // ── KEY 추출 (원본 오디오에서) ──
    const audioVec = essentia.arrayToVector(samples)
    const keyRes = essentia.KeyExtractor(
      audioVec, true, FRAME_SIZE, HOP_SIZE, 12, MAX_FREQ, 60, 25,
      0.2, 'bgate', sampleRate, 0.0001, 440, 'cosine', 'hann',
    )
    const key = `${keyRes.key} ${keyRes.scale}`
    const keyRootPc = NOTE_PC[keyRes.key as string] ?? 0
    const diatonic = diatonicSet(keyRootPc, keyRes.scale === 'minor')

    // ── 1차 패스: 프레임별 스펙트럼 수집 (3.5kHz 이하 bin만 — HPSS 비용 절감) ──
    const specSize = FRAME_SIZE / 2 + 1
    const binWidth = sampleRate / FRAME_SIZE
    const usedBins = Math.min(specSize, Math.ceil(MAX_FREQ / binWidth) + 2)
    const frameCount = Math.max(1, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1)
    const frameBuf = new Float32Array(FRAME_SIZE)
    const spectra: Float32Array[] = []
    for (let i = 0; i < frameCount; i++) {
      frameBuf.fill(0)
      const start = i * HOP_SIZE
      frameBuf.set(samples.subarray(start, Math.min(start + FRAME_SIZE, samples.length)))
      const frameVec = essentia.arrayToVector(frameBuf)
      const windowed = essentia.Windowing(frameVec, true, FRAME_SIZE, 'blackmanharris62')
      const spectrum = essentia.Spectrum(windowed.frame, FRAME_SIZE)
      spectra.push(essentia.vectorToArray(spectrum.spectrum).slice(0, usedBins))
    }

    // ── HPSS-lite: 시간축 중앙값 → 화성 성분 스펙트로그램 ──
    const harmonic = medianFilterTime(spectra, usedBins, Math.floor(HPSS_MEDIAN_FRAMES / 2))

    // ── 2차 패스: 정제된 스펙트럼에서 크로마 2종 (전체 대역 + 저역) ──
    const fullSpec = new Float32Array(specSize) // usedBins 위는 0 유지 (bin→주파수 매핑 보존)
    const trebleChroma: Float32Array[] = []
    const bassChroma: Float32Array[] = []
    const frameHarmEnergy = new Float32Array(frameCount) // 프레임별 화성 에너지 (드럼 구간 게이트용)
    for (let i = 0; i < frameCount; i++) {
      let harmSum = 0
      for (let f = 0; f < usedBins; f++) harmSum += harmonic[i][f]
      frameHarmEnergy[i] = harmSum
      fullSpec.fill(0)
      fullSpec.set(harmonic[i])
      const specVec = essentia.arrayToVector(fullSpec)
      const peaks = essentia.SpectralPeaks(specVec, 0.0001, MAX_FREQ, 60, 25, 'magnitude', sampleRate)
      // 코드 성질용 크로마: 100Hz 미만(킥드럼 유사음정 대역) 제외 — 드럼이 코드로 오인되는 것 방지
      // (110으로 했더니 A2=110Hz 근음이 잘려 Am을 놓침 → 100으로 타협)
      const hpcp = essentia.HPCP(
        peaks.frequencies, peaks.magnitudes,
        true, 500, 0, MAX_FREQ, false, 100, false, 'unitMax', 440, sampleRate, 12, 'squaredCosine', 1,
      )
      trebleChroma.push(rotateHpcpToC(essentia.vectorToArray(hpcp.hpcp)))
      const bassHpcp = essentia.HPCP(
        peaks.frequencies, peaks.magnitudes,
        false, 500, 0, BASS_MAX_FREQ, false, BASS_MIN_FREQ, false, 'unitMax', 440, sampleRate, 12, 'squaredCosine', 1,
      )
      bassChroma.push(rotateHpcpToC(essentia.vectorToArray(bassHpcp.hpcp)))
    }

    // ── 박 그리드: BPM 있으면 박자 정렬, 없으면 0.5초 가상 그리드 ──
    const ticks: number[] = []
    if (beatGrid) {
      const spb = 60 / beatGrid.bpm
      const first = beatGrid.offset - Math.floor(beatGrid.offset / spb) * spb
      for (let t = first; t <= duration; t += spb) ticks.push(t)
    } else {
      for (let t = 0; t <= duration; t += PSEUDO_BEAT_SEC) ticks.push(t)
    }
    if (ticks.length < 2) ticks.push(duration)

    // ── 박별 채점: 크로마 집계 → 템플릿 + 베이스 + 다이어토닉 ──
    const beatCount = ticks.length - 1
    const beatSilent: boolean[] = []
    const beatHarm: number[] = [] // 박별 평균 화성 에너지 (드럼 구간 게이트용)
    const beatBestCos: number[] = [] // 박별 최고 매칭 점수 (신뢰 게이트용)
    const beatBassPc: number[] = [] // 박별 베이스 음 (디버그용, -1 = 불확실)
    const emissions: Float32Array[] = []
    const chromaSum = new Float32Array(12)
    const bassSum = new Float32Array(12)
    for (let b = 0; b < beatCount; b++) {
      const startSec = ticks[b]
      const endSec = ticks[b + 1]
      beatSilent.push(rangeRms(samples, startSec, endSec, sampleRate) < SILENCE_RMS)

      // 이 박에 속한 프레임(중심 시각 기준)의 크로마 평균 + 화성 에너지
      chromaSum.fill(0)
      bassSum.fill(0)
      let harmSum = 0
      let count = 0
      const iLo = Math.max(0, Math.ceil((startSec * sampleRate - FRAME_SIZE / 2) / HOP_SIZE))
      for (let i = iLo; i < frameCount; i++) {
        const center = (i * HOP_SIZE + FRAME_SIZE / 2) / sampleRate
        if (center >= endSec) break
        if (center < startSec) continue
        for (let c = 0; c < 12; c++) {
          // 판정용 크로마 = 중고역 + 저역(베이스) 블렌딩 (근음 증거 반영)
          chromaSum[c] += trebleChroma[i][c] + BASS_BLEND * bassChroma[i][c]
          bassSum[c] += bassChroma[i][c]
        }
        harmSum += frameHarmEnergy[i]
        count++
      }
      beatHarm.push(count > 0 ? harmSum / count : 0)
      const scores = new Float32Array(24)
      let bestCos = 0 // 이 박의 최고 매칭 점수 (신뢰 게이트용)
      let beatBass = -1
      if (count > 0) {
        // 단위 벡터로 정규화 후 코사인 유사도
        let norm = 0
        for (let c = 0; c < 12; c++) norm += chromaSum[c] * chromaSum[c]
        norm = Math.sqrt(norm) || 1
        // 베이스 음: 1등이 2등보다 확실히 클 때만 신뢰
        let b1 = 0, b2 = -1
        for (let c = 1; c < 12; c++) {
          if (bassSum[c] > bassSum[b1]) { b2 = b1; b1 = c }
          else if (b2 < 0 || bassSum[c] > bassSum[b2]) b2 = c
        }
        const bassPc = b2 >= 0 && bassSum[b1] > bassSum[b2] * BASS_CONF_RATIO ? b1 : -1
        beatBass = bassPc

        for (let id = 0; id < 24; id++) {
          let cos = 0
          for (let c = 0; c < 12; c++) cos += (chromaSum[c] / norm) * TEMPLATES[id][c]
          if (cos > bestCos) bestCos = cos
          let score = cos
          if (bassPc >= 0) {
            const root = Math.floor(id / 2)
            const third = (root + (id % 2 === 1 ? 3 : 4)) % 12
            const fifth = (root + 7) % 12
            if (bassPc === root) score += BASS_ROOT_BONUS
            else if (bassPc === third || bassPc === fifth) score += BASS_CHORDTONE_BONUS
          }
          if (diatonic.has(id)) score += DIATONIC_BONUS
          scores[id] = score
        }
      }
      beatBestCos.push(bestCos)
      beatBassPc.push(beatBass)
      emissions.push(scores)
    }

    // ── 화성 게이트: 드럼만 나오는 박(카운트인/브레이크)은 코드 없음 처리 ──
    // 기준 = 화성이 있는 박들의 중앙값 대비 비율 (곡마다 절대 레벨이 달라서 상대 기준)
    const harmSorted = beatHarm.filter((_, b) => !beatSilent[b]).sort((a, z) => a - z)
    const harmMedian = harmSorted[Math.floor(harmSorted.length / 2)] ?? 0
    const noChord = (b: number) =>
      beatSilent[b] ||
      beatHarm[b] < harmMedian * HARMONIC_GATE_RATIO ||
      beatBestCos[b] < MIN_CHORD_COS // 크로마가 평평(드럼 잔여물 등) = 어떤 코드와도 안 닮음

    if (debug) {
      // 박별 판정 수치 (임계값 튜닝용 — 테스트에서만 켜짐)
      for (let b = 0; b < beatCount; b++) {
        // 상위 2개 후보 점수도 함께 (베이스/보정이 실제로 순위를 바꾸는지 확인용)
        const ranked = [...emissions[b].keys()].sort((x, y) => emissions[b][y] - emissions[b][x])
        console.log(
          `[박${b}] ${ticks[b].toFixed(2)}s 화성비=${(beatHarm[b] / (harmMedian || 1)).toFixed(2)} 매칭=${beatBestCos[b].toFixed(2)} 베이스=${beatBassPc[b] >= 0 ? NOTE_NAMES[beatBassPc[b]] : '?'} 1위=${chordName(ranked[0])}(${emissions[b][ranked[0]].toFixed(2)}) 2위=${chordName(ranked[1])}(${emissions[b][ranked[1]].toFixed(2)}) → ${noChord(b) ? 'GAP' : '코드'}`,
        )
      }
    }

    // ── Viterbi 스무딩 (코드 없는 박으로 끊긴 연속 구간별로) ──
    const labels: string[] = new Array(beatCount).fill(GAP)
    let runStart = -1
    for (let b = 0; b <= beatCount; b++) {
      const inRun = b < beatCount && !noChord(b)
      if (inRun && runStart < 0) runStart = b
      if (!inRun && runStart >= 0) {
        const path = viterbi(emissions.slice(runStart, b))
        for (let k = 0; k < path.length; k++) labels[runStart + k] = chordName(path[k])
        runStart = -1
      }
    }

    // ── 마디(4박) 스냅: 코드가 마디 단위로 바뀌도록 정리 (사용자 "마디가 안 맞음" 피드백) ──
    // 1) 다운비트 위상 추정 = 코드 변경점이 가장 많이 걸리는 4박 위상
    if (beatGrid) {
      const changeCount = [0, 0, 0, 0]
      for (let b = 1; b < beatCount; b++) {
        if (labels[b] !== labels[b - 1] && labels[b] !== GAP && labels[b - 1] !== GAP) {
          changeCount[b % 4]++
        }
      }
      let phase = 0
      for (let p = 1; p < 4; p++) if (changeCount[p] > changeCount[phase]) phase = p

      // 2) 각 마디에서 지배 코드로 통일 — 딱 2+2로 갈리면 반마디 변경으로 인정
      for (let barStart = phase - 4; barStart < beatCount; barStart += 4) {
        const idx: number[] = []
        for (let k = 0; k < 4; k++) {
          if (barStart + k >= 0 && barStart + k < beatCount) idx.push(barStart + k)
        }
        if (idx.length < 3) continue // 꼬리 반마디는 그대로 둠
        const labs = idx.map((i) => labels[i])
        if (
          idx.length === 4 &&
          labs[0] === labs[1] &&
          labs[2] === labs[3] &&
          labs[0] !== labs[2]
        ) {
          continue // 앞 2박/뒤 2박 반마디 분할은 실제 진행일 가능성이 높아 유지
        }
        // 최다 라벨(GAP 포함)로 마디 전체 통일 (동률이면 마디 첫 박 라벨 우선)
        const counts = new Map<string, number>()
        for (const l of labs) counts.set(l, (counts.get(l) ?? 0) + 1)
        let winner = labs[0]
        let best = 0
        for (const [l, n] of counts) {
          if (n > best || (n === best && l === labs[0])) {
            best = n
            winner = l
          }
        }
        for (const i of idx) labels[i] = winner
      }
    }

    const segments: ChordSegment[] = []
    for (let b = 0; b < beatCount; b++) {
      if (labels[b] === GAP) continue
      const prev = segments[segments.length - 1]
      if (prev && prev.chord === labels[b] && Math.abs(prev.end - ticks[b]) < 1e-6) {
        prev.end = ticks[b + 1]
      } else {
        segments.push({ start: ticks[b], end: ticks[b + 1], chord: labels[b] })
      }
    }

    const response: AnalyzeResponse = { key, segments }
    self.postMessage(response)
  } catch (err) {
    // 스택까지 실어 보냄 — 워커 안 에러는 밖에서 위치를 알 수 없기 때문
    const response: AnalyzeResponse = {
      error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    }
    self.postMessage(response)
  }
}
