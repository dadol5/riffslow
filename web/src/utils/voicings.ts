// 기타 운지(보이싱) 모듈 — 코드명 → 운지 계산의 단일 소스
//
// 1) shapeFor(chord): 대표 운지 1개 (타임라인 코드표/스트럼이 사용 — 기존 동작 그대로)
// 2) voicingsFor(chord): 같은 코드의 여러 포지션 목록 (오픈~하이프렛, 코드당 15~25개)
//    - CAGED 이동폼(E/A/D/C/G폼)을 프렛 위로 이동 + 12프렛 위 반복
//    - 3~4줄 부분 운지(트라이어드/셸)를 전 포지션 탐색으로 생성
//    - 수정 폼(예정)에서 포지션 넘겨보기/선택에 사용
//
// 표기: 프렛 배열은 6번줄(굵은 저음줄)→1번줄 순서, -1 = 뮤트(×), 0 = 개방(○)

// 샤프/플랫 둘 다 파싱 (표기는 v10부터 플랫 기준, 구버전 저장 데이터는 샤프일 수 있음)
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

export interface Shape {
  frets: number[] // 6줄 (6번줄→1번줄), 절대 프렛
  barre?: { fret: number; from: number; to: number } // 바레: from~to 줄 인덱스(0=6번줄)
}

// 개방현 피치 클래스 (표준 튜닝 E A D G B E)
const OPEN_PC = [4, 9, 2, 7, 11, 4]

// 근음 이름 (플랫 표기 — utils/music.ts의 NOTE_NAMES와 동일, 이 모듈은 의존성 0 유지를 위해 별도 보관)
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// 포지션 생성 상한 프렛 (참고 앱 실측: 17프렛 포지션까지 표시)
const MAX_FRET = 17

// ── 대표 운지 사전 (기존 ChordDiagram에서 이사 — 내용 동일) ──

// 흔한 오픈 코드 표준 운지 (키: "근음pc-m|M")
const OPEN_SHAPES: Record<string, Shape> = {
  '0-M': { frets: [-1, 3, 2, 0, 1, 0] }, // C
  '9-M': { frets: [-1, 0, 2, 2, 2, 0] }, // A
  '7-M': { frets: [3, 2, 0, 0, 0, 3] }, // G
  '4-M': { frets: [0, 2, 2, 1, 0, 0] }, // E
  '2-M': { frets: [-1, -1, 0, 2, 3, 2] }, // D
  '5-M': { frets: [1, 3, 3, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } }, // F
  '9-m': { frets: [-1, 0, 2, 2, 1, 0] }, // Am
  '4-m': { frets: [0, 2, 2, 0, 0, 0] }, // Em
  '2-m': { frets: [-1, -1, 0, 2, 3, 1] }, // Dm
}

// 흔한 오픈 도미넌트 7th 운지 (키: 근음pc)
const SEVENTH_OPEN: Record<number, Shape> = {
  9: { frets: [-1, 0, 2, 0, 2, 0] }, // A7
  11: { frets: [-1, 2, 1, 2, 0, 2] }, // B7
  0: { frets: [-1, 3, 2, 3, 1, 0] }, // C7
  2: { frets: [-1, -1, 0, 2, 1, 2] }, // D7
  4: { frets: [0, 2, 0, 1, 0, 0] }, // E7
  7: { frets: [3, 2, 0, 0, 0, 1] }, // G7
}

// 흔한 오픈 마이너 7th 운지 (키: 근음pc)
const MIN7_OPEN: Record<number, Shape> = {
  9: { frets: [-1, 0, 2, 0, 1, 0] }, // Am7
  4: { frets: [0, 2, 0, 0, 0, 0] }, // Em7
  2: { frets: [-1, -1, 0, 2, 1, 1] }, // Dm7
}

// 마이너 7th 바레 자동 생성 (Em7폼/Am7폼 중 낮은 프렛)
function barreM7Shape(rootPc: number): Shape {
  const fE = (rootPc - NOTE_PC.E + 12) % 12 || 12
  const fA = (rootPc - NOTE_PC.A + 12) % 12 || 12
  if (fE <= fA) {
    const f = fE
    return { frets: [f, f + 2, f, f, f, f], barre: { fret: f, from: 0, to: 5 } }
  }
  const f = fA
  return { frets: [-1, f, f + 2, f, f + 1, f], barre: { fret: f, from: 1, to: 5 } }
}

