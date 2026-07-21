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
import type { Shape } from '../utils/voicings'

export interface ChordSegment {
  start: number // 구간 시작 (초)
  end: number // 구간 끝 (초)
  chord: string // 코드명 (플랫 표기: C, Cm, Bb, Abm ... — v10부터, 이전 저장분은 샤프일 수 있음)
  // 이 구간만 따로 지정한 운지 (코드표 레이어에서 "구간만 적용" — 분석기는 안 채움, 재분석하면 사라짐)
  shape?: Shape
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
  // debug 요청 시 박별 판정 수치 (워커 콘솔은 환경에 따라 안 보여서 메인 스레드에서 출력)
  debugLines?: string[]
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

// 음이름 (플랫 표기 — 사용자 선호: A# 대신 Bb) — 코드 id = 근음pc*2 + (단조? 1 : 0)
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

const GAP = '' // 무음/판정불가 구간 내부 라벨 (최종 결과에서 제외)

// 코드 템플릿 — 구성음 이진 벡터를 단위 길이로 정규화
// id 0~23: 12근음 × 장/단 3화음, id 24~35: 도미넌트 7th (X7)
// (7th를 사전에 안 두면 A7 구간이 3화음 어디에도 안 맞아 Em 등으로 미끄러짐 — 실곡 피드백)
// id 36~47: 마이너 7th (Xm7) — 7th 표기 재판정 전용, Viterbi 상태에선 제외
// (Am7=C6처럼 나란한 장3화음과 구성음이 겹쳐 디코딩에 넣으면 오검출 위험)
const TEMPLATES: Float32Array[] = []
for (let root = 0; root < 12; root++) {
  for (const intervals of [[0, 4, 7], [0, 3, 7]]) {
    const t = new Float32Array(12)
    for (const iv of intervals) t[(root + iv) % 12] = 1 / Math.sqrt(3)
    TEMPLATES.push(t)
  }
}
for (let root = 0; root < 12; root++) {
  const t = new Float32Array(12)
  for (const iv of [0, 4, 7, 10]) t[(root + iv) % 12] = 0.5 // 4음 = 1/√4
  TEMPLATES.push(t)
}
for (let root = 0; root < 12; root++) {
  const t = new Float32Array(12)
  for (const iv of [0, 3, 7, 10]) t[(root + iv) % 12] = 0.5
  TEMPLATES.push(t)
}
const VITERBI_STATES = 36 // 디코딩은 3화음+X7까지만 (m7은 표기 재판정 전용)
// 7th는 명확한 증거(7th음)가 있을 때만 이기도록 약한 벌점 (3화음 곡의 과잉 검출 방지)
const SEVENTH_PENALTY = 0.02

function chordName(id: number): string {
  if (id >= 36) return NOTE_NAMES[id - 36] + 'm7'
  if (id >= 24) return NOTE_NAMES[id - 24] + '7'
  return NOTE_NAMES[Math.floor(id / 2)] + (id % 2 === 1 ? 'm' : '')
}

// 코드 id의 근음 pc
function rootOf(id: number): number {
  if (id >= 36) return id - 36
  return id >= 24 ? id - 24 : Math.floor(id / 2)
}

// 단3화음 계열인가 (3음이 단3도)
function isMinorOf(id: number): boolean {
  return id >= 36 || (id < 24 && id % 2 === 1)
}

// 키/다이어토닉 판정용 3화음 등가 id (A7 → A 장3화음, Dm7 → Dm 단3화음)
function triadIdOf(id: number): number {
  if (id >= 36) return (id - 36) * 2 + 1
  return id >= 24 ? (id - 24) * 2 : id
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

// Viterbi: 박별 코드 점수 배열 → 전환 벌점을 반영한 최적 코드열
function viterbi(emissions: Float32Array[]): number[] {
  const n = emissions.length
  if (n === 0) return []
  const states = emissions[0].length
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

    // ── KEY 1차 추출 (원본 오디오에서) — 최종 키는 코드 진행 적합도로 재판정함 (v8) ──
    // (KeyExtractor는 이웃 조(F↔Bb처럼 구성음 6/7 공유)를 자주 혼동 — 사용자 실곡 피드백)
    const audioVec = essentia.arrayToVector(samples)
    const keyRes = essentia.KeyExtractor(
      audioVec, true, FRAME_SIZE, HOP_SIZE, 12, MAX_FREQ, 60, 25,
      0.2, 'bgate', sampleRate, 0.0001, 440, 'cosine', 'hann',
    )
    const keyRootPc = NOTE_PC[keyRes.key as string] ?? 0
    const keyMinor0 = keyRes.scale === 'minor'

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
    // 다이어토닉 가산점을 뺀 기본 점수 — 키 재판정(v8) 시 다른 키의 가산점으로 재디코딩하기 위함
    const baseEmissions: Float32Array[] = []
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
      const scores = new Float32Array(TEMPLATES.length)
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

        for (let id = 0; id < TEMPLATES.length; id++) {
          let cos = 0
          for (let c = 0; c < 12; c++) cos += (chromaSum[c] / norm) * TEMPLATES[id][c]
          if (cos > bestCos) bestCos = cos
          let score = id >= 24 ? cos - SEVENTH_PENALTY : cos
          if (bassPc >= 0) {
            const root = rootOf(id)
            const third = (root + (isMinorOf(id) ? 3 : 4)) % 12
            const fifth = (root + 7) % 12
            const seventh = id >= 24 ? (root + 10) % 12 : -1
            if (bassPc === root) score += BASS_ROOT_BONUS
            else if (bassPc === third || bassPc === fifth || bassPc === seventh) {
              score += BASS_CHORDTONE_BONUS
            }
          }
          scores[id] = score // 다이어토닉 가산점은 decode()에서 키별로 적용
        }
      }
      beatBestCos.push(bestCos)
      beatBassPc.push(beatBass)
      baseEmissions.push(scores)
    }

