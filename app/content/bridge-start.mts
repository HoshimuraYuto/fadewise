import { startAutoContinue } from './auto-continue.mts';
import { startBridge } from './bridge.mts';

startBridge({ win: window, chrome, startAutoContinue });
