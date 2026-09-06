import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Compile the shared TypeScript validator in memory; readiness never needs to
// overwrite a build or load a stale generated validator from dist.
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('./production-readiness.ts', import.meta.url)),
  ],
  absWorkingDir: process.cwd(),
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);
