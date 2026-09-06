import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  BUILD_MANIFEST_PATH,
  PROJECT_ROOT,
  createBuildManifest,
} from './build-manifest-lib.mjs';

const target = resolve(PROJECT_ROOT, BUILD_MANIFEST_PATH);
const temporary = `${target}.tmp-${process.pid}`;
const manifest = await createBuildManifest();

await mkdir(dirname(target), { recursive: true });
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await rm(target, { force: true });
await rename(temporary, target);

process.stdout.write(
  `${JSON.stringify({
    status: 'PASS',
    manifestPath: target,
    sourceFingerprint: manifest.sourceFingerprint,
    sourceFileCount: manifest.files.length,
    manifestHash: manifest.manifestHash,
  })}\n`,
);
