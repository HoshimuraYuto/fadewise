import '../page/queue-badges-start.mts';
import '../page/player-start.mts';

export default defineContentScript({
  matches: ['https://music.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {},
});
