// getModuleIds() includes tree-shaken modules.
import fs from 'node:fs';
import type { Plugin } from 'vite';

export function bundleReport(): Plugin {
  const out = process.env.FADEWISE_BUNDLE_REPORT;

  return {
    name: 'fadewise-bundle-report',
    apply: 'build',
    buildEnd() {
      if (!out) return;
      fs.appendFileSync(out, JSON.stringify([...this.getModuleIds()]) + '\n');
    },
  };
}
