import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  symlink,
  readdir,
} from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { get } from 'node:http';
import { createStationServer } from '../scripts/station/server.mjs';
import { saveSourceEvidence } from '../scripts/station/storage.mjs';

async function fixture(t, available = true, overrides = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'divinelist-station-http-'));
  const calls = [];
  await mkdir(resolve(root, 'dist/station'), { recursive: true });
  await writeFile(
    resolve(root, 'dist/station/index.html'),
    '<!doctype html><title>DivineList</title>',
  );
  const dependencies = {
    discover: async () => {
      calls.push('discovery');
      return [];
    },
    inspectSite: async () => {
      throw new Error('unexpected inspect');
    },
    chat: async () => ({
      summary: 'Syntetiskt svar',
      suggestions: [],
      unknowns: [],
    }),
    probeOllama: async () => ({
      available,
      models: available ? ['qwen3:4b'] : [],
    }),
    ...overrides,
  };
  const app = await createStationServer({
    root,
    dependencies,
    requireBuild: false,
  });
  await new Promise((resolveListen) =>
    app.server.listen(0, '127.0.0.1', resolveListen),
  );
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const initial = await (await fetch(`${origin}/api/state`)).json();
  const post = (path, body, headers = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-divinelist-token': initial.csrfToken,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { app, root, origin, initial, post, calls };
}

async function untilIdle(app) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try {
      app.runtime.assertIdle();
      return;
    } catch {
      await sleep(5);
    }
  }
  assert.fail('Den syntetiska stationen blev inte klar.');
}

const testSeed = (id) => ({
  name: `Syntetiskt bolag ${id}`,
  domain: `synthetic-company-${id}.se`,
  sourceKind: 'openstreetmap',
  sourceUrl: `https://www.openstreetmap.org/node/${id}`,
  observedAt: '2026-09-06T10:00:00.000Z',
});

void test('HTTP Obsidian flow is inert on configure and read; explicit research writes and rereads source-bound notes', async (t) => {
  const { app, root, origin, initial, post } = await fixture(t, true, {
    discover: async () => [testSeed(201), testSeed(201)],
    inspectSite: async () => ({
      title: 'Syntetisk sida',
      statusCode: 200,
      capturedAt: '2026-09-06T10:01:00.000Z',
      sha256: `sha256:${'d'.repeat(64)}`,
    }),
  });
  assert.equal(initial.obsidian.configured, false);
  let automation = await post('/api/automation', { enabled: false });
  assert.equal(automation.status, 200);
  assert.equal((await automation.json()).autoWorkflow, false);
  automation = await post('/api/automation', { enabled: true });
  assert.equal(automation.status, 200);
  assert.equal((await automation.json()).autoWorkflow, true);
  const vaultPath = resolve(root, 'Synthetic Vault');
  await mkdir(resolve(vaultPath, '.obsidian'), { recursive: true });
  const configured = await post('/api/obsidian/config', {
    vaultPath,
    folder: 'Agentstation',
  });
  assert.equal(configured.status, 200);
  assert.equal((await configured.json()).obsidian.enabled, true);
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  assert.equal((await fetch(`${origin}/api/state`)).status, 200);
  assert.ok(
    Array.isArray(await (await fetch(`${origin}/api/obsidian/vaults`)).json()),
  );
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  await post('/api/config', { goal: 1 });
  assert.equal((await post('/api/control', { action: 'start' })).status, 200);
  await untilIdle(app);
  let state = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(state.companies.length, 1);
  assert.equal(state.companies[0].status, 'review');
  assert.equal(state.obsidian.companies[0].readBackVerified, true);
  const reportPath = state.obsidian.companies[0].reportPath;
  assert.match(await readFile(reportPath, 'utf8'), /Syntetisk sida/);
  const cardPath = state.obsidian.companies[0].cardPath;
  await writeFile(cardPath, 'Mina mänskliga anteckningar.\n');
  const again = await post('/api/obsidian/sync', {});
  assert.equal(again.status, 200);
  state = await again.json();
  assert.equal(state.obsidian.written, 0);
  assert.equal(state.obsidian.unchanged, 1);
  assert.equal(state.obsidian.companies[0].reportPath, reportPath);
  assert.equal(
    await readFile(cardPath, 'utf8'),
    'Mina mänskliga anteckningar.\n',
  );
  assert.equal(
    (await post('/api/obsidian/sync', { companies: [] })).status,
    400,
  );
});

