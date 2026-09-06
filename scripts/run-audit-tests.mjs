import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { build } from 'esbuild';

await mkdir('dist/tests', { recursive: true });
await build({
  entryPoints: ['tests/audit-engine.test.ts'],
  outfile: 'dist/tests/audit-engine.test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: 'inline',
  logLevel: 'warning',
});

const result = spawnSync(
  process.execPath,
  ['dist/tests/audit-engine.test.mjs'],
  {
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
