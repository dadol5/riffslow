// 초 → "mm:ss" 문자열 (휠 중앙 표시, 곡 목록 등 공용)
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
