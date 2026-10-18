import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Vite's ?inline CSS imports, for the tests that run the sources on node
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.css?inline')) return nextLoad(url, context);
    const css = readFileSync(new URL(url.slice(0, -'?inline'.length)), 'utf8');

    return { format: 'module', source: `export default ${JSON.stringify(css)};`, shortCircuit: true };
  },
});
