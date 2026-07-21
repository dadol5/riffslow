// 기타 코드 운지 다이어그램 (SVG) — 코드명("C", "A#m")으로 운지를 계산해 그림
// 운지 계산(사전/바레 생성/여러 포지션)은 utils/voicings.ts가 담당 — 여기는 그리기만
import { memo } from 'react'
import { shapeFor, type Shape } from '../utils/voicings'

// SVG 좌표 상수
const STR_X0 = 12 // 첫 줄(6번줄) x
const STR_GAP = 8 // 줄 간격
const FRET_Y0 = 11 // 너트(0프렛선) y
const FRET_GAP = 12 // 프렛 간격
const FRETS_SHOWN = 4

interface ChordDiagramProps {
  chord: string // 예: "C", "A#m"
  shape?: Shape // 지정하면 이 운지를 그대로 그림 (코드표 레이어의 포지션별 표시용) — 미지정 = 대표 운지
}

// memo: 타임라인이 재생 위치마다 리렌더돼도 다이어그램은 코드명이 같으면 재계산 안 함
const ChordDiagram = memo(function ChordDiagram({ chord, shape: shapeProp }: ChordDiagramProps) {
  const shape = shapeProp ?? shapeFor(chord)
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
