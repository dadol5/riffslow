// 음악 표기 유틸

// 코드/조표 이름의 플랫 문자를 기호로 (표시 전용 — 저장 데이터는 ASCII "Bb" 유지)
// 예: "Bb" → "B♭", "Bbm" → "B♭m", "Eb major" → "E♭ major"
export function prettyChord(name: string): string {
  return name.replace(/([A-G])b/g, '$1♭')
}

// 조 이동 계산용 (표기는 플랫 기준, 구버전 저장 데이터의 샤프도 파싱)
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

// 코드/조표 이름을 반음만큼 이동 — 근음만 바꾸고 나머지 표기는 유지
// 예: transposeName("A7", 2) = "B7", transposeName("Bbm7", 1) = "Bm7", ("F major", 2) = "G major"
// 반음이 정수가 아니면(구버전 0.5 단위 피치) 이동할 조 이름이 없으므로 원본 그대로 반환
export function transposeName(name: string, semitones: number): string {
  if (!Number.isInteger(semitones)) return name
  const m = name.match(/^([A-G][b#]?)(.*)$/)
  if (!m) return name
  const pc = NOTE_PC[m[1]]
  if (pc == null) return name
  return NOTE_NAMES[(pc + (semitones % 12) + 12) % 12] + m[2]
}
