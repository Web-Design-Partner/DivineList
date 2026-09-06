import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from './build-manifest-lib.mjs';

const out = resolve(PROJECT_ROOT, 'dist/station');
await mkdir(resolve(out, 'assets'), { recursive: true });
await build({
  entryPoints: [resolve(PROJECT_ROOT, 'station/main.tsx')],
  outfile: resolve(out, 'assets/station.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
await writeFile(
  resolve(out, 'index.html'),
  await readFile(resolve(PROJECT_ROOT, 'station/index.html')),
);
const files = [];
for (const path of ['index.html', 'assets/station.js', 'assets/station.css']) {
  const content = await readFile(resolve(out, path));
  files.push({
    path,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}
await writeFile(
  resolve(out, 'manifest.json'),
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: 'PASS',
    stationAssets: files.length,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
  }),
);