void test('disabled Obsidian integration never writes on research and guarded endpoints reject unauthorized changes', async (t) => {
  const { app, root, post } = await fixture(t, true, {
    discover: async () => [{ ...testSeed(202), domain: null }],
  });
  const vaultPath = resolve(root, 'Synthetic Vault');
  await mkdir(resolve(vaultPath, '.obsidian'), { recursive: true });
  assert.equal(
    (
      await post(
        '/api/obsidian/config',
        { vaultPath, folder: 'Agentstation' },
        { 'x-divinelist-token': 'wrong' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post('/api/obsidian/config', {
        vaultPath,
        folder: 'Agentstation',
        enabled: false,
      })
    ).status,
    200,
  );
  await post('/api/config', { goal: 1 });
  await post('/api/control', { action: 'start' });
  await untilIdle(app);
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  assert.equal((await post('/api/obsidian/sync', {})).status, 409);
});

void test('Obsidian configuration and manual sync are rejected while the runtime is working', async (t) => {
  let finish;
  let entered;
  const started = new Promise((yes) => {
    entered = yes;
  });
  const source = new Promise((yes) => {
    finish = yes;
  });
  const { app, root, post } = await fixture(t, true, {
    discover: async () => {
      entered();
      return source;
    },
  });
  const vaultPath = resolve(root, 'Synthetic Vault');
  await mkdir(resolve(vaultPath, '.obsidian'), { recursive: true });
  await post('/api/control', { action: 'start' });
  await started;
  assert.equal(
    (await post('/api/obsidian/config', { vaultPath, folder: 'Agentstation' }))
      .status,
    409,
  );
  assert.equal((await post('/api/obsidian/sync', {})).status, 409);
  finish([]);
  await untilIdle(app);
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
});

void test('real bridge conflicts preserve manual reports while independent synthetic companies finish', async (t) => {
  let seeds = [testSeed(203)];
  const { app, root, post } = await fixture(t, true, {
    discover: async () => seeds,
    inspectSite: async () => ({
      title: 'Syntetiskt underlag',
      statusCode: 200,
    }),
  });
  const vaultPath = resolve(root, 'Synthetic Vault');
  await mkdir(resolve(vaultPath, '.obsidian'), { recursive: true });
  await post('/api/obsidian/config', { vaultPath, folder: 'Agentstation' });
  await post('/api/config', { goal: 1 });
  await post('/api/control', { action: 'start' });
  await untilIdle(app);
  const reportPath = app.obsidian.getState().companies[0].reportPath;
  await writeFile(reportPath, 'Min egen redigering av agentrapporten.\n');
  seeds = [testSeed(204)];
  await post('/api/config', { goal: 2 });
  await post('/api/control', { action: 'start' });
  await untilIdle(app);
  const state = app.runtime.getState();
  assert.equal(state.paused, false);
  assert.ok(state.companies.every((row) => row.status === 'review'));
  assert.equal(app.obsidian.getState().conflicts.length, 1);
  assert.equal(
    app.obsidian.getState().companies.filter((row) => row.readBackVerified)
      .length,
    1,
  );
  assert.equal(
    await readFile(reportPath, 'utf8'),
    'Min egen redigering av agentrapporten.\n',
  );
  assert.ok(
    state.events.some((row) => row.message.includes('skrivkonflikter')),
  );
});

void test('station restart restores Obsidian settings and saved drafts without starting writes', async (t) => {
  const { app, root, post } = await fixture(t);
  const vaultPath = resolve(root, 'Synthetic Vault');
  await mkdir(resolve(vaultPath, '.obsidian'), { recursive: true });
  await post('/api/obsidian/config', { vaultPath, folder: 'Agentstation' });
  await post('/api/import', {
    files: [
      {
        name: 'test.md',
        text: '---\nname: Syntetiskt provbolag\ndomain: synthetic-import.se\n---\n',
      },
    ],
  });
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  await app.close();
  const reopened = await createStationServer({
    root,
    requireBuild: false,
    dependencies: {
      discover: async () => [],
      inspectSite: async () => ({ title: 'syntetisk' }),
      chat: async () => ({
        summary: 'Syntetiskt utkast',
        suggestions: [],
        unknowns: [],
      }),
      probeOllama: async () => ({ available: true, models: ['qwen3:4b'] }),
    },
  });
  t.after(() => reopened.close());
  assert.equal(reopened.obsidian.getState().enabled, true);
  assert.equal(reopened.runtime.getState().paused, true);
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  await reopened.runtime.control('resume');
  await untilIdle(reopened);
  assert.equal(
    reopened.obsidian.getState().companies[0].readBackVerified,
    true,
  );
  await reopened.close();
});

void test('station starts inert, serves protected local UI and rejects arbitrary paths', async (t) => {
  const { origin, initial, calls } = await fixture(t);
  assert.equal(initial.running, false);
  assert.equal(initial.companies.length, 0);
  assert.deepEqual(calls, []);
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-security-policy'),
    /connect-src 'self'/u,
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${origin}/package.json`)).status, 404);
  const rejectedHost = await new Promise((resolveStatus, reject) => {
    get(
      `${origin}/api/state`,
      { headers: { host: 'evil.example' } },
      (response) => {
        response.resume();
        resolveStatus(response.statusCode);
      },
    ).on('error', reject);
  });
  assert.equal(rejectedHost, 403);
});

void test('station mutations require both exact origin and per-process token', async (t) => {
  const { origin, post } = await fixture(t);
  assert.equal(
    (
      await post(
        '/api/config',
        { model: 'qwen3:4b', goal: 5 },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await post('/api/config', { goal: 5 }, { 'x-divinelist-token': 'wrong' }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/control`, {
        method: 'POST',
        body: '{"action":"start"}',
      })
    ).status,
    403,
  );
  assert.equal(
    (await post('/api/config', { model: 'qwen3:4b', goal: 5 })).status,
    200,
  );
});