// 도미넌트 7th 바레 자동 생성 (E7폼/A7폼 중 낮은 프렛)
function barre7Shape(rootPc: number): Shape {
  const fE = (rootPc - NOTE_PC.E + 12) % 12 || 12
  const fA = (rootPc - NOTE_PC.A + 12) % 12 || 12
  if (fE <= fA) {
    const f = fE
    return { frets: [f, f + 2, f, f + 1, f, f], barre: { fret: f, from: 0, to: 5 } }
  }
  const f = fA
  return { frets: [-1, f, f + 2, f, f + 2, f], barre: { fret: f, from: 1, to: 5 } }
}

// 바레 코드 자동 생성 (E폼/A폼 중 낮은 프렛)
function barreShape(rootPc: number, minor: boolean): Shape {
  const fE = (rootPc - NOTE_PC.E + 12) % 12 || 12 // 6번줄 루트 프렛 (0이면 12프렛으로)
  const fA = (rootPc - NOTE_PC.A + 12) % 12 || 12 // 5번줄 루트 프렛
  if (fE <= fA) {
    const f = fE
    return {
      frets: minor ? [f, f + 2, f + 2, f, f, f] : [f, f + 2, f + 2, f + 1, f, f],
      barre: { fret: f, from: 0, to: 5 },
    }
  }
  const f = fA
  return {
    frets: minor ? [-1, f, f + 2, f + 2, f + 1, f] : [-1, f, f + 2, f + 2, f + 2, f],
    barre: { fret: f, from: 1, to: 5 },
  }
}

// ── 코드명 파싱 ──

// 지원 성질 — 분석기는 앞의 4종(M/m/7/m7)만 판정하고, 나머지는 수동 수정/검색용
// (추후 텐션(add9/9/…)·변화화음(dim/aug/…) 추가 시 TONES/SUFFIXES/FULL_FORMS에만 등록하면
//  검색·칩·운지 그림·스트럼이 자동으로 따라옴)
type Quality =
  | 'M' | 'm' | '7' | 'm7'
  | 'Maj7' | 'mMaj7' | '6' | 'm6' | 'dim7' | 'm7b5'
  | 'sus4' | 'sus2' | '7sus4'

// 성질별 구성음 (근음 기준 반음 간격)
const TONES: Record<Quality, number[]> = {
  M: [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  Maj7: [0, 4, 7, 11],
  mMaj7: [0, 3, 7, 11],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10],
}

// 저장/검색용 서픽스 표기 (표시 전용 변환은 utils/music.ts prettyChord가 담당: m7b5→m7(♭5) 등)
const SUFFIX_TO_QUALITY: Record<string, Quality> = {
  '': 'M',
  m: 'm',
  '7': '7',
  m7: 'm7',
  Maj7: 'Maj7',
  mMaj7: 'mMaj7',
  '6': '6',
  m6: 'm6',
  dim7: 'dim7',
  m7b5: 'm7b5',
  sus4: 'sus4',
  sus2: 'sus2',
  '7sus4': '7sus4',
}

