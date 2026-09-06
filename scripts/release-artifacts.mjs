import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import { plainMetadata, readPlainDirectory } from './lib/local-filesystem.mjs';

import {
  BUILD_MANIFEST_PATH,
  PROJECT_ROOT,
  sha256Bytes,
  verifyBuildManifest,
} from './build-manifest-lib.mjs';

const CONTRACT_FILES = [
  'divinelist-contract-manifest.json',
  'divinelist-dataset-hash-v2.json',
  'divinelist-evaluation-policy-v2.json',
  'divinelist-facts-v2.json',
  'divinelist-rules-v2.json',
];
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const readStrictJson = async (path) => {
  const content = await readFile(path);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  return { value: JSON.parse(text), content };
};

const assertFile = async (path, label) => {
  let metadata;
  try {
    metadata = await plainMetadata(path);
  } catch {
    throw new Error(`${label} saknas: ${path}`);
  }
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`${label} är inte en icke-tom vanlig fil: ${path}`);
  }
  return metadata;
};

const collectJavaScriptFiles = async (root, files = []) => {
  const entries = await readPlainDirectory(root);
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.kind === 'directory') await collectJavaScriptFiles(path, files);
    else if (entry.kind === 'file' && entry.name.endsWith('.js'))
      files.push(path);
  }
  return files;
};

const hashArtifact = async (path, projectRoot) => {
  const content = await readFile(path);
  return {
    path: relative(projectRoot, path).replaceAll('\\', '/'),
    bytes: content.byteLength,
    sha256: sha256Bytes(content),
  };
};

