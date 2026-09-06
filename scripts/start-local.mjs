import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT } from './build-manifest-lib.mjs';
import { inspectReleaseArtifacts } from './release-artifacts.mjs';
import { verifyReleaseReport } from './verify-release-report.mjs';

export const LOCAL_IP = '127.0.0.1';
export const DEFAULT_PORT = 8787;

const readOptionValue = (arguments_, index, name) => {
  const argument = arguments_[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) {
    return { value: argument.slice(prefix.length), used: 1 };
  }
  if (argument === name) {
    const value = arguments_[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`${name} kräver ett värde.`);
    }
    return { value, used: 2 };
  }
  return undefined;
};

export const parseStartArguments = (arguments_) => {
  let port = DEFAULT_PORT;
  let portSeen = false;
  let ipSeen = false;
  for (let index = 0; index < arguments_.length;) {
    const portOption = readOptionValue(arguments_, index, '--port');
    if (portOption) {
      if (portSeen) throw new Error('--port får bara anges en gång.');
      if (!/^\d{1,5}$/u.test(portOption.value)) {
        throw new Error('--port måste vara ett heltal mellan 1 och 65535.');
      }
      port = Number(portOption.value);
      if (port < 1 || port > 65_535) {
        throw new Error('--port måste vara ett heltal mellan 1 och 65535.');
      }
      portSeen = true;
      index += portOption.used;
      continue;
    }
    const ipOption = readOptionValue(arguments_, index, '--ip');
    if (ipOption) {
      if (ipSeen) throw new Error('--ip får bara anges en gång.');
      if (ipOption.value !== LOCAL_IP) {
        throw new Error(
          `DivineList får bara bindas lokalt till ${LOCAL_IP}; ${ipOption.value} stoppades.`,
        );
      }
      ipSeen = true;
      index += ipOption.used;
      continue;
    }
    throw new Error(
      `Startargumentet ${arguments_[index]} stöds inte. Endast --port och --ip=${LOCAL_IP} är tillåtna.`,
    );
  }
  return { ip: LOCAL_IP, port };
};

export const assertPortAvailable = (port, ip = LOCAL_IP) =>
  new Promise((resolveAvailable, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} används redan på ${ip}. Stoppa den andra processen eller välj en annan port.`,
          ),
        );
        return;
      }
      reject(error);
    });
    probe.listen({ host: ip, port, exclusive: true }, () => {
      probe.close((error) => (error ? reject(error) : resolveAvailable()));
    });
  });

export const createWranglerArguments = (
  { ip, port },
  wrangler,
  wranglerConfig,
) => [
  wrangler,
  'dev',
  '--config',
  wranglerConfig,
  '--local',
  '--show-interactive-dev-session=false',
  '--ip',
  ip,
  '--inspector-ip',
  ip,
  '--port',
  String(port),
];

export const runLocalServer = async (
  arguments_ = process.argv.slice(2),
  { requireReleaseAttestation = true } = {},
) => {
  const { ip, port } = parseStartArguments(arguments_);
  await assertPortAvailable(port, ip);
  if (requireReleaseAttestation) await verifyReleaseReport();
  else await inspectReleaseArtifacts(PROJECT_ROOT);

  const wrangler = resolve(
    PROJECT_ROOT,
    'node_modules/wrangler/bin/wrangler.js',
  );
  const wranglerConfig = resolve(PROJECT_ROOT, 'dist/server/wrangler.json');
  if (!existsSync(wrangler)) {
    throw new Error(
      'Wrangler saknas i node_modules. Kör `npm ci` och försök igen.',
    );
  }
  const child = spawn(
    process.execPath,
    createWranglerArguments({ ip, port }, wrangler, wranglerConfig),
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        WRANGLER_SEND_ERROR_REPORTS: 'false',
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
        X_LOCAL_EXPLORER: 'false',
        X_LOCAL_OBSERVABILITY: 'false',
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  let forwardedSignal;
  const signalHandlers = new Map();
  const forwardSignal = (signal) => {
    forwardedSignal ??= signal;
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => forwardSignal(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  };

  child.once('error', (error) => {
    removeSignalHandlers();
    console.error(
      `Kunde inte starta den lokala produktionsservern: ${error.message}`,
    );
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    removeSignalHandlers();
    process.exitCode = forwardedSignal ? 0 : (code ?? (signal ? 1 : 0));
  });
  return child;
};

const isMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    await runLocalServer();
  } catch (error) {
    console.error(
      `DivineList kunde inte startas: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
