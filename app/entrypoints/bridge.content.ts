import '../content/bridge-start.mts';
import '../content/toast-start.mts';
import '../content/reorder-debug-start.mts';
import '../content/seekbar-marks-start.mts';

export default defineContentScript({
  matches: ['https://music.youtube.com/*'],
  runAt: 'document_start',
  // otherwise WXT posts 'wxt:content-script-started' to the page with targetOrigin '*'
  noScriptStartedPostMessage: true,
  main() {},
});