const inspectReleaseArtifactsOnce = async (projectRoot) => {
  const serverRoot = resolve(projectRoot, 'dist/server');
  const clientRoot = resolve(projectRoot, 'dist/client');
  const contractsRoot = resolve(projectRoot, 'dist/contracts-v23-final');
  const wranglerPath = resolve(serverRoot, 'wrangler.json');
  const serverEntryPath = resolve(serverRoot, 'index.js');
  const buildIdPath = resolve(serverRoot, 'BUILD_ID');
  const buildManifestPath = resolve(projectRoot, BUILD_MANIFEST_PATH);

  for (const root of [serverRoot, clientRoot, contractsRoot]) {
    if (!(await plainMetadata(root)).isDirectory()) {
      throw new Error('Byggartefakternas katalog saknas: ' + root);
    }
  }

  await assertFile(wranglerPath, 'Wrangler-konfigurationen');
  await assertFile(serverEntryPath, 'Serveringången');
  await assertFile(buildIdPath, 'BUILD_ID');
  await assertFile(buildManifestPath, 'Byggmanifestet');

  const { value: wrangler } = await readStrictJson(wranglerPath);
  if (
    wrangler.name !== 'divinelist' ||
    wrangler.main !== 'index.js' ||
    wrangler.assets?.directory !== '../client' ||
    wrangler.dev?.ip !== '127.0.0.1'
  ) {
    throw new Error(
      'Wrangler-konfigurationen matchar inte den lokala releasemodellen.',
    );
  }
  for (const field of [
    'd1_databases',
    'r2_buckets',
    'services',
    'hyperdrive',
    'send_email',
  ]) {
    if (!Array.isArray(wrangler[field]) || wrangler[field].length !== 0) {
      throw new Error(`Wrangler-konfigurationen innehåller oväntade ${field}.`);
    }
  }
  if (
    !wrangler.queues ||
    !Array.isArray(wrangler.queues.producers) ||
    wrangler.queues.producers.length !== 0 ||
    !Array.isArray(wrangler.queues.consumers) ||
    wrangler.queues.consumers.length !== 0
  ) {
    throw new Error('Wrangler-konfigurationen innehåller oväntade queues.');
  }
  if (
    !wrangler.vars ||
    typeof wrangler.vars !== 'object' ||
    Array.isArray(wrangler.vars) ||
    Object.keys(wrangler.vars).length !== 0
  ) {
    throw new Error('Wrangler-konfigurationen innehåller oväntade variabler.');
  }

  const buildId = (await readFile(buildIdPath, 'utf8')).trim();
  if (!/^[a-zA-Z0-9-]{1,128}$/u.test(buildId)) {
    throw new Error('BUILD_ID har ett ogiltigt format.');
  }

  const contractEntries = await readPlainDirectory(contractsRoot);
  const actualContractFiles = contractEntries
    .map((entry) => entry.name)
    .sort(compareText);
  if (JSON.stringify(actualContractFiles) !== JSON.stringify(CONTRACT_FILES)) {
    throw new Error(
      'Kontraktspaketet innehåller saknade eller oväntade filer.',
    );
  }
  if (contractEntries.some((entry) => entry.kind !== 'file')) {
    throw new Error('Kontraktspaketet får endast innehålla kontraktsfiler.');
  }

  const contractPaths = Object.fromEntries(
    CONTRACT_FILES.map((name) => [name, resolve(contractsRoot, name)]),
  );
  for (const [name, path] of Object.entries(contractPaths)) {
    await assertFile(path, `Kontraktet ${name}`);
  }
  const { value: contractManifest } = await readStrictJson(
    contractPaths['divinelist-contract-manifest.json'],
  );
  const { value: factContract } = await readStrictJson(
    contractPaths['divinelist-facts-v2.json'],
  );
  const { value: ruleContract } = await readStrictJson(
    contractPaths['divinelist-rules-v2.json'],
  );
  const { value: evaluationPolicy } = await readStrictJson(
    contractPaths['divinelist-evaluation-policy-v2.json'],
  );
  const { value: datasetHashContract } = await readStrictJson(
    contractPaths['divinelist-dataset-hash-v2.json'],
  );

  if (
    contractManifest.version !== 'divinelist.contracts.v2' ||
    contractManifest.factCount !== 128 ||
    contractManifest.ruleCount !== 120 ||
    factContract.facts?.length !== contractManifest.factCount ||
    ruleContract.rules?.length !== contractManifest.ruleCount ||
    evaluationPolicy.version !== contractManifest.evaluationPolicyVersion ||
    datasetHashContract.evaluationPolicyHash !==
      contractManifest.evaluationPolicyHash ||
    contractManifest.guardrails?.externalCollection !== false ||
    contractManifest.guardrails?.outreach !== false ||
    contractManifest.guardrails?.externalWrites !== false
  ) {
    throw new Error(
      'Det exporterade kontraktspaketets bindningar stämmer inte.',
    );
  }

  const { value: buildManifest } = await readStrictJson(buildManifestPath);
  await verifyBuildManifest(buildManifest, projectRoot);

  const clientJavaScript = await collectJavaScriptFiles(clientRoot);
  if (clientJavaScript.length === 0) {
    throw new Error(
      'Produktionsbygget saknar JavaScriptresurser för klienten.',
    );
  }
  for (const path of clientJavaScript) {
    await assertFile(path, 'Klientresurs');
  }

  const artifactPaths = [
    wranglerPath,
    serverEntryPath,
    buildIdPath,
    buildManifestPath,
    ...Object.values(contractPaths),
    ...[
      'manifest.json',
      'index.html',
      'assets/station.js',
      'assets/station.css',
    ].map((name) => resolve(projectRoot, 'dist/station', name)),
  ];
  const files = [];
  for (const path of artifactPaths)
    files.push(await hashArtifact(path, projectRoot));
  files.sort((left, right) => compareText(left.path, right.path));
  const artifactSetHash = `sha256:${createHash('sha256')
    .update(JSON.stringify(files))
    .digest('hex')}`;

  return {
    buildId,
    sourceFingerprint: buildManifest.sourceFingerprint,
    sourceFileCount: buildManifest.files.length,
    clientJavaScriptFiles: clientJavaScript.length,
    contractFiles: CONTRACT_FILES.length,
    artifactSetHash,
    files,
  };
};

export const inspectReleaseArtifacts = async (projectRoot = PROJECT_ROOT) => {
  let lastError;
  for (const retryDelay of [0, 100, 250]) {
    if (retryDelay > 0) await delay(retryDelay);
    try {
      return await inspectReleaseArtifactsOnce(projectRoot);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${lastError instanceof Error ? lastError.message : String(lastError)} (Verifieringen misslyckades i tre separata läsningar.)`,
  );
};
