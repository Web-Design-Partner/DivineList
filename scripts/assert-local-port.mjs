import { assertPortAvailable, parseStartArguments } from './start-local.mjs';

try {
  const arguments_ = process.argv.slice(2);
  const silent = arguments_.includes('--silent');
  const { ip, port } = parseStartArguments(
    arguments_.filter((argument) => argument !== '--silent'),
  );
  await assertPortAvailable(port, ip);
  if (!silent) {
    process.stdout.write(
      `${JSON.stringify({
        schema: 'divinelist.local-port.v1',
        status: 'PASS',
        ip,
        port,
      })}\n`,
    );
  }
} catch (error) {
  console.error(
    `Den lokala porten kan inte användas: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
