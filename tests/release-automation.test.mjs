import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_PORT,
  LOCAL_IP,
  assertPortAvailable,
  createWranglerArguments,
  parseStartArguments,
} from '../scripts/start-local.mjs';
import {
  PROJECT_ROOT,
  canonicalJson,
  createSourceSnapshot,
  sha256Bytes,
} from '../scripts/build-manifest-lib.mjs';
import {
  RELEASE_REPORT_SCHEMA,
  RELEASE_STEP_IDS,
  createReleaseReport,
} from '../scripts/release-check.mjs';

const listen = (server, port = 0) =>
  new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen({ host: LOCAL_IP, port, exclusive: true }, () =>
      resolveListen(),
    );
  });

const close = (server) =>
  new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });

test('den lokala startparsern använder en fast loopback-adress och standardport', () => {
  assert.deepEqual(parseStartArguments([]), {
    ip: LOCAL_IP,
    port: DEFAULT_PORT,
  });
  assert.deepEqual(parseStartArguments(['--port', '3006']), {
    ip: LOCAL_IP,
    port: 3006,
  });
  assert.deepEqual(parseStartArguments(['--port=65535', '--ip=127.0.0.1']), {
    ip: LOCAL_IP,
    port: 65_535,
  });
});

test('Wrangler-starten är lokal, icke-interaktiv och har loopback-inspektör', () => {
  const arguments_ = createWranglerArguments(
    { ip: LOCAL_IP, port: 3006 },
    'wrangler.js',
    'wrangler.json',
  );
  assert.deepEqual(arguments_, [
    'wrangler.js',
    'dev',
    '--config',
    'wrangler.json',
    '--local',
    '--show-interactive-dev-session=false',
    '--ip',
    LOCAL_IP,
    '--inspector-ip',
    LOCAL_IP,
    '--port',
    '3006',
  ]);
  assert.ok(!arguments_.includes('--remote'));
  assert.ok(!arguments_.includes('--tunnel'));
});

test('startparsern stoppar LAN, remote, configöverskrivning och ogiltiga portar', () => {
  for (const arguments_ of [
    ['--ip', '0.0.0.0'],
    ['--ip=::'],
    ['--remote'],
    ['--config', 'annan.json'],
    ['--port', '0'],
    ['--port=65536'],
    ['--port', '12.5'],
    ['--port'],
    ['--port', '3006', '--port', '3007'],
    ['--ip=127.0.0.1', '--ip=127.0.0.1'],
  ]) {
    assert.throws(() => parseStartArguments(arguments_));
  }
});

test('portgrinden stoppar en upptagen port och godkänner en släppt port', async () => {
  const server = createServer();
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await assert.rejects(assertPortAvailable(address.port), /används redan/u);
  await close(server);
  await assert.doesNotReject(assertPortAvailable(address.port));
});

test('källsnapshoten är deterministisk, portabel och projektbunden', async () => {
  const first = await createSourceSnapshot(PROJECT_ROOT);
  const second = await createSourceSnapshot(PROJECT_ROOT);
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.equal(canonicalJson(first.files), canonicalJson(second.files));
  assert.ok(first.files.length > 20);
  assert.ok(first.files.some((file) => file.path === 'package-lock.json'));
  assert.ok(
    first.files.some((file) => file.path === '.github/workflows/ci.yml'),
  );
  assert.ok(first.files.some((file) => file.path === '.oxlintrc.json'));
  assert.ok(
    first.files.some((file) => file.path === 'tests/audit-engine.test.ts'),
  );
  assert.ok(
    first.files.some((file) => file.path === 'scripts/start-local.mjs'),
  );
  for (const file of first.files) {
    assert.doesNotMatch(file.path, /\\/u);
    assert.doesNotMatch(file.path, /^\.\.\//u);
    assert.match(file.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(Number.isInteger(file.bytes) && file.bytes >= 0);
  }
  const changedQualityInputs = first.files.map((file) =>
    file.path === 'tests/audit-engine.test.ts'
      ? { ...file, sha256: `sha256:${'0'.repeat(64)}` }
      : file,
  );
  assert.equal(
    first.sourceFingerprint,
    sha256Bytes(canonicalJson(first.files)),
  );
  assert.notEqual(
    first.sourceFingerprint,
    sha256Bytes(canonicalJson(changedQualityInputs)),
  );
});

test('normal launcher kräver aktuell PASS-attest och kandidaten är intern', async () => {
  const launcher = await readFile(
    resolve(PROJECT_ROOT, 'run-divinelist.ps1'),
    'utf8',
  );
  const startLocal = await readFile(
    resolve(PROJECT_ROOT, 'scripts/start-local.mjs'),
    'utf8',
  );
  assert.match(launcher, /verify-release-report\.mjs --silent/u);
  assert.match(launcher, /Kör npm run check/u);
  assert.doesNotMatch(launcher, /npm run build/u);
  assert.match(startLocal, /requireReleaseAttestation = true/u);
  assert.match(startLocal, /await verifyReleaseReport\(\)/u);

  const candidate = spawnSync(
    process.execPath,
    [resolve(PROJECT_ROOT, 'scripts/start-release-candidate.mjs')],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DIVINELIST_RELEASE_CHECK: 'false',
        DIVINELIST_RELEASE_SMOKE: 'false',
      },
    },
  );
  assert.notEqual(candidate.status, 0);
  assert.match(
    `${candidate.stdout}${candidate.stderr}`,
    /endast användas av DivineLists release-smoketest/u,
  );
});

test('releaseattesten binder exakt ordnade steg och ändras vid manipulation', () => {
  const steps = RELEASE_STEP_IDS.map((id) => ({
    id,
    command: `npm run ${id}`,
    status: 'PASS',
    exitCode: 0,
    durationMs: 1,
  }));
  const report = createReleaseReport({
    appVersion: '2.3.0',
    startedAt: '2026-09-01T00:00:00.000Z',
    steps,
    artifacts: { sourceFingerprint: 'sha256:test' },
  });
  assert.equal(report.schema, RELEASE_REPORT_SCHEMA);
  assert.equal(report.status, 'PASS');
  assert.match(report.reportHash, /^sha256:[a-f0-9]{64}$/u);
  const changed = createReleaseReport({
    appVersion: '2.3.0',
    startedAt: '2026-09-01T00:00:00.000Z',
    steps: steps.map((step, index) =>
      index === 0 ? { ...step, exitCode: 1, status: 'FAIL' } : step,
    ),
    error: 'testfel',
  });
  assert.equal(changed.status, 'FAIL');
  assert.notEqual(changed.reportHash, report.reportHash);
});
