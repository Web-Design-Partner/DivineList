import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainMetadata, readPlainDirectory } from './lib/local-filesystem.mjs';

export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const BUILD_MANIFEST_SCHEMA = 'divinelist.local-build.v1';
export const BUILD_MANIFEST_PATH = 'dist/divinelist-build-manifest-v1.json';

const SOURCE_INPUTS = [
  '.github/workflows/ci.yml',
  '.openai/hosting.json',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'app',
  'components',
  'components.json',
  'hooks',
  'lib',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'proxy.ts',
  'public',
  'run-divinelist.ps1',
  'run-station.ps1',
  'scripts',
  'station',
  'tests',
  'tsconfig.json',
  'vite.config.ts',
  'windows-launcher',
  'docs/PORTABLE.md',
];

const sha256 = (content) =>
  `sha256:${createHash('sha256').update(content).digest('hex')}`;

export const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
};

const toPortablePath = (path) => path.replaceAll('\\', '/');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const collectFiles = async (absolutePath, files) => {
  const metadata = await plainMetadata(absolutePath);
  if (metadata.isFile()) {
    files.push(absolutePath);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Byggindata har en otillåten filtyp: ${absolutePath}`);
  }
  const entries = await readPlainDirectory(absolutePath);
  for (const entry of entries) {
    await collectFiles(resolve(absolutePath, entry.name), files);
  }
};

export const createSourceSnapshot = async (projectRoot = PROJECT_ROOT) => {
  const absoluteFiles = [];
  for (const input of SOURCE_INPUTS) {
    await collectFiles(resolve(projectRoot, input), absoluteFiles);
  }
  const files = [];
  for (const absolutePath of absoluteFiles) {
    const content = await readFile(absolutePath);
    const path = toPortablePath(relative(projectRoot, absolutePath));
    if (path.startsWith('../') || path === '..') {
      throw new Error(
        `Byggindata ligger utanför projektroten: ${absolutePath}`,
      );
    }
    files.push({ path, bytes: content.byteLength, sha256: sha256(content) });
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    sourceFingerprint: sha256(canonicalJson(files)),
    files,
  };
};

export const createBuildManifest = async (
  projectRoot = PROJECT_ROOT,
  generatedAt = new Date().toISOString(),
) => {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
  );
  const snapshot = await createSourceSnapshot(projectRoot);
  const payload = {
    schema: BUILD_MANIFEST_SCHEMA,
    appVersion: packageJson.version,
    generatedAt,
    ...snapshot,
  };
  return { ...payload, manifestHash: sha256(canonicalJson(payload)) };
};

export const verifyBuildManifest = async (
  manifest,
  projectRoot = PROJECT_ROOT,
) => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Byggmanifestet måste vara ett JSON-objekt.');
  }
  const { manifestHash, ...payload } = manifest;
  if (manifest.schema !== BUILD_MANIFEST_SCHEMA) {
    throw new Error(`Okänd byggmanifestversion: ${String(manifest.schema)}`);
  }
  if (typeof manifestHash !== 'string') {
    throw new Error('Byggmanifestet saknar manifestHash.');
  }
  if (sha256(canonicalJson(payload)) !== manifestHash) {
    throw new Error('Byggmanifestets integritetshash stämmer inte.');
  }
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
  );
  if (manifest.appVersion !== packageJson.version) {
    throw new Error('Byggmanifestet gäller en annan appversion.');
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) {
    throw new Error('Byggmanifestets generatedAt är ogiltigt.');
  }
  const current = await createSourceSnapshot(projectRoot);
  if (
    manifest.sourceFingerprint !== current.sourceFingerprint ||
    canonicalJson(manifest.files) !== canonicalJson(current.files)
  ) {
    throw new Error(
      'Produktionsbygget är äldre än den aktuella källkoden. Kör `npm run build`.',
    );
  }
  return current;
};

export const sha256Bytes = sha256;
