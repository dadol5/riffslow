// 기타 코드 운지 다이어그램 (SVG) — 코드명("C", "A#m")으로 운지를 계산해 그림
//
// 운지 결정 규칙:
// 1) 흔한 오픈 코드는 사전(OPEN_SHAPES)의 표준 운지 사용
// 2) 나머지는 바레 코드 자동 생성: E폼(6번줄 루트)과 A폼(5번줄 루트) 중 낮은 프렛 선택
//
// 표기: 프렛 배열은 6번줄(굵은 저음줄)→1번줄 순서, -1 = 뮤트(×), 0 = 개방(○)
import { memo } from 'react'

const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
}

interface Shape {
  frets: number[] // 6줄 (6번줄→1번줄), 절대 프렛
  barre?: { fret: number; from: number; to: number } // 바레: from~to 줄 인덱스(0=6번줄)
}

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

// 코드명 파싱 → 운지 (모르는 형식이면 null)
function shapeFor(chord: string): Shape | null {
  const minor = chord.endsWith('m')
  const rootName = minor ? chord.slice(0, -1) : chord
  const pc = NOTE_PC[rootName]
  if (pc === undefined) return null
  return OPEN_SHAPES[`${pc}-${minor ? 'm' : 'M'}`] ?? barreShape(pc, minor)
}

// SVG 좌표 상수
const STR_X0 = 12 // 첫 줄(6번줄) x
const STR_GAP = 8 // 줄 간격
const FRET_Y0 = 11 // 너트(0프렛선) y
const FRET_GAP = 12 // 프렛 간격
const FRETS_SHOWN = 4

interface ChordDiagramProps {
  chord: string // 예: "C", "A#m"
}

// memo: 타임라인이 재생 위치마다 리렌더돼도 다이어그램은 코드명이 같으면 재계산 안 함
const ChordDiagram = memo(function ChordDiagram({ chord }: ChordDiagramProps) {
  const shape = shapeFor(chord)
  if (!shape) return null

  // 표시 시작 프렛: 운지 중 가장 낮은 프렛(1 이상) — 1이면 너트부터
  const positives = shape.frets.filter((f) => f > 0)
  const baseFret = Math.max(1, Math.min(...(positives.length ? positives : [1])))
  const relY = (fret: number) => FRET_Y0 + (fret - baseFret + 0.5) * FRET_GAP
  const strX = (i: number) => STR_X0 + i * STR_GAP

  return (
    <svg viewBox="0 0 56 64" className="chord-diagram">
      {/* 너트(1프렛 시작) 또는 시작 프렛 번호 */}
      {baseFret === 1 ? (
        <line x1={strX(0)} y1={FRET_Y0} x2={strX(5)} y2={FRET_Y0} stroke="currentColor" strokeWidth="2.4" />
      ) : (
        <text x={STR_X0 - 5} y={FRET_Y0 + FRET_GAP * 0.5 + 2.5} fontSize="7" fill="currentColor" textAnchor="end">
          {baseFret}
        </text>
      )}

      {/* 프렛 가로선 */}
      {Array.from({ length: FRETS_SHOWN + 1 }, (_, k) => (
        <line
          key={k}
          x1={strX(0)}
          y1={FRET_Y0 + k * FRET_GAP}
          x2={strX(5)}
          y2={FRET_Y0 + k * FRET_GAP}
          stroke="currentColor"
          strokeWidth="0.7"
          opacity="0.65"
        />
      ))}

      {/* 줄 세로선 */}
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={i}
          x1={strX(i)}
          y1={FRET_Y0}
          x2={strX(i)}
          y2={FRET_Y0 + FRETS_SHOWN * FRET_GAP}
          stroke="currentColor"
          strokeWidth="0.7"
          opacity="0.65"
        />
      ))}

      {/* 바레 (둥근 막대) */}
      {shape.barre && (
        <rect
          x={strX(shape.barre.from) - 3}
          y={relY(shape.barre.fret) - 3.2}
          width={strX(shape.barre.to) - strX(shape.barre.from) + 6}
          height="6.4"
          rx="3.2"
          fill="currentColor"
        />
      )}

      {/* 뮤트(×)/개방(○) 표시 + 운지 점 */}
      {shape.frets.map((fret, i) => {
        if (fret === -1) {
          return (
            <text key={i} x={strX(i)} y="7" fontSize="7" fill="currentColor" textAnchor="middle" opacity="0.8">
              ×
            </text>
          )
        }
        if (fret === 0) {
          return (
            <circle key={i} cx={strX(i)} cy="4.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="0.9" />
          )
        }
        // 바레 위의 손가락과 겹치는 점은 바레가 대신함
        if (shape.barre && fret === shape.barre.fret && i >= shape.barre.from && i <= shape.barre.to) {
          return null
        }
        return <circle key={i} cx={strX(i)} cy={relY(fret)} r="3.1" fill="currentColor" />
      })}
    </svg>
  )
})

export default ChordDiagram