    // ── 화성 게이트: 드럼만 나오는 박(카운트인/브레이크)은 코드 없음 처리 ──
    // 기준 = 화성이 있는 박들의 중앙값 대비 비율 (곡마다 절대 레벨이 달라서 상대 기준)
    const harmSorted = beatHarm.filter((_, b) => !beatSilent[b]).sort((a, z) => a - z)
    const harmMedian = harmSorted[Math.floor(harmSorted.length / 2)] ?? 0
    const noChord = (b: number) =>
      beatSilent[b] ||
      beatHarm[b] < harmMedian * HARMONIC_GATE_RATIO ||
      beatBestCos[b] < MIN_CHORD_COS // 크로마가 평평(드럼 잔여물 등) = 어떤 코드와도 안 닮음

    const debugLines: string[] = []
    if (debug) {
      // 박별 판정 수치 (임계값 튜닝용) — 다이어토닉 가산점 제외 기준, 상위 3개 후보
      for (let b = 0; b < beatCount; b++) {
        const ranked = [...baseEmissions[b].keys()].sort(
          (x, y) => baseEmissions[b][y] - baseEmissions[b][x],
        )
        debugLines.push(
          `[박${b}] ${ticks[b].toFixed(2)}s 화성비=${(beatHarm[b] / (harmMedian || 1)).toFixed(2)} 매칭=${beatBestCos[b].toFixed(2)} 베이스=${beatBassPc[b] >= 0 ? NOTE_NAMES[beatBassPc[b]] : '?'} 1위=${chordName(ranked[0])}(${baseEmissions[b][ranked[0]].toFixed(3)}) 2위=${chordName(ranked[1])}(${baseEmissions[b][ranked[1]].toFixed(3)}) 3위=${chordName(ranked[2])}(${baseEmissions[b][ranked[2]].toFixed(3)}) → ${noChord(b) ? 'GAP' : '코드'}`,
        )
      }
    }

