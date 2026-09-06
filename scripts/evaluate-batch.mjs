import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { build } from 'esbuild';

await mkdir('dist/cli', { recursive: true });
await build({
  entryPoints: ['scripts/evaluate-batch.ts'],
  outfile: 'dist/cli/evaluate-batch.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: 'inline',
  logLevel: 'warning',
});

const result = spawnSync(
  process.execPath,
  ['dist/cli/evaluate-batch.mjs', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
