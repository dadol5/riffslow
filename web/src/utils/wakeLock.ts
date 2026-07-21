// 화면 꺼짐 방지 (Screen Wake Lock API) — 연습 중 폰 화면이 자동으로 꺼지지 않게
// iOS 16.4+ 사파리/홈 화면 PWA 지원 (https 필수). 앱이 화면에 떠 있는 동안만 유지되고,
// 다른 앱/홈으로 나가면 시스템이 자동 해제 → 복귀(visibilitychange) 시 재획득
let sentinel: WakeLockSentinel | null = null
let attached = false // 리스너 앱 전체 1회 등록 가드

async function acquire() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  if (sentinel && !sentinel.released) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    console.log('화면 켜짐 유지 시작')
  } catch {
    // 저전력 모드 등에서 거부될 수 있음 — 다음 터치/복귀 때 재시도
  }
}

export function keepScreenAwake() {
  if (attached) return
  attached = true
  void acquire()
  // 백그라운드 갔다 오면 자동 해제되어 있음 — 다시 획득
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire()
  })
  // 최초 요청이 거부된 경우(저전력 모드 등) 사용자 터치에서 재시도하는 안전망
  window.addEventListener(
    'pointerdown',
    () => {
      if (!sentinel || sentinel.released) void acquire()
    },
    { passive: true },
  )
}
