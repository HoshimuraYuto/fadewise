import Toastify from 'toastify-js';
import toastifyCss from 'toastify-js/src/toastify.css?inline';
import { sanitizeRun } from '../shared/reorder.mts';
import { withDefaults } from '../shared/settings.mts';
import { startReorderToasts } from './toast.mts';

startReorderToasts({
  win: window,
  chrome,
  Toastify,
  css: toastifyCss,
  sanitizeRun,
  withDefaults,
});
