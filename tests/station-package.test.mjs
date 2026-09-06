import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const entry = resolve('scripts/portable-station-entry.mjs');

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'divinelist-package-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'dist/station/assets'), { recursive: true });
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    minify: true,
  });
  const content = {
    'DivineList.exe': 'launcher fixture only',
    'node.exe': 'runtime fixture only',
    'station-server.mjs': bundle.outputFiles[0].contents,
    'dist/station/index.html': '<!doctype html><title>Package fixture</title>',
    'dist/station/assets/station.js': '/* fixture */',
    'dist/station/assets/station.css': 'body{color:black}',
    'START-HERE.md':
      'Synthetic package test. No real research or vault writes.',
  };
  const metadata = (path, value) => {
    const bytes = Buffer.from(value);
    return {
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  content['dist/station/manifest.json'] = JSON.stringify({
    version: 1,
    files: ['index.html', 'assets/station.js', 'assets/station.css'].map(
      (path) => metadata(path, content[`dist/station/${path}`]),
    ),
  });
  for (const [path, bytes] of Object.entries(content))
    await writeFile(resolve(root, path), bytes);
  await writeFile(
    resolve(root, 'package-manifest.json'),
    JSON.stringify({
      version: 1,
      files: Object.entries(content).map(([path, bytes]) =>
        metadata(path, bytes),
      ),
    }),
  );
  const dataDir = resolve(root, 'user-data');
  return { root, dataDir };
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function launch(t, root, dataDir, port) {
  const token = randomBytes(16).toString('hex');
  const child = spawn(
    process.execPath,
    [
      resolve(root, 'station-server.mjs'),
      '--port',
      String(port),
      '--data-dir',
      dataDir,
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DIVINELIST_LAUNCH_TOKEN: token },
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code));
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.stdin.end('DIVINELIST_STOP\n');
      await exited;
    }
  });
  const ready = async () => {
    const until = Date.now() + 15_000;
    while (!output.includes(`DIVINELIST_READY:${token}:${port}`)) {
      if (child.exitCode !== null) throw new Error(output);
      if (Date.now() > until) {
        child.kill();
        throw new Error(`Packaged entry did not become ready: ${output}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  };
  return { child, ready, exited, output: () => output };
}

test('portable server runs from its package, persists outside program files, and exits with its launcher', async (t) => {
  const { root, dataDir } = await fixture(t);
  const port = await freePort();
  const process = launch(t, root, dataDir, port);
  await process.ready();
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/state`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(state.companies, []);
  assert.equal(state.running, false);
  const configured = await fetch(`${origin}/api/config`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-divinelist-token': state.csrfToken,
    },
    body: JSON.stringify({ goal: 10, model: 'qwen3:4b' }),
  });
  assert.equal(configured.status, 200);
  // An explicit tray quit must work even while the launcher still has its pipe open.
  process.child.stdin.write('DIVINELIST_STOP\n');
  assert.equal(await process.exited, 0);
  assert.match(process.output(), /DIVINELIST_STOPPED/u);
  const saved = JSON.parse(
    await readFile(resolve(dataDir, 'station-state.json'), 'utf8'),
  );
  assert.equal(saved.goal, 10);
  assert.deepEqual(saved.companies, []);
  await assert.rejects(stat(resolve(dataDir, 'process.lock')), {
    code: 'ENOENT',
  });
  await assert.rejects(stat(resolve(root, 'work')), { code: 'ENOENT' });
});

test('portable server does not remain alive after losing its launcher pipe', async (t) => {
  const { root, dataDir } = await fixture(t);
  const process = launch(t, root, dataDir, await freePort());
  await process.ready();
  process.child.stdin.end();
  assert.equal(await process.exited, 0);
  assert.match(process.output(), /DIVINELIST_STOPPED/u);
  await assert.rejects(stat(resolve(dataDir, 'process.lock')), {
    code: 'ENOENT',
  });
});

test('portable server rejects changed program resources before opening work data', async (t) => {
  const { root, dataDir } = await fixture(t);
  await writeFile(resolve(root, 'dist/station/assets/station.js'), 'modified');
  const process = launch(t, root, dataDir, await freePort());
  assert.equal(await process.exited, 1);
  assert.match(process.output(), /har ändrats/u);
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
});

test('portable server reports an occupied port and leaves the existing listener running', async (t) => {
  const { root, dataDir } = await fixture(t);
  const occupied = createServer((socket) => socket.end('existing listener'));
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise((resolveClose) => occupied.close(resolveClose)));
  const { port } = occupied.address();
  const process = launch(t, root, dataDir, port);
  assert.equal(await process.exited, 1);
  assert.match(process.output(), new RegExp(`Port ${port} används redan`, 'u'));
  assert.equal(occupied.listening, true);
  await assert.rejects(stat(resolve(dataDir, 'process.lock')), {
    code: 'ENOENT',
  });
});
