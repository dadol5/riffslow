// 화면 꺼짐 방지 (Screen Wake Lock API) — 연습 중 폰 화면이 자동으로 꺼지지 않게
// iOS 16.4+ 사파리/홈 화면 PWA 지원 (https 필수). 앱이 화면에 떠 있는 동안만 유지되고,
// 다른 앱/홈으로 나가면 시스템이 자동 해제 → 복귀(visibilitychange) 시 재획득
//
// ⚠️ 사진첩/파일 피커가 열릴 때도 iOS가 조용히 해제하는데, 피커는 앱 위에 얹히는 시트라
// visibilitychange가 안 오는 경우가 있음 (실사용 화면 꺼짐 재발, 2026-07-22) →
// 해제 이벤트 직접 감지 + 15초 주기 안전망으로 어떤 경로로 풀려도 다시 획득
let sentinel: WakeLockSentinel | null = null
let attached = false // 리스너 앱 전체 1회 등록 가드
let requesting = false // 중복 요청 방지 (이벤트 여러 개가 동시에 acquire를 부를 수 있음)
let denialLogged = false // 거부 로그 1회만 (저전력 모드면 15초 안전망마다 도배되는 것 방지)

async function acquire() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  if (requesting || (sentinel && !sentinel.released)) return
  requesting = true
  try {
    sentinel = await navigator.wakeLock.request('screen')
    console.log('화면 켜짐 유지 시작')
    denialLogged = false // 성공했으니 다음 거부는 새 상황 — 다시 로그
    // 시스템이 조용히 해제하는 경우(사진첩 피커/저전력 등) 감지 → 화면에 떠 있으면 재획득
    // (백그라운드 전환으로 해제된 경우엔 acquire가 visible 검사에서 알아서 빠짐)
    sentinel.addEventListener('release', () => {
      console.log('화면 켜짐 유지 해제됨 — 잠시 후 재획득 시도')
      setTimeout(() => void acquire(), 1000)
    })
  } catch (e) {
    // 저전력 모드 등에서 거부됨 — 주기 안전망/터치/복귀 때 재시도 (폰 eruda 진단용 로그)
    if (!denialLogged) {
      denialLogged = true
      console.warn(`화면 켜짐 유지 거부: ${e} (계속 재시도 중 — 이후 거부는 로그 생략)`)
    }
  } finally {
    requesting = false
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
  window.addEventListener('pageshow', () => void acquire())
  // 최초 요청이 거부된 경우(저전력 모드 등) 사용자 터치에서 재시도하는 안전망
  window.addEventListener(
    'pointerdown',
    () => {
      if (!sentinel || sentinel.released) void acquire()
    },
    { passive: true },
  )
  // 마지막 안전망: 이벤트를 어떤 이유로 놓쳐도 15초 안에는 복구 (유지 중이면 아무것도 안 함)
  setInterval(() => {
    if (!sentinel || sentinel.released) void acquire()
  }, 15000)
}
