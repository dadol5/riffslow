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

type Quality = 'M' | 'm' | '7' | 'm7'

// 성질별 구성음 (근음 기준 반음 간격)
const TONES: Record<Quality, number[]> = {
  M: [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
}

function parseChord(chord: string): { pc: number; quality: Quality } | null {
  const seventh = chord.endsWith('7') // 7th (분석기는 "X7"/"Xm7"을 냄)
  const base = seventh ? chord.slice(0, -1) : chord
  const minor = base.endsWith('m')
  const rootName = minor ? base.slice(0, -1) : base
  const pc = NOTE_PC[rootName]
  if (pc === undefined) return null
  const quality: Quality = seventh ? (minor ? 'm7' : '7') : minor ? 'm' : 'M'
  return { pc, quality }
}

// 코드명 파싱 → 대표 운지 1개 (모르는 형식이면 null)
// 타임라인 코드표와 스트럼 미리듣기가 사용 — 결과는 기존 ChordDiagram 로직과 동일
export function shapeFor(chord: string): Shape | null {
  const parsed = parseChord(chord)
  if (!parsed) return null
  const { pc, quality } = parsed
  if (quality === 'm7') return MIN7_OPEN[pc] ?? barreM7Shape(pc)
  if (quality === '7') return SEVENTH_OPEN[pc] ?? barre7Shape(pc)
  return OPEN_SHAPES[`${pc}-${quality}`] ?? barreShape(pc, quality === 'm')
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
  const required = new Set(
    quality === 'M' || quality === 'm'
      ? tones // 트라이어드는 3음 전부
      : [tones[0], tones[1], tones[3]], // 7th는 5음(완전5도) 생략 허용 — 코드북 관행
  )
  const groups = quality === 'M' || quality === 'm' ? TRIAD_GROUPS : QUAD_GROUPS
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

// 저장된 운지가 이 코드에 유효한지 — 구성음 검사
// (피치 조옮김으로 코드명이 바뀌면 예전에 고른 운지가 안 맞게 됨 → 걸러서 기본 운지로 복귀)
export function shapeMatches(shape: Shape, chord: string): boolean {
  const parsed = parseChord(chord)
  if (!parsed) return false
  const tones = TONES[parsed.quality].map((t) => (parsed.pc + t) % 12)
  const required =
    parsed.quality === 'M' || parsed.quality === 'm' ? tones : [tones[0], tones[1], tones[3]]
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