function parseChord(chord: string): { pc: number; quality: Quality } | null {
  const m = chord.match(/^([A-G][b#]?)(.*)$/)
  if (!m) return null
  const pc = NOTE_PC[m[1]]
  const quality = SUFFIX_TO_QUALITY[m[2]]
  if (pc === undefined || quality === undefined) return null
  return { pc, quality }
}

// 성질별 필수음: 4음 이상 코드는 완전5도(7)만 생략 허용 (코드북 관행 — C7 오픈도 5음 없음)
// 변형 5도(dim7/m7b5의 ♭5)는 성질을 결정하는 음이라 생략 불가
function requiredPcs(pc: number, quality: Quality): number[] {
  const iv = TONES[quality]
  const req = iv.length >= 4 ? iv.filter((i) => i !== 7) : iv
  return req.map((i) => (pc + i) % 12)
}

// 코드명 파싱 → 대표 운지 1개 (모르는 형식이면 null)
// 타임라인 코드표와 스트럼 미리듣기가 사용 — 기본 4성질은 기존 ChordDiagram 로직과 동일,
// 확장 성질(Maj7/sus4 등)은 이동폼 중 가장 낮은 포지션 (없으면 부분 운지)
export function shapeFor(chord: string): Shape | null {
  const parsed = parseChord(chord)
  if (!parsed) return null
  const { pc, quality } = parsed
  if (quality === 'm7') return MIN7_OPEN[pc] ?? barreM7Shape(pc)
  if (quality === '7') return SEVENTH_OPEN[pc] ?? barre7Shape(pc)
  if (quality === 'M' || quality === 'm') {
    return OPEN_SHAPES[`${pc}-${quality}`] ?? barreShape(pc, quality === 'm')
  }
  const forms = expandForms(pc, quality).sort((a, b) => basePos(a) - basePos(b))
  if (forms.length > 0) return forms[0]
  const partials = searchPartials(pc, quality).sort((a, b) => basePos(a) - basePos(b))
  return partials[0] ?? null
}

// ── 여러 포지션 생성 ──

// CAGED 이동폼 템플릿: anchor 줄의 근음 프렛(r) 기준 상대 프렛 (null = 뮤트)
interface FormTemplate {
  anchor: number // 근음이 놓이는 줄 인덱스 (0 = 6번줄)
  rel: (number | null)[]
  barre?: { rel: number; from: number; to: number }
}

const FULL_FORMS: Record<Quality, FormTemplate[]> = {
  M: [
    { anchor: 0, rel: [0, 2, 2, 1, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // E폼
    { anchor: 1, rel: [null, 0, 2, 2, 2, 0], barre: { rel: 0, from: 1, to: 5 } }, // A폼
    { anchor: 2, rel: [null, null, 0, 2, 3, 2] }, // D폼
    { anchor: 1, rel: [null, 0, -1, -3, -2, -3], barre: { rel: -3, from: 3, to: 5 } }, // C폼
    { anchor: 0, rel: [0, -1, -3, -3, -3, 0], barre: { rel: -3, from: 2, to: 4 } }, // G폼
  ],
  m: [
    { anchor: 0, rel: [0, 2, 2, 0, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // Em폼
    { anchor: 1, rel: [null, 0, 2, 2, 1, 0], barre: { rel: 0, from: 1, to: 5 } }, // Am폼
    { anchor: 2, rel: [null, null, 0, 2, 3, 1] }, // Dm폼
  ],
  '7': [
    { anchor: 0, rel: [0, 2, 0, 1, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // E7폼
    { anchor: 1, rel: [null, 0, 2, 0, 2, 0], barre: { rel: 0, from: 1, to: 5 } }, // A7폼
    { anchor: 2, rel: [null, null, 0, 2, 1, 2] }, // D7폼
    { anchor: 1, rel: [null, 0, -1, 0, -2, -3], barre: { rel: -3, from: 4, to: 5 } }, // C7폼
  ],
  m7: [
    { anchor: 0, rel: [0, 2, 0, 0, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // Em7폼
    { anchor: 1, rel: [null, 0, 2, 0, 1, 0], barre: { rel: 0, from: 1, to: 5 } }, // Am7폼
    { anchor: 2, rel: [null, null, 0, 2, 1, 1] }, // Dm7폼
  ],
  Maj7: [
    { anchor: 0, rel: [0, 2, 1, 1, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // EMaj7폼
    { anchor: 1, rel: [null, 0, 2, 1, 2, 0], barre: { rel: 0, from: 1, to: 5 } }, // AMaj7폼
    { anchor: 2, rel: [null, null, 0, 2, 2, 2] }, // DMaj7폼
  ],
  mMaj7: [
    { anchor: 0, rel: [0, 2, 1, 0, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // Em(Maj7)폼
    { anchor: 1, rel: [null, 0, 2, 1, 1, 0], barre: { rel: 0, from: 1, to: 5 } }, // Am(Maj7)폼
    { anchor: 2, rel: [null, null, 0, 2, 2, 1] }, // Dm(Maj7)폼
  ],
  '6': [
    { anchor: 0, rel: [0, 2, 2, 1, 2, 0], barre: { rel: 0, from: 0, to: 5 } }, // E6폼
    { anchor: 1, rel: [null, 0, 2, 2, 2, 2], barre: { rel: 0, from: 1, to: 5 } }, // A6폼
    { anchor: 2, rel: [null, null, 0, 2, 0, 2] }, // D6폼
  ],
  m6: [
    { anchor: 0, rel: [0, 2, 2, 0, 2, 0], barre: { rel: 0, from: 0, to: 5 } }, // Em6폼
    { anchor: 1, rel: [null, 0, 2, 2, 1, 2] }, // Am6폼
    { anchor: 2, rel: [null, null, 0, 2, 0, 1] }, // Dm6폼
  ],
  dim7: [
    { anchor: 2, rel: [null, null, 0, 1, 0, 1] }, // Ddim7폼 (표준 4줄)
    { anchor: 1, rel: [null, 0, 1, -1, 1, null] }, // Bdim7폼 (5번줄 루트)
  ],
  m7b5: [
    { anchor: 1, rel: [null, 0, 1, 0, 1, null] }, // Bm7♭5폼 (5번줄 루트, 표준)
    { anchor: 0, rel: [0, null, 0, 0, -1, null] }, // Gm7♭5폼 (6번줄 루트)
    { anchor: 2, rel: [null, null, 0, 1, 1, 1] }, // Dm7♭5폼
  ],
  sus4: [
    { anchor: 0, rel: [0, 2, 2, 2, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // Esus4폼
    { anchor: 1, rel: [null, 0, 2, 2, 3, 0], barre: { rel: 0, from: 1, to: 5 } }, // Asus4폼
    { anchor: 2, rel: [null, null, 0, 2, 3, 3] }, // Dsus4폼
  ],
  sus2: [
    { anchor: 1, rel: [null, 0, 2, 2, 0, 0], barre: { rel: 0, from: 1, to: 5 } }, // Asus2폼
    { anchor: 2, rel: [null, null, 0, 2, 3, 0] }, // Dsus2폼
  ],
  '7sus4': [
    { anchor: 0, rel: [0, 2, 0, 2, 0, 0], barre: { rel: 0, from: 0, to: 5 } }, // E7sus4폼
    { anchor: 1, rel: [null, 0, 2, 0, 3, 0], barre: { rel: 0, from: 1, to: 5 } }, // A7sus4폼
    { anchor: 2, rel: [null, null, 0, 2, 1, 3] }, // D7sus4폼
  ],
}

// 부분 운지 탐색용 이웃 줄 묶음 (3음 코드는 3줄, 7th는 4줄)
const TRIAD_GROUPS = [
  [1, 2, 3], // 5·4·3번줄
  [2, 3, 4], // 4·3·2번줄
  [3, 4, 5], // 3·2·1번줄
]
const QUAD_GROUPS = [
  [1, 2, 3, 4], // 5·4·3·2번줄
  [2, 3, 4, 5], // 4·3·2·1번줄
]

// 이동폼을 실제 프렛으로 전개 (r과 r+12 두 옥타브 — 범위를 벗어나면 제외)
function expandForms(pc: number, quality: Quality): Shape[] {
  const out: Shape[] = []
  for (const form of FULL_FORMS[quality]) {
    const r0 = (pc - OPEN_PC[form.anchor] + 12) % 12
    for (const r of [r0, r0 + 12]) {
      // 계산된 프렛이 0 미만이면 이 변형은 성립 안 함 (-1 뮤트 표기와 겹치므로 map 전에 검사)
      if (form.rel.some((rel) => rel !== null && (rel + r < 0 || rel + r > MAX_FRET))) continue
      const frets = form.rel.map((rel) => (rel === null ? -1 : rel + r))
      const shape: Shape = { frets }
      if (form.barre) {
        const bf = form.barre.rel + r
        if (bf > 0) shape.barre = { fret: bf, from: form.barre.from, to: form.barre.to }
      }
      out.push(shape)
    }
  }
  return out
}

// 이웃 줄 묶음에서 구성음을 전부 담는 부분 운지를 전 포지션 탐색
// (트라이어드 3줄 / 7th 셸 4줄 — 손 span 3프렛 이내만, 뮤트 줄은 묶음 밖 전부)
function searchPartials(pc: number, quality: Quality): Shape[] {
  const tones = TONES[quality].map((t) => (pc + t) % 12)
  const required = new Set(requiredPcs(pc, quality)) // 3음 = 전부, 4음 = 완전5도만 생략 허용
  const groups = TONES[quality].length === 3 ? TRIAD_GROUPS : QUAD_GROUPS
  const out: Shape[] = []

  for (const group of groups) {
    // 줄마다 구성음이 나는 프렛 후보 (0~MAX_FRET)
    const candidates = group.map((s) => {
      const list: number[] = []
      for (let f = 0; f <= MAX_FRET; f++) {
        if (tones.includes((OPEN_PC[s] + f) % 12)) list.push(f)
      }
      return list
    })
    // 데카르트 곱 탐색 (묶음이 3~4줄이라 조합 수 수백 개 수준)
    const pick = (idx: number, acc: number[]) => {
      if (idx === group.length) {
        const sounded = acc.map((f, k) => (OPEN_PC[group[k]] + f) % 12)
        if (![...required].every((t) => sounded.includes(t))) return
        const pressed = acc.filter((f) => f > 0)
        if (pressed.length > 0) {
          const span = Math.max(...pressed) - Math.min(...pressed)
          if (span > 3) return // 손이 닿는 범위만
          if (acc.includes(0) && Math.max(...pressed) > 3) return // 개방현+하이프렛 혼합 배제
        }
        const frets = [-1, -1, -1, -1, -1, -1]
        group.forEach((s, k) => (frets[s] = acc[k]))
        out.push({ frets })
        return
      }
      for (const f of candidates[idx]) pick(idx + 1, [...acc, f])
    }
    pick(0, [])
  }
  return out
}

// 코드 수정(검색)용 전체 코드 목록 — 성질 추가 시 이 순서 배열에도 등록
// (Object.keys는 숫자형 키('6','7')를 앞으로 당겨버려서 표시 순서를 배열로 고정)
const SUFFIX_ORDER = ['', 'm', '7', 'm7', 'Maj7', 'mMaj7', '6', 'm6', 'dim7', 'm7b5', 'sus4', 'sus2', '7sus4']
export const ALL_CHORDS: string[] = NOTE_NAMES_FLAT.flatMap((n) =>
  SUFFIX_ORDER.map((suf) => n + suf),
)

// 코드 수정 레이어의 "관련 코드" 4개: 같은 근음의 다른 성질 3종 + 나란한조
// (나란한조는 분석기가 가장 자주 헷갈리는 쌍 — F↔Dm 같은 상대 장/단조 혼동의 정정용)
export function relatedChords(chord: string): string[] {
  const parsed = parseChord(chord)
  if (!parsed) return []
  const { pc, quality } = parsed
  const root = NOTE_NAMES_FLAT[pc]
  const cur = quality === 'M' ? '' : quality
  const others = ['', 'm', '7', 'm7'].filter((q) => q !== cur).map((q) => root + q)
  const majorish = !TONES[quality].includes(3) // 단3도가 없으면 장조계 취급 (sus 포함)
  const relative = majorish
    ? NOTE_NAMES_FLAT[(pc + 9) % 12] + 'm' // 장조계 → 나란한 단조
    : NOTE_NAMES_FLAT[(pc + 3) % 12] // 단조계 → 나란한 장조
  return [...others, relative]
}

// 저장된 운지가 이 코드에 유효한지 — 구성음 검사
// (피치 조옮김으로 코드명이 바뀌면 예전에 고른 운지가 안 맞게 됨 → 걸러서 기본 운지로 복귀)
export function shapeMatches(shape: Shape, chord: string): boolean {
  const parsed = parseChord(chord)
  if (!parsed) return false
  const tones = TONES[parsed.quality].map((t) => (parsed.pc + t) % 12)
  const required = requiredPcs(parsed.pc, parsed.quality)
  const sounded = shape.frets
    .map((f, i) => (f >= 0 ? (OPEN_PC[i] + f) % 12 : -1))
    .filter((p) => p >= 0)
  return sounded.every((p) => tones.includes(p)) && required.every((t) => sounded.includes(t))
}

// 포지션 정렬 기준: 낮은 포지션부터 (개방현만 있으면 0)
function basePos(s: Shape): number {
  const pressed = s.frets.filter((f) => f > 0)
  return pressed.length ? Math.min(...pressed) : 0
}

// 같은 코드의 운지 포지션 목록 — [0] = 대표 운지(기존 표시와 동일), 이후 낮은 포지션순
// 모르는 코드 형식이면 빈 배열
export function voicingsFor(chord: string): Shape[] {
  const parsed = parseChord(chord)
  if (!parsed) return []
  const { pc, quality } = parsed

  const main = shapeFor(chord)
  const rest = [...expandForms(pc, quality), ...searchPartials(pc, quality)]
  rest.sort((a, b) => {
    const d = basePos(a) - basePos(b)
    if (d !== 0) return d
    // 같은 포지션이면 소리 나는 줄이 많은(풀 폼) 쪽 먼저
    return b.frets.filter((f) => f >= 0).length - a.frets.filter((f) => f >= 0).length
  })

  // 대표 운지를 맨 앞에 두고 중복 제거
  const out: Shape[] = []
  const seen = new Set<string>()
  for (const s of main ? [main, ...rest] : rest) {
    const key = s.frets.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
