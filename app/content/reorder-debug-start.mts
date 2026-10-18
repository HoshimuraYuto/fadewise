import { withDefaults } from '../shared/settings.mts';
import { C } from '../shared/reorder-timing.mts';
import { startReorderDebug } from './reorder-debug.mts';

startReorderDebug({
  win: window,
  chrome,
  withDefaults,
  limits: { PAGE_RETRIES: C.PAGE_RETRIES },
});
