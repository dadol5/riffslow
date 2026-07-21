// 기타 스트럼 합성 (Karplus-Strong) — 샘플 파일 없이 코드 운지 그대로 6줄을 튕김
// 용도: Chords 타임라인에서 코드 탭 = 미리듣기 (일시정지 중)
// 운지는 utils/voicings의 shapeFor를 그대로 사용 — 화면에 보이는 운지와 소리가 일치
import { shapeFor, type Shape } from '../utils/voicings'

// 표준 튜닝 개방현 MIDI 노트 (6번줄→1번줄: E2 A2 D3 G3 B3 E4)
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]
const STRUM_GAP_SEC = 0.03 // 줄 간 시차 (위→아래 다운스트럼 느낌)
const DECAY_SEC = 1.6 // 한 줄 울림 길이
const STRING_GAIN = 0.22 // 줄 하나 음량 (6줄 합쳐도 안 깨지는 수준)

// Karplus-Strong: 주기 길이의 노이즈를 순환시키며 이웃 샘플과 평균 → 튕긴 현의 감쇠 배음
function pluckBuffer(ctx: AudioContext, freq: number): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * DECAY_SEC)
  const buf = ctx.createBuffer(1, n, sr)
  const out = buf.getChannelData(0)
  const period = Math.max(2, Math.round(sr / freq))

  // 초기 여기(노이즈) — 한 번 평균내서 고음 노이즈를 눌러 따뜻한 톤으로
  const delay = new Float32Array(period)
  let prev = 0
  for (let i = 0; i < period; i++) {
    const w = Math.random() * 2 - 1
    delay[i] = (w + prev) / 2
    prev = w
  }

  let idx = 0
  for (let i = 0; i < n; i++) {
    const cur = delay[idx]
    const nxt = delay[(idx + 1) % period]
    out[i] = cur
    delay[idx] = 0.996 * 0.5 * (cur + nxt) // 0.996 = 감쇠 (클수록 오래 울림)
    idx = (idx + 1) % period
  }

  // 꼬리 페이드아웃 — 저음 줄은 끝까지 잔향이 남아 뚝 끊기는 클릭 방지
  const fade = Math.floor(sr * 0.15)
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade
  return buf
}

// 코드명으로 스트럼 재생 — 운지를 모르는 코드면 false (소리 없음)
export function strum(ctx: AudioContext, dest: AudioNode, chord: string): boolean {
  const shape = shapeFor(chord)
  if (!shape) return false
  return strumShape(ctx, dest, shape)
}

// 지정한 운지 그대로 스트럼 재생 (코드표 레이어의 포지션별 미리듣기용)
export function strumShape(ctx: AudioContext, dest: AudioNode, shape: Shape): boolean {
  const t0 = ctx.currentTime + 0.02
  let k = 0 // 실제 튕긴 줄 수 (뮤트 줄은 시차 계산에서도 제외)
  shape.frets.forEach((fret, i) => {
    if (fret < 0) return // 뮤트(×) 줄
    const midi = OPEN_MIDI[i] + fret
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const src = ctx.createBufferSource()
    src.buffer = pluckBuffer(ctx, freq)
    const g = ctx.createGain()
    g.gain.value = STRING_GAIN
    src.connect(g)
    g.connect(dest)
    src.start(t0 + k * STRUM_GAP_SEC)
    k++
  })
  return k > 0
}