    // ── 디코딩: 주어진 키의 다이어토닉 가산점으로 Viterbi + 마디 스냅 (키 재판정 시 재실행) ──
    const decode = (diatonic: Set<number>): string[] => {
      const emissions = baseEmissions.map((base) => {
        const s = new Float32Array(TEMPLATES.length)
        for (let id = 0; id < TEMPLATES.length; id++) {
          // 다이어토닉 가산점 — 7th는 3화음 등가로 판정 (A7 = A장3화음 취급, V7도 가산)
          // 단, 같은 근음의 반대 성질(A↔Am)보다 기본 점수가 낮으면 가산 안 함:
          // 장/단은 3음의 뚜렷한 음향 차이라 키 프라이어가 뒤집으면 안 됨 (A7→Am 오검출 원인)
          const qualityOk = id >= 24 || base[id] + 1e-9 >= base[id ^ 1]
          s[id] = base[id] + (qualityOk && diatonic.has(triadIdOf(id)) ? DIATONIC_BONUS : 0)
        }
        return s
      })

      // Viterbi 스무딩 (코드 없는 박으로 끊긴 연속 구간별로)
      const labels: string[] = new Array(beatCount).fill(GAP)
      let runStart = -1
      for (let b = 0; b <= beatCount; b++) {
        const inRun = b < beatCount && !noChord(b)
        if (inRun && runStart < 0) runStart = b
        if (!inRun && runStart >= 0) {
          // m7 템플릿(id 36~)은 상태에서 제외 — 표기 재판정 전용
          const path = viterbi(emissions.slice(runStart, b).map((e) => e.subarray(0, VITERBI_STATES)))
          for (let k = 0; k < path.length; k++) labels[runStart + k] = chordName(path[k])
          runStart = -1
        }
      }

      // 마디(4박) 스냅: 코드가 마디 단위로 바뀌도록 정리 (사용자 "마디가 안 맞음" 피드백)
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
          // (v13) 통일 전에 각 반마디 다운비트(1박/3박) 라벨로 나눈 분할과 방출 점수 비교 —
          // 한 박만 튄 [Bb,Dm,A,A] 같은 마디는 다수결(A 통짜)보다 [Bb,Bb,A,A] 분할이 실제 진행
          // (실곡 금붕어 18마디에서 Bb 반마디가 A에 먹히던 문제). 여유 0.05는 통짜 우선 보수 성향
          if (idx.length === 4 && !labs.includes(GAP)) {
            const front = labs[0]
            const back = labs[2]
            if (front !== back) {
              const emit = (name: string, beats: number[]) => {
                const id = chordIdByName.get(name)
                if (id == null) return -Infinity
                let s = 0
                for (const k of beats) s += emissions[idx[k]][id]
                return s
              }
              const splitScore = emit(front, [0, 1]) + emit(back, [2, 3])
              const wholeScore = emit(winner, [0, 1, 2, 3])
              if (splitScore > wholeScore + 0.05) {
                labels[idx[0]] = front
                labels[idx[1]] = front
                labels[idx[2]] = back
                labels[idx[3]] = back
                continue
              }
            }
          }
          for (const i of idx) labels[i] = winner
        }
      }
      return labels
    }

    // ── 키 재판정(v8/v9): 코드 진행이 가장 오래 다이어토닉에 들어맞는 키 선택 ──
    // 적합도 계산은 자연단음계 3화음 기준 — 상대 장/단조(F↔Dm)가 정확히 같은 집합이 되어
    // 동점이 되고, 그 구분은 음악적 결정타(으뜸화음 시간 → V→I 종지/끝 코드 → 장/단 성향)로 함
    // (화성단조 V는 decode()의 가산점에만 사용 — 여기 넣으면 단조 집합이 커져 단조로 기울어짐)
    const chordIdByName = new Map<string, number>()
    for (let id = 0; id < TEMPLATES.length; id++) chordIdByName.set(chordName(id), id)

    const keyFromLabels = (labels: string[]): { root: number; minor: boolean } | null => {
      // 마지막 코드 (GAP 제외, 3화음 등가) — 곡은 으뜸화음으로 끝나는 경우가 많음
      let lastTid: number | null = null
      for (let b = labels.length - 1; b >= 0; b--) {
        const id = chordIdByName.get(labels[b])
        if (id != null) {
          lastTid = triadIdOf(id)
          break
        }
      }

      let best: { root: number; minor: boolean } | null = null
      let bestRank: [number, number, number, number] = [-1, -1, -1, -1]
      for (let root = 0; root < 12; root++) {
        for (const minor of [false, true]) {
          // 자연단음계의 3화음 집합 = 나란한 장조와 동일
          const majRoot = minor ? (root + 3) % 12 : root
          const dia = diatonicSet(majRoot, false)
          // + V/vi(장조 기준) = 나란한 단조의 화성단조 V — 관용적 세컨더리 도미넌트라 그 조의 증거
          // (예: F장조/D단조의 A — F↔Bb처럼 공통 화음만으론 동점인 이웃 조를 이걸로 가름.
          //  상대 장/단조에는 같은 화음이 추가되므로 둘 사이 공정성은 유지)
          dia.add(((majRoot + 4) % 12) * 2)
          const tonicId = root * 2 + (minor ? 1 : 0)
          const domId = ((root + 7) % 12) * 2 // 딸림화음(V)은 장/단조 모두 장3화음
          let score = 0
          let tonicDur = 0
          let cadences = 0
          let prevTid: number | null = null
          for (let b = 0; b < labels.length; b++) {
            const id = chordIdByName.get(labels[b])
            if (id == null) {
              prevTid = null
              continue
            }
            const tid = triadIdOf(id) // 7th는 3화음 등가로 (A7 = A)
            const dur = ticks[b + 1] - ticks[b]
            if (dia.has(tid)) score += dur
            if (tid === tonicId) tonicDur += dur
            // V→I 종지: 조성을 가장 강하게 결정하는 진행 (F장조 = C→F, D단조 = A→Dm)
            if (prevTid !== null && prevTid !== tid && prevTid === domId && tid === tonicId) {
              cadences++
            }
            prevTid = tid
          }
          const rank: [number, number, number, number] = [
            score,
            // 으뜸화음 시간을 종지보다 먼저 비교 (v13) — 실곡(금붕어, F장조)에서
            // 세컨더리 도미넌트 A7→Dm이 반복 진행이라 종지 6회로 잡혀 D단조로 오판했음.
            // 진행이 루프인 곡은 종지 횟수가 부풀려지므로, 어디에 오래 머무는지가 더 믿을 만함
            tonicDur,
            cadences + (lastTid === tonicId ? 2 : 0),
            minor === keyMinor0 ? 1 : 0, // 최후 동률: KeyExtractor가 들은 장/단 성향
          ]
          const better = rank.some((v, i) => {
            for (let k = 0; k < i; k++) if (Math.abs(rank[k] - bestRank[k]) > 1e-6) return false
            return v > bestRank[i] + 1e-6
          })
          if (better) {
            bestRank = rank
            best = { root, minor }
          }
        }
      }
      return bestRank[0] > 0 ? best : null
    }

    // 1차: KeyExtractor 키의 가산점으로 디코딩 → 코드 기반 키 재판정 → 다르면 새 키로 2차 디코딩
    let keyRoot = keyRootPc
    let keyMinor = keyMinor0
    let labels = decode(diatonicSet(keyRoot, keyMinor))
    const fit = keyFromLabels(labels)
    if (fit && (fit.root !== keyRoot || fit.minor !== keyMinor)) {
      if (debug) {
        debugLines.push(
          `KEY 재판정: ${keyRes.key} ${keyRes.scale} → ${NOTE_NAMES[fit.root]} ${fit.minor ? 'minor' : 'major'}`,
        )
      }
      keyRoot = fit.root
      keyMinor = fit.minor
      labels = decode(diatonicSet(keyRoot, keyMinor))
      // 2차 결과 기준으로 한 번 더 확정 (반복은 안 함 — 진동 방지)
      const fit2 = keyFromLabels(labels)
      if (fit2) {
        keyRoot = fit2.root
        keyMinor = fit2.minor
      }
    }
    const key = `${NOTE_NAMES[keyRoot]} ${keyMinor ? 'minor' : 'major'}`

    // ── 7th 표기 재판정 (v14): 같은 코드가 이어지는 구간의 평균 증거로 3화음 vs 7th 결정 ──
    // 박 단위 Viterbi 결과는 한두 박의 우연한 7th음(멜로디 경과음 등)에 표기가 좌우돼
    // 같은 자리인데 A/A7이 들쭉날쭉했음(실곡 피드백: G가 G7로). Dm7 같은 m7 표기도 여기서만 나옴
    {
      const keyDia = diatonicSet(keyRoot, keyMinor)
      let i = 0
      while (i < beatCount) {
        const lab = labels[i]
        if (lab === GAP) {
          i++
          continue
        }
        let j = i
        while (j < beatCount && labels[j] === lab) j++
        const tid = triadIdOf(chordIdByName.get(lab)!)
        const sevId = tid % 2 === 0 ? 24 + tid / 2 : 36 + (tid - 1) / 2
        let triadSum = 0
        let sevSum = 0
        let sevBeats = 0 // 7th가 우세한 박 수
        for (let b = i; b < j; b++) {
          triadSum += baseEmissions[b][tid]
          sevSum += baseEmissions[b][sevId] // SEVENTH_PENALTY 포함 점수 — 7th가 이기려면 벌점만큼 증거 필요
          if (baseEmissions[b][sevId] > baseEmissions[b][tid]) sevBeats++
        }
        // 7th 채택 = 과반 박에서 우세하거나 평균 격차가 확실할 때
        // (다음 코드로 넘어가는 경과음 한 박이 평균만 끌어올려 G→G7 되는 것 방지 — 실곡 피드백)
        const useSeventh = sevBeats * 2 > j - i || sevSum > triadSum + 0.1 * (j - i)
        let winId = useSeventh ? sevId : tid
        // V/vi 관용 표기: 비다이어토닉 장3화음이 완전4도 위 단3화음으로 진행하면(A→Dm)
        // 도미넌트 기능이므로 악보 관행대로 7th 표기 (인트로 A→Bb 같은 자리는 조건 미충족 = A 유지)
        if (!useSeventh && tid % 2 === 0 && !keyDia.has(tid)) {
          let k = j
          while (k < beatCount && labels[k] === GAP) k++
          if (k < beatCount) {
            const nid = triadIdOf(chordIdByName.get(labels[k])!)
            if (nid % 2 === 1 && rootOf(nid) === (rootOf(tid) + 5) % 12) winId = sevId
          }
        }
        const newLab = chordName(winId)
        if (debug) {
          debugLines.push(
            `[7th] ${ticks[i].toFixed(1)}~${ticks[j].toFixed(1)} ${lab}: 3화음 ${(triadSum / (j - i)).toFixed(3)} vs 7th ${(sevSum / (j - i)).toFixed(3)} (우세 ${sevBeats}/${j - i}박) → ${newLab}`,
          )
        }
        for (let b = i; b < j; b++) labels[b] = newLab
        i = j
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
    if (debug) response.debugLines = debugLines
    self.postMessage(response)
  } catch (err) {
    // 스택까지 실어 보냄 — 워커 안 에러는 밖에서 위치를 알 수 없기 때문
    const response: AnalyzeResponse = {
      error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    }
    self.postMessage(response)
  }
}
