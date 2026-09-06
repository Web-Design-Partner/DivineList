import { inspectReleaseArtifacts } from './release-artifacts.mjs';
import { parseStartArguments } from './start-local.mjs';
import { verifyReleaseReport } from './verify-release-report.mjs';

let exitCode = 0;

try {
  const { ip, port } = parseStartArguments(process.argv.slice(2));
  const origin = `http://${ip}:${port}`;
  let buildStatus = 'PASS';
  let buildError;
  let releaseStatus = 'FAIL';
  let releaseError;
  let artifacts;
  try {
    artifacts = await inspectReleaseArtifacts();
  } catch (error) {
    buildStatus = 'FAIL';
    buildError = error instanceof Error ? error.message : String(error);
  }
  if (buildStatus === 'PASS') {
    try {
      const verified = await verifyReleaseReport();
      artifacts = verified.artifacts;
      releaseStatus = 'PASS';
    } catch (error) {
      releaseError = error instanceof Error ? error.message : String(error);
    }
  } else {
    releaseError = 'Byggartefakterna är inte verifierbara.';
  }

  let serverStatus = 'STOPPED';
  let httpStatus;
  let serverError;
  try {
    const response = await fetch(`${origin}/`, {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    });
    httpStatus = response.status;
    if (
      response.status === 200 &&
      response.headers.get('x-content-type-options') === 'nosniff' &&
      /(?:^|,)\s*noindex(?:,|$)/iu.test(
        response.headers.get('x-robots-tag') ?? '',
      )
    ) {
      serverStatus = 'RUNNING';
    } else {
      serverStatus = 'UNHEALTHY';
      serverError =
        'Servern svarade utan det förväntade lokala säkerhetskontraktet.';
    }
  } catch (error) {
    serverError = error instanceof Error ? error.message : String(error);
  }

  if (serverStatus !== 'RUNNING') exitCode = 3;
  else if (buildStatus !== 'PASS' || releaseStatus !== 'PASS') exitCode = 2;
  process.stdout.write(
    `${JSON.stringify({
      schema: 'divinelist.local-status.v1',
      status:
        serverStatus === 'RUNNING' &&
        buildStatus === 'PASS' &&
        releaseStatus === 'PASS'
          ? 'PASS'
          : 'FAIL',
      origin,
      serverStatus,
      buildStatus,
      releaseStatus,
      ...(httpStatus ? { httpStatus } : {}),
      ...(artifacts
        ? {
            buildId: artifacts.buildId,
            sourceFingerprint: artifacts.sourceFingerprint,
          }
        : {}),
      ...(buildError ? { buildError } : {}),
      ...(releaseError ? { releaseError } : {}),
      ...(serverError ? { serverError } : {}),
    })}\n`,
  );
} catch (error) {
  exitCode = 1;
  console.error(
    `Lokal status kunde inte kontrolleras: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

process.exitCode = exitCode;
