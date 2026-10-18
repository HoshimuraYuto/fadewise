import { defineConfig } from 'wxt';
import { EXTENSION_NAME } from './shared/brand.mts';
import { bundleReport } from './scripts/bundle-report.mts';
import { WORKLETS, workletJs, type WorkletPath } from './scripts/worklets.mts';

export default defineConfig({
  outDir: process.env.FADEWISE_OUT_DIR || '.output',
  vite: (env) => ({
    define: { __FADEWISE_VERIFY__: JSON.stringify(env.mode === 'verify') },
    plugins: [bundleReport()],
  }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const out of Object.keys(WORKLETS) as WorkletPath[])
        files.push({ relativeDest: out, contents: workletJs(out) });
    },
    'prepare:publicPaths': (_wxt, paths) => {
      paths.push(...Object.keys(WORKLETS));
    },
  },
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: '116',
    permissions: ['storage'],
    // the toolbar icon is 16dp: one drawing per display scale (1x, 1.25x, 1.5x, 2x)
    action: {
      default_title: EXTENSION_NAME,
      default_icon: { 16: 'icon/16.png', 20: 'icon/20.png', 24: 'icon/24.png', 32: 'icon/32.png' },
    },
    commands: {
      'toggle-all': { suggested_key: { default: 'Alt+Shift+F' }, description: '__MSG_cmdToggleAll__' },
      'toggle-track': { suggested_key: { default: 'Alt+Shift+X' }, description: '__MSG_cmdToggleTrack__' },
    },
    // the page (MAIN world) loads the AudioWorklet modules by URL
    web_accessible_resources: [
      { resources: ['audio/meter-worklet.js', 'audio/overlap-worklet.js'], matches: ['https://music.youtube.com/*'] },
    ],
  },
});
