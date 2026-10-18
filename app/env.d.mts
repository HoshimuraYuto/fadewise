declare global {
  // a literal from wxt.config.ts; the Node tests set the global themselves
  var __FADEWISE_VERIFY__: boolean | undefined;
  // WXT types the same API but declares only `browser`.
  var chrome: typeof import('wxt/browser').browser;
}
export {};
