import { withDefaults } from '../shared/settings.mts';
import { startSeekbarMarks } from './seekbar-marks.mts';

startSeekbarMarks({ win: window, chrome, withDefaults });
