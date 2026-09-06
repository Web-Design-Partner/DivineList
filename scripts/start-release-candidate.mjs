import { runLocalServer } from './start-local.mjs';

if (
  process.env.DIVINELIST_RELEASE_CHECK !== 'true' ||
  process.env.DIVINELIST_RELEASE_SMOKE !== 'true'
) {
  console.error(
    'Den interna kandidatstarten får endast användas av DivineLists release-smoketest.',
  );
  process.exitCode = 1;
} else {
  try {
    await runLocalServer(process.argv.slice(2), {
      requireReleaseAttestation: false,
    });
  } catch (error) {
    console.error(
      `Releasekandidaten kunde inte startas: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