void test('missing model blocks start before research and exports are downloads only', async (t) => {
  const { origin, post, calls } = await fixture(t, false);
  assert.equal((await post('/api/control', { action: 'start' })).status, 503);
  assert.deepEqual(calls, []);
  const response = await fetch(`${origin}/api/export?format=markdown`);
  assert.match(response.headers.get('content-disposition'), /attachment/u);
  assert.match(response.headers.get('content-type'), /text\/markdown/u);
});

void test('one station owns one data directory and local command does not initiate discovery', async (t) => {
  const { root, post, calls } = await fixture(t);
  await assert.rejects(
    createStationServer({ root, requireBuild: false }),
    /redan/u,
  );
  const response = await post('/api/command', {
    role: 'scout',
    instruction: 'Förklara arbetsgången.',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  assert.equal((await response.json()).jobs[0].status, 'queued');
});

void test('source snapshots preserve exact bytes and reject changed files or directory links', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'divinelist-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('<html>Original källa</html>');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const facts = { sha256: `sha256:${hash}` };
  await saveSourceEvidence(root, bytes, facts);
  const file = resolve(root, `evidence/${hash}.html`);
  assert.deepEqual(await readFile(file), bytes);
  await saveSourceEvidence(root, bytes, facts);
  await writeFile(file, 'changed');
  await assert.rejects(saveSourceEvidence(root, bytes, facts), /ändrats/u);
  const linked = resolve(root, 'linked');
  await symlink(resolve(root, 'evidence'), linked, 'junction');
  await assert.rejects(saveSourceEvidence(linked, bytes, facts), /länk/u);
});
