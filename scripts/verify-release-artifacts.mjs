import { inspectReleaseArtifacts } from './release-artifacts.mjs';

const silent = process.argv.slice(2).includes('--silent');

try {
  const artifacts = await inspectReleaseArtifacts();
  if (!silent)
    process.stdout.write(
      `${JSON.stringify({ status: 'PASS', ...artifacts })}\n`,
    );
} catch (error) {
  if (!silent) {
    console.error(
      `Releaseartefakterna är inte användbara: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  process.exitCode = 1;
}
