import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT, canonicalJson } from './build-manifest-lib.mjs';
import { inspectReleaseArtifacts } from './release-artifacts.mjs';
import {
  RELEASE_REPORT_PATH,
  RELEASE_REPORT_SCHEMA,
  RELEASE_STEP_COMMANDS,
  RELEASE_STEP_IDS,
} from './release-check.mjs';

const sha256 = (value) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export const verifyReleaseReport = async (
  reportPath = resolve(PROJECT_ROOT, RELEASE_REPORT_PATH),
) => {
  const path = resolve(reportPath);
  let content;
  try {
    content = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Releaseattesten saknas. Kör `npm run check`.');
    }
    throw error;
  }
  const report = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(content),
  );
  const packageJson = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, 'package.json'), 'utf8'),
  );
  const { reportHash, ...payload } = report;
  if (
    report.schema !== RELEASE_REPORT_SCHEMA ||
    report.appVersion !== packageJson.version ||
    report.status !== 'PASS' ||
    Object.hasOwn(report, 'error') ||
    typeof reportHash !== 'string' ||
    sha256(canonicalJson(payload)) !== reportHash
  ) {
    throw new Error(
      'Releaseattestens status, schema eller integritet är ogiltig.',
    );
  }
  if (
    JSON.stringify(report.steps.map((step) => step.id)) !==
      JSON.stringify(RELEASE_STEP_IDS) ||
    report.steps.some(
      (step) =>
        step.command !== RELEASE_STEP_COMMANDS[step.id] ||
        step.status !== 'PASS' ||
        step.exitCode !== 0 ||
        !Number.isInteger(step.durationMs) ||
        step.durationMs < 0,
    )
  ) {
    throw new Error('Releaseattesten saknar en godkänd eller ordnad kontroll.');
  }
  const startedAt = Date.parse(report.startedAt);
  const finishedAt = Date.parse(report.finishedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt ||
    finishedAt > Date.now() + 5 * 60 * 1000
  ) {
    throw new Error('Releaseattestens tidsintervall är ogiltigt.');
  }
  const artifacts = await inspectReleaseArtifacts(PROJECT_ROOT);
  if (canonicalJson(report.artifacts) !== canonicalJson(artifacts)) {
    throw new Error(
      'Releaseattesten gäller inte de nuvarande byggartefakterna.',
    );
  }
  return { path, reportHash, report, artifacts };
};

const isMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const arguments_ = process.argv.slice(2);
  const silent = arguments_.includes('--silent');
  const positional = arguments_.filter((argument) => argument !== '--silent');
  try {
    if (positional.length > 1) {
      throw new Error('Högst en sökväg till releaseattesten får anges.');
    }
    const result = await verifyReleaseReport(
      positional[0]
        ? resolve(PROJECT_ROOT, positional[0])
        : resolve(PROJECT_ROOT, RELEASE_REPORT_PATH),
    );
    if (!silent) {
      process.stdout.write(
        `${JSON.stringify({
          status: 'PASS',
          reportPath: result.path,
          reportHash: result.reportHash,
          buildId: result.artifacts.buildId,
          sourceFingerprint: result.artifacts.sourceFingerprint,
          artifactSetHash: result.artifacts.artifactSetHash,
        })}\n`,
      );
    }
  } catch (error) {
    if (!silent) {
      console.error(
        `Releaseattesten kunde inte verifieras: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    process.exitCode = 1;
  }
}
