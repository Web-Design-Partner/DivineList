import { createStationServer } from './station/server.mjs';
import { PROJECT_ROOT } from './build-manifest-lib.mjs';

const args = process.argv.slice(2);
const port =
  args.length === 0
    ? 8790
    : args.length === 2 && args[0] === '--port' && /^\d{1,5}$/u.test(args[1])
      ? Number(args[1])
      : 0;
if (port < 1 || port > 65535) {
  console.error(
    'Använd node scripts/start-station.mjs [--port 8790]. Endast 127.0.0.1 används.',
  );
  process.exitCode = 1;
} else {
  let app;
  try {
    app = await createStationServer({ root: PROJECT_ROOT });
    await new Promise((resolveListen, reject) => {
      app.server.once('error', reject);
      app.server.listen(port, '127.0.0.1', resolveListen);
    });
    console.log(
      `DivineList Skeppet: http://127.0.0.1:${port}/\nInga uppdrag startas automatiskt. Ctrl+C stoppar stationen.`,
    );
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await app.close();
    };
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        void shutdown().catch((error) => {
          console.error(error.message);
          process.exitCode = 1;
        });
      });
  } catch (error) {
    console.error(`Skeppet kunde inte startas: ${error.message}`);
    if (app) await app.close();
    process.exitCode = 1;
  }
}
