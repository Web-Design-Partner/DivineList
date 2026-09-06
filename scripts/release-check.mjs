import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT, canonicalJson } from './build-manifest-lib.mjs';
import { inspectReleaseArtifacts } from './release-artifacts.mjs';

export const RELEASE_REPORT_SCHEMA = 'divinelist.release-check.v1';
export const RELEASE_REPORT_PATH = 'dist/divinelist-release-check-v1.json';
export const RELEASE_STEP_IDS = [
  'audit-tests',
  'release-automation-tests',
  'typecheck',
  'lint',
  'format',
  'build',
  'release-artifacts',
  'production-smoke',
];
export const RELEASE_STEP_COMMANDS = {
  'audit-tests': 'npm run test:audit',
  'release-automation-tests': 'npm run test:release',
  typecheck: 'npm run typecheck',
  lint: 'npm run lint',
  format: 'npm run format:check',
  build: 'npm run build',
  'release-artifacts': 'npm run verify:release',
  'production-smoke': 'npm run smoke:production',
};

const STEP_SCRIPTS = [
  ['audit-tests', 'test:audit'],
  ['release-automation-tests', 'test:release'],
  ['typecheck', 'typecheck'],
  ['lint', 'lint'],
  ['format', 'format:check'],
  ['build', 'build'],
  ['release-artifacts', 'verify:release'],
  ['production-smoke', 'smoke:production'],
];

const sha256 = (value) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const resolveNpmCli = () => {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (!npmCli) {
    throw new Error(
      'npm CLI kunde inte hittas. Kör kontrollen genom `npm run check`.',
    );
  }
  return npmCli;
};

const writeReport = async (report) => {
  const target = resolve(PROJECT_ROOT, RELEASE_REPORT_PATH);
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rm(target, { force: true });
  await rename(temporary, target);
  return target;
};

export const createReleaseReport = ({
  appVersion,
  startedAt,
  steps,
  artifacts,
  error,
}) => {
  const status = error ? 'FAIL' : 'PASS';
  const payload = {
    schema: RELEASE_REPORT_SCHEMA,
    appVersion,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    steps,
    ...(artifacts ? { artifacts } : {}),
    ...(error ? { error } : {}),
  };
  return { ...payload, reportHash: sha256(canonicalJson(payload)) };
};

export const runReleaseCheck = async () => {
  const startedAt = new Date().toISOString();
  const steps = [];
  let failure;
  let artifacts;
  const packageJson = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, 'package.json'), 'utf8'),
  );

  try {
    const npmCli = resolveNpmCli();
    for (const [id, script] of STEP_SCRIPTS) {
      const stepStarted = Date.now();
      const result = spawnSync(process.execPath, [npmCli, 'run', script], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          DIVINELIST_RELEASE_CHECK: 'true',
          WRANGLER_SEND_ERROR_REPORTS: 'false',
          WRANGLER_SEND_METRICS: 'false',
          WRANGLER_WRITE_LOGS: 'false',
        },
        stdio: 'inherit',
      });
      const exitCode = result.status ?? 1;
      const step = {
        id,
        command: RELEASE_STEP_COMMANDS[id],
        status: exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode,
        durationMs: Date.now() - stepStarted,
      };
      steps.push(step);
      if (exitCode !== 0) {
        failure =
          result.error?.message ??
          (result.signal
            ? `${step.command} avbröts av ${result.signal}.`
            : `${step.command} avslutades med exitkod ${exitCode}.`);
        break;
      }
    }
    if (!failure) artifacts = await inspectReleaseArtifacts(PROJECT_ROOT);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const report = createReleaseReport({
    appVersion: packageJson.version,
    startedAt,
    steps,
    artifacts,
    error: failure,
  });
  const reportPath = await writeReport(report);
  process.stdout.write(
    `${JSON.stringify({
      schema: report.schema,
      status: report.status,
      reportPath,
      reportHash: report.reportHash,
      steps: report.steps.map(({ id, status, exitCode, durationMs }) => ({
        id,
        status,
        exitCode,
        durationMs,
      })),
      ...(artifacts
        ? {
            buildId: artifacts.buildId,
            sourceFingerprint: artifacts.sourceFingerprint,
            artifactSetHash: artifacts.artifactSetHash,
          }
        : {}),
      ...(failure ? { error: failure } : {}),
    })}\n`,
  );
  process.exitCode = failure ? 1 : 0;
  return report;
};

const isMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await runReleaseCheck();
