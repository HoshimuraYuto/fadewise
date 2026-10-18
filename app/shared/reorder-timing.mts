// separate so the ISOLATED-world debug panel can import it without bundling the page script
export const C = Object.freeze({
  SETTLE_SEC: 5, // YTM reshuffles / refills a mix right after a track change
  QUIET_SEC: 2,
  GUARD_MS: 1000,
  GUARD_SETTLE_MS: 300,
  DEAF_AFTER_RUN_MS: 1000, // our own synthetic events can come back isTrusted
  MIN_REMAIN_SEC: 20,
  MOVE_BUDGET_SEC: 7, // a drag takes up to ~6.5 s
  IDLE_SEC: 2,
  USER_MOVED_HOLD_MS: 30 * 60 * 1000,
  MAX_WAIT_SEC: 120,
  PAGE_RETRIES: 2,
  PAGE_QUIET_SEC: 4,
  CONTEST_SEC: 30,
  SCROLL_GAP_MS: 300,
});
export type Timing = { readonly [K in keyof typeof C]: number };
