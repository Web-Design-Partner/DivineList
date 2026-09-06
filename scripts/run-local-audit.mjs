import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length === 3 && process.argv[2] === '--help') {
  process.stdout.write(
    'Lokal offlinekörning: node scripts/run-local-audit.mjs <batch.json> --at <ISO-tid> --run <körnamn>\nSkriver bara reports/local-runs/<körnamn>. Ingen insamling, runtimeimport eller aktiv Obsidian-skrivning.\n',
  );
} else {
  try {
    // Bundle in memory so running this workflow does not change release artifacts.
    const result = await build({
      entryPoints: [resolve(projectRoot, 'scripts/run-local-audit.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'warning',
    });
    const worker = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
    );
    const options = worker.parseLocalAuditArguments(process.argv.slice(2));
    const report = await worker.runLocalAudit(options, projectRoot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'BLOCKED',
          workflowCompleted: false,
          productionReady: false,
          dataGateStatus: 'not_assessed',
          message:
            error instanceof Error
              ? error.message
              : 'Körningen kunde inte verifieras.',
          partialRunMayExist: true,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
  }
}
