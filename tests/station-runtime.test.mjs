import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createStationRuntime,
  normalizeStationDomain,
} from '../scripts/station/runtime.mjs';
import { assembleStationReport } from '../scripts/station/report.mjs';

const AT = '2026-09-05T12:00:00.000Z';
const sampleReport = () => ({
  summary: 'Ett lokalt utkast.',
  suggestions: ['Kontrollera kontaktvägen.'],
  unknowns: ['Den mobila renderingen har inte granskats.'],
});
const seed = (id, domain = `business-${id}.se`) => ({
  id,
  name: `Företag ${id}`,
  domain,
  sourceUrl: `https://www.openstreetmap.org/node/${id}`,
  sourceKind: 'openstreetmap',
  observedAt: AT,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function until(predicate, message = 'Stationen blev inte klar') {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await sleep(5);
  }
  assert.fail(message);
}
async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'divinelist-station-'));
  let runtime = await createStationRuntime({
    dataDir,
    discover: async () => [],
    inspectSite: async (domain) => ({
      title: `Titel ${domain}`,
      description: 'Offentlig startsida',
      hasViewport: true,
      lang: 'sv',
      statusCode: 200,
      url: `https://${domain}/`,
      sha256: `sha256:${'a'.repeat(64)}`,
      capturedAt: AT,
    }),
    chat: async () => sampleReport(),
    ...options,
  });
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    runtime,
    dataDir,
    replace(next) {
      runtime = next;
    },
  };
}

test('a new station is empty and inert; returned snapshots cannot mutate stored state', async (t) => {
  let requests = 0;
  const { runtime } = await setup(t, {
    discover: async () => {
      requests += 1;
      return [seed(1)];
    },
    chat: async () => {
      requests += 1;
      return sampleReport();
    },
  });
  const state = runtime.getState();
  assert.equal(state.running, false);
  assert.equal(state.model, 'qwen3:4b');
  assert.equal(state.goal, 10);
  assert.deepEqual(state.companies, []);
  state.companies.push(seed(9));
  state.running = true;
  await sleep(15);
  assert.equal(requests, 0);
  assert.equal(runtime.getState().companies.length, 0);
});

test('Obsidian callback is inert until explicit run and observes source, blocked and completed boundaries', async (t) => {
  const snapshots = [];
  const { runtime } = await setup(t, {
    discover: async () => [seed(101), seed(102, null), seed(103)],
    inspectSite: async (domain) => {
      if (domain === 'business-103.se')
        throw new Error('Syntetiskt robots-hinder');
      return { title: 'Syntetisk titel', statusCode: 200 };
    },
    onCompaniesChanged: async (companies, { signal }) => {
      assert.equal(signal.aborted, false);
      snapshots.push(structuredClone(companies));
      companies.push({ id: 'invalid external mutation' });
      return { written: 0, conflicts: [] };
    },
  });
  await runtime.configure({ goal: 3 });
  runtime.getState();
  assert.equal(snapshots.length, 0);
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  assert.equal(snapshots[0].length, 0);
  assert.deepEqual(
    snapshots[1].map((row) => row.status),
    ['queued', 'blocked', 'queued'],
  );
  assert.deepEqual(
    snapshots.at(-1).map((row) => row.status),
    ['review', 'blocked', 'blocked'],
  );
  assert.equal(runtime.getState().companies.length, 3);
});

test('an Obsidian failure pauses writing without invalidating a completed analysis and an empty resume retries it', async (t) => {
  let fail = true;
  let modelCalls = 0;
  let writes = 0;
  const { runtime } = await setup(t, {
    discover: async () => [seed(104)],
    chat: async () => {
      modelCalls += 1;
      return sampleReport();
    },
    onCompaniesChanged: async (companies) => {
      if (companies[0]?.status === 'review') {
        writes += 1;
        if (fail) throw new Error('Syntetiskt diskfel');
      }
      return { written: companies.length, conflicts: [] };
    },
  });
  await runtime.configure({ goal: 1 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  let state = runtime.getState();
  assert.equal(state.paused, true);
  assert.equal(state.companies[0].status, 'review');
  assert.equal(state.companies[0].error, undefined);
  assert.ok(state.companies[0].report);
  assert.equal(
    state.jobs.find((row) => row.kind === 'analysis').status,
    'done',
  );
  assert.match(
    state.events.at(-1).message,
    /Obsidian-skrivningen.*inte ett webbplatsfynd/,
  );
  fail = false;
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  state = runtime.getState();
  assert.equal(state.paused, false);
  assert.equal(modelCalls, 2);
  assert.equal(writes, 2);
});

test('per-note Obsidian conflicts are warned once while other company jobs continue', async (t) => {
  const { runtime } = await setup(t, {
    discover: async () => [seed(105), seed(106)],
    onCompaniesChanged: async (companies) => ({
      written: 0,
      conflicts: companies.length
        ? [
            {
              id: companies[0].id,
              name: companies[0].name,
              message: 'Manuellt redigerad rapport bevarad.',
            },
          ]
        : [],
    }),
  });
  await runtime.configure({ goal: 2 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  const state = runtime.getState();
  assert.equal(state.paused, false);
  assert.ok(state.companies.every((row) => row.status === 'review'));
  assert.equal(
    state.events.filter((row) => row.message.includes('skrivkonflikter'))
      .length,
    1,
  );
});

test('a paused Obsidian callback drains before idle mutation and immediate resume never overlaps writers', async (t) => {
  const entered = deferred();
  const release = deferred();
  let active = 0;
  let peak = 0;
  let calls = 0;
  let firstSignal;
  const { runtime } = await setup(t, {
    onCompaniesChanged: async (_companies, { signal }) => {
      active += 1;
      peak = Math.max(peak, active);
      calls += 1;
      if (calls === 1) {
        firstSignal = signal;
        entered.resolve();
        await release.promise;
      }
      active -= 1;
    },
  });
  await runtime.control('resume');
  await entered.promise;
  await runtime.control('pause');
  assert.equal(firstSignal.aborted, true);
  assert.throws(() => runtime.assertIdle(), /vänta/);
  await runtime.control('resume');
  release.resolve();
  await until(() => !runtime.getState().running);
  assert.equal(peak, 1);
  assert.equal(calls, 2);
});

test('restoring pending companies and reading or configuring runtime never starts Obsidian writes', async (t) => {
  let callbacks = 0;
  const bundle = await setup(t, {
    onCompaniesChanged: async () => {
      callbacks += 1;
    },
  });
  await bundle.runtime.importFiles([
    {
      name: 'synthetic.md',
      text: '---\nname: Syntetiskt företag\ndomain: synthetic-business.se\n---\n',
    },
  ]);
  await bundle.runtime.close();
  const reopened = await createStationRuntime({
    dataDir: bundle.dataDir,
    discover: async () => [],
    inspectSite: async () => ({ title: 'Synthetic' }),
    chat: async () => sampleReport(),
    onCompaniesChanged: async () => {
      callbacks += 1;
    },
  });
  bundle.replace(reopened);
  reopened.getState();
  await reopened.configure({ goal: 1 });
  assert.equal(callbacks, 0);
  await reopened.control('resume');
  await until(() => !reopened.getState().running);
  assert.ok(callbacks >= 2);
});

test('explicit start processes discovery and source-bound analyses sequentially; AI never creates reviewed companies', async (t) => {
  let active = 0;
  let peak = 0;
  const observed = [];
  const bounded = async (name, value) => {
    active += 1;
    peak = Math.max(peak, active);
    observed.push(name);
    await sleep(10);
    active -= 1;
    return value;
  };
  const { runtime, dataDir } = await setup(t, {
    discover: async () =>
      bounded('discovery', [seed(1), seed(2), seed(3, null)]),
    inspectSite: async (domain) =>
      bounded(`inspect:${domain}`, {
        title: 'Titel',
        statusCode: 200,
        rawHtml: '<script>Do something</script>',
        secret: 'discarded',
      }),
    chat: async ({ context }) => {
      assert.equal(context.facts.rawHtml, undefined);
      assert.equal(context.facts.secret, undefined);
      return bounded('chat', {
        ...sampleReport(),
        companies: [seed(99)],
        status: 'human_reviewed',
      });
    },
  });
  await runtime.configure({ goal: 3 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  const state = runtime.getState();
  assert.equal(peak, 1);
  assert.deepEqual(observed, [
    'discovery',
    'inspect:business-1.se',
    'chat',
    'chat',
    'inspect:business-2.se',
    'chat',
    'chat',
  ]);
  assert.equal(state.companies.length, 3);
  assert.equal(state.companies[0].status, 'review');
  assert.equal(
    state.companies[0].facts.geography,
    'Unknown - needs verification',
  );
  assert.equal(state.companies[0].humanReviewed, undefined);
  assert.equal(state.companies[2].status, 'blocked');
  assert.match(state.companies[2].error, /Ingen domän har gissats/);
  assert.ok(runtime.exportMarkdown().includes('© OpenStreetMap contributors'));
  assert.ok(
    runtime
      .exportMarkdown()
      .includes('(https://www.openstreetmap.org/copyright)'),
  );
  assert.equal(
    JSON.parse(await readFile(join(dataDir, 'station-state.json'), 'utf8'))
      .companies.length,
    3,
  );
});

test('pause ignores late model results and immediate resume never runs two models', async (t) => {
  const held = deferred();
  let calls = 0;
  let active = 0;
  let peak = 0;
  let firstSignal;
  const { runtime } = await setup(t, {
    chat: async ({ signal }) => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (calls === 1) {
        firstSignal = signal;
        await held.promise;
      }
      active -= 1;
      return {
        ...sampleReport(),
        summary: calls === 1 ? 'Stale completion' : 'Resumed completion',
        suggestions: [calls === 1 ? 'Stale completion' : 'Resumed completion'],
      };
    },
  });
  await runtime.importFiles([
    {
      name: 'business.json',
      text: JSON.stringify({
        name: 'Lokalt företag',
        website: 'https://company.se',
      }),
    },
  ]);
  await runtime.configure({ goal: 1 });
  await runtime.control('start');
  await until(() => calls === 1);
  await runtime.control('pause');
  assert.equal(firstSignal.aborted, true);
  assert.equal(runtime.getState().companies[0].status, 'queued');
  assert.equal(runtime.getState().companies[0].report, undefined);
  await assert.rejects(
    runtime.importFiles([{ name: 'new.json', text: '{"name":"New"}' }]),
    (error) => error.statusCode === 409,
  );
  await runtime.control('resume');
  await sleep(15);
  assert.equal(calls, 1);
  held.resolve();
  await until(() => !runtime.getState().running);
  assert.equal(calls, 3);
  assert.equal(peak, 1);
  assert.ok(
    runtime
      .getState()
      .companies[0].report.suggestions.includes(
        'AI-förslag att granska: Resumed completion',
      ),
  );
  assert.ok(
    !runtime.getState().companies[0].report.summary.includes('completion'),
  );
  assert.ok(
    !runtime
      .getState()
      .events.some((event) => event.message.includes('Stale completion')),
  );
});

test('automatic handoff can be disabled during a lead and resumes without losing work', async (t) => {
  const held = deferred();
  let modelCalls = 0;
  const { runtime } = await setup(t, {
    discover: async () => [seed(801), seed(802)],
    chat: async () => {
      modelCalls += 1;
      if (modelCalls === 1) await held.promise;
      return sampleReport();
    },
  });
  await runtime.configure({ goal: 2 });
  await runtime.control('start');
  await until(() => modelCalls === 1);
  await runtime.setAutomation({ enabled: false });
  held.resolve();
  await until(() => !runtime.getState().running);
  let state = runtime.getState();
  assert.equal(state.autoWorkflow, false);
  assert.equal(state.paused, true);
  assert.equal(
    state.companies.filter((row) => row.status === 'review').length,
    1,
  );
  assert.equal(
    state.jobs.filter(
      (row) => row.kind === 'analysis' && row.status === 'queued',
    ).length,
    1,
  );
  assert.match(state.events.at(-1).message, /nästa överlämning väntar/iu);
  await runtime.setAutomation({ enabled: true });
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  state = runtime.getState();
  assert.equal(state.paused, false);
  assert.equal(
    state.companies.filter((row) => row.status === 'review').length,
    2,
  );
});

test('automatic handoff setting persists and rejects malformed values', async (t) => {
  const bundle = await setup(t);
  await assert.rejects(
    bundle.runtime.setAutomation({ enabled: 'yes' }),
    /true eller false/u,
  );
  await bundle.runtime.setAutomation({ enabled: false });
  await bundle.runtime.close();
  const reopened = await createStationRuntime({
    dataDir: bundle.dataDir,
    discover: async () => [],
    inspectSite: async () => ({}),
    chat: async () => sampleReport(),
  });
  bundle.replace(reopened);
  assert.equal(reopened.getState().autoWorkflow, false);
});

test('start refuses an empty session when the goal is already complete', async (t) => {
  const { runtime } = await setup(t);
  await runtime.configure({ goal: 1 });
  await runtime.importFiles([
    {
      name: 'company.json',
      text: JSON.stringify({ name: 'Redan behandlad', domain: null }),
    },
  ]);
  await assert.rejects(
    runtime.control('start'),
    /målet 1 är redan uppnått.*Höj målet/iu,
  );
  const state = runtime.getState();
  assert.equal(state.running, false);
  assert.equal(state.paused, false);
  assert.equal(state.jobs.length, 0);
});

test('stop cancels pending work and late discovery cannot append companies', async (t) => {
  const held = deferred();
  let started = false;
  const { runtime } = await setup(t, {
    discover: async () => {
      started = true;
      return held.promise;
    },
  });
  await runtime.command({
    role: 'scribe',
    instruction: 'Beskriv en arbetsplan.',
  });
  await runtime.control('start');
  await until(() => started);
  await runtime.control('stop');
  held.resolve([seed(1)]);
  await sleep(30);
  const state = runtime.getState();
  assert.equal(state.running, false);
  assert.equal(state.companies.length, 0);
  assert.ok(
    state.jobs.some(
      (job) => job.kind === 'discovery' && job.status === 'cancelled',
    ),
  );
});

test('restart preserves queued jobs but is always inert until explicit resume', async (t) => {
  const held = deferred();
  let started = false;
  let requests = 0;
  const bundle = await setup(t, {
    chat: async () => {
      started = true;
      return held.promise;
    },
  });
  await bundle.runtime.command({
    role: 'mapper',
    instruction: 'Ge råd om dubbletter.',
  });
  await bundle.runtime.control('resume');
  await until(() => started);
  const closing = bundle.runtime.close();
  held.resolve(sampleReport());
  await closing;
  const next = await createStationRuntime({
    dataDir: bundle.dataDir,
    discover: async () => {
      requests += 1;
      return [];
    },
    inspectSite: async () => {
      requests += 1;
      return {};
    },
    chat: async () => {
      requests += 1;
      return sampleReport();
    },
  });
  bundle.replace(next);
  assert.equal(next.getState().paused, true);
  assert.equal(next.getState().running, false);
  assert.equal(next.getState().jobs[0].status, 'queued');
  await sleep(20);
  assert.equal(requests, 0);
  await next.control('resume');
  await until(() => !next.getState().running);
  assert.equal(requests, 1);
});

test('domain normalization deduplicates imported and discovered companies without inventing data', async (t) => {
  const { runtime } = await setup(t, {
    discover: async () => [
      seed(1, 'https://WWW.COMPANY.SE/about'),
      seed(2, 'new-company.se'),
      { ...seed(3), domain: 'http://127.0.0.1' },
      { ...seed(4), sourceKind: 'llm' },
    ],
  });
  await runtime.importFiles([
    {
      name: 'Företag.md',
      text: '---\nname: Mitt företag\nwebsite: "https://www.company.se/"\nprivate-note: This is ignored\n---\nNever include this body in model context.',
    },
  ]);
  await runtime.importFiles([
    {
      name: 'duplicate.json',
      text: '[{"name":"Same company","domain":"COMPANY.SE"}]',
    },
  ]);
  await runtime.configure({ goal: 3 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  const companies = runtime.getState().companies;
  assert.equal(companies.length, 2);
  assert.equal(companies[0].domain, 'company.se');
  assert.equal(companies[0].sourceKind, 'obsidian_import');
  assert.equal(companies[0].sourceUrl, 'Företag.md');
  assert.equal(companies[1].sourceKind, 'openstreetmap');
  assert.ok(!JSON.stringify(companies).includes('Never include'));
});

test('invalid config and malformed imports are atomic, bounded and explicit', async (t) => {
  const { runtime } = await setup(t);
  for (const invalid of [
    { goal: 0 },
    { goal: 501 },
    { goal: 1.1 },
    { goal: '10' },
    { model: 'qwen3:4b; shell' },
    { model: 'a'.repeat(101) },
    { model: 4 },
    { unsafe: true },
  ]) {
    await assert.rejects(
      runtime.configure(invalid),
      (error) => error.statusCode === 400,
    );
  }
  for (const file of [
    { name: 'data.json', text: '{"name":4,"website":"https://company.se"}' },
    {
      name: 'data.json',
      text: '[{"name":"Valid","domain":"company.se"},{"name":"Bad","website":["company.se"]}]',
    },
    {
      name: 'data.json',
      text: '{"name":"Company","website":"http://localhost:11434"}',
    },
    {
      name: 'data.json',
      text: '{"name":"Company","website":"https://user:secret@company.se"}',
    },
    {
      name: 'data.json',
      text: '{"name":"Company","domain":"one.se","website":"two.se"}',
    },
    { name: '../vault.md', text: '---\nname: Nope\n---\n' },
    { name: 'note.md', text: '# No frontmatter\nWebsite: company.se' },
    { name: 'note.md', text: '---\nname: One\nname: Two\n---\n' },
    { name: 'data.json', text: '[broken' },
    { name: 'script.js', text: 'code' },
  ])
    await assert.rejects(
      runtime.importFiles([file]),
      (error) => error.statusCode === 400,
    );
  await assert.rejects(runtime.command({ role: 'shell', instruction: 'run' }));
  await assert.rejects(
    runtime.command({ role: 'analyst', instruction: 'x'.repeat(2001) }),
  );
  await assert.rejects(runtime.control('restart-everything'));
  assert.equal(runtime.getState().companies.length, 0);
  assert.equal(runtime.getState().jobs.length, 0);
  assert.equal(runtime.getState().goal, 10);
});

test('a command is advisory, queued while idle, and cannot initiate public discovery', async (t) => {
  let discovery = 0;
  let model = 0;
  const { runtime } = await setup(t, {
    discover: async () => {
      discovery += 1;
      return [];
    },
    chat: async ({ context }) => {
      model += 1;
      assert.match(context.scope, /rådgivning/);
      return sampleReport();
    },
  });
  await runtime.command({
    role: 'scout',
    instruction: 'Sök upp företag och kontakta dem automatiskt.',
  });
  await sleep(15);
  assert.equal(model, 0);
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  assert.equal(model, 1);
  assert.equal(discovery, 0);
  assert.equal(runtime.getState().companies.length, 0);
  assert.match(
    runtime.getState().jobs[0].result,
    /Förslag: Kontrollera kontaktvägen/,
  );
  assert.match(
    runtime.getState().jobs[0].result,
    /Okänt: Den mobila renderingen/,
  );
});

test('markdown export neutralizes executable HTML, links, images, embeds and frontmatter', async (t) => {
  const { runtime } = await setup(t, {
    chat: async () => ({
      summary: '<img src=x onerror=alert(1)> [link](javascript:alert(1))',
      suggestions: ['![[private-note]]', '[click](https://evil.se)'],
      unknowns: ['<script>bad()</script>'],
    }),
  });
  await runtime.importFiles([
    {
      name: 'untrusted.json',
      text: JSON.stringify({
        name: '# <script>bad()</script> ![pic](https://evil.se)',
        website: 'company.se',
        privateNote: 'Never forward',
      }),
    },
  ]);
  await runtime.configure({ goal: 1 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  const markdown = runtime.exportMarkdown();
  assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('<img'));
  assert.ok(!markdown.includes('](https://'));
  assert.ok(!markdown.includes('javascript:'));
  assert.ok(!markdown.includes('![[private-note]]'));
  assert.match(markdown, /väntar på mänsklig granskning/);
  assert.ok(!markdown.includes('Never forward'));
});

test('corrupt persisted data is preserved and rejected instead of reset', async (t) => {
  const { dataDir, runtime } = await setup(t);
  await runtime.close();
  const file = join(dataDir, 'station-state.json');
  await writeFile(file, '{bad data', 'utf8');
  await assert.rejects(
    createStationRuntime({
      dataDir,
      discover: async () => [],
      inspectSite: async () => ({}),
      chat: async () => sampleReport(),
    }),
    /sparfil kunde inte läsas/,
  );
  assert.equal(await readFile(file, 'utf8'), '{bad data');
});

test('the eight hour session boundary pauses safely and requires an explicit new start', async (t) => {
  let current = Date.parse(AT);
  const { runtime } = await setup(t, {
    now: () => current,
    chat: async () => {
      current += 8 * 60 * 60 * 1000;
      return sampleReport();
    },
  });
  await runtime.command({ role: 'scribe', instruction: 'Svara på uppdraget.' });
  await runtime.command({
    role: 'reviewer',
    instruction: 'Förbered en lista med osäkerheter.',
  });
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  assert.equal(runtime.getState().paused, true);
  assert.equal(runtime.getState().jobs[1].status, 'queued');
  await assert.rejects(
    runtime.control('resume'),
    (error) => error.statusCode === 409,
  );
  await runtime.control('stop');
});

test('public host normalization rejects private or non-web addresses', () => {
  assert.equal(
    normalizeStationDomain('HTTPS://www.Company.SE/path?query=yes'),
    'company.se',
  );
  for (const domain of [
    'localhost',
    '127.0.0.1',
    'http://[::1]',
    'ftp://company.se',
    'company.local',
    'http://company.se:9000',
  ])
    assert.throws(() => normalizeStationDomain(domain));
  assert.equal(normalizeStationDomain(null), null);
});

test('model unavailability pauses the queue for recovery instead of blocking every company', async (t) => {
  let calls = 0;
  const { runtime } = await setup(t, {
    discover: async () => [seed(1), seed(2)],
    chat: async () => {
      calls += 1;
      if (calls === 1)
        throw Object.assign(new Error('Ollama saknar ledigt minne.'), {
          statusCode: 503,
        });
      return sampleReport();
    },
  });
  await runtime.configure({ goal: 2 });
  await runtime.control('start');
  await until(() => runtime.getState().paused);
  assert.equal(calls, 1);
  assert.deepEqual(
    runtime.getState().companies.map((company) => company.status),
    ['queued', 'queued'],
  );
  assert.match(runtime.getState().companies[0].error, /ledigt minne/);
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  assert.equal(calls, 5);
  assert.ok(
    runtime
      .getState()
      .companies.every(
        (company) => company.status === 'review' && company.error === undefined,
      ),
  );
});

test('saved queue capacity is enforced and finished jobs yield space without exceeding500', async (t) => {
  const bundle = await setup(t);
  await bundle.runtime.close();
  const file = join(bundle.dataDir, 'station-state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.jobs = Array.from({ length: 500 }, (_, index) => ({
    id: `queue-${index}`,
    role: 'scribe',
    kind: 'command',
    status: 'queued',
    instruction: 'Förbered råd.',
    createdAt: AT,
  }));
  saved.events = Array.from({ length: 150 }, (_, index) => ({
    id: `event-${index}`,
    at: AT,
    message: 'Tidigare händelse.',
  }));
  await writeFile(file, JSON.stringify(saved), 'utf8');
  const next = await createStationRuntime({
    dataDir: bundle.dataDir,
    discover: async () => [],
    inspectSite: async () => ({}),
    chat: async () => sampleReport(),
  });
  bundle.replace(next);
  await assert.rejects(
    next.command({ role: 'analyst', instruction: 'Mer arbete.' }),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    next.control('start'),
    (error) => error.statusCode === 409,
  );
  assert.equal(next.getState().jobs.length, 500);
  assert.equal(next.getState().running, false);
  await next.control('stop');
  await next.command({ role: 'scribe', instruction: 'Ett nytt uppdrag.' });
  assert.equal(next.getState().jobs.length, 500);
  assert.equal(
    next.getState().jobs.filter((job) => job.status === 'queued').length,
    1,
  );
  assert.equal(next.getState().events.length, 150);
});

test('a prefixed source hash survives staging, persistence and export', async (t) => {
  const { runtime } = await setup(t);
  await runtime.importFiles([
    {
      name: 'company.json',
      text: JSON.stringify({ name: 'Företaget', domain: 'company.se' }),
    },
  ]);
  await runtime.configure({ goal: 1 });
  await runtime.control('start');
  await until(() => !runtime.getState().running);
  assert.equal(
    runtime.getState().companies[0].facts.sha256,
    `sha256:${'a'.repeat(64)}`,
  );
  assert.ok(runtime.exportMarkdown().includes(`sha256&#58;${'a'.repeat(64)}`));
});

test('reviewer uses original facts, exposes its role, and cannot commit a late result after pause', async (t) => {
  const pendingReview = deferred();
  const roles = [];
  let reviewerStarted = false;
  const { runtime } = await setup(t, {
    chat: async ({ role, context }) => {
      roles.push(role);
      if (role === 'reviewer') {
        assert.equal(context.analystDraft.summary, 'Analytikerns utkast');
        assert.equal(context.facts.title, 'Titel company.se');
        assert.equal(context.facts.geography, 'Unknown - needs verification');
        if (!reviewerStarted) {
          reviewerStarted = true;
          await pendingReview.promise;
          return { ...sampleReport(), summary: 'För sent granskningsresultat' };
        }
        return {
          ...sampleReport(),
          summary: 'Korrigerat AI-utkast',
          suggestions: ['Korrigerat förslag'],
        };
      }
      return { ...sampleReport(), summary: 'Analytikerns utkast' };
    },
  });
  await runtime.importFiles([
    {
      name: 'company.json',
      text: JSON.stringify({ name: 'Företaget', domain: 'company.se' }),
    },
  ]);
  await runtime.configure({ goal: 1 });
  await runtime.control('start');
  await until(() => reviewerStarted);
  assert.equal(runtime.getState().jobs[0].role, 'reviewer');
  assert.equal(runtime.getState().companies[0].report, undefined);
  await runtime.control('pause');
  pendingReview.resolve();
  await sleep(20);
  assert.equal(runtime.getState().companies[0].report, undefined);
  await runtime.control('resume');
  await until(() => !runtime.getState().running);
  assert.deepEqual(roles, ['analyst', 'reviewer', 'analyst', 'reviewer']);
  assert.equal(runtime.getState().jobs[0].role, 'scribe');
  assert.ok(
    runtime
      .getState()
      .companies[0].report.suggestions.includes(
        'AI-förslag att granska: Korrigerat förslag',
      ),
  );
  assert.ok(
    !runtime.getState().companies[0].report.summary.includes('AI-utkast'),
  );
  assert.equal(runtime.getState().companies[0].status, 'review');
  assert.ok(
    runtime
      .getState()
      .events.some((event) =>
        event.message.includes('mänsklig granskning återstår'),
      ),
  );
});

test('deterministic report repairs omitted metadata findings and rejects invented model observations across restart', async (t) => {
  const originalFacts = {
    title: '',
    description: '',
    hasViewport: false,
    lang: '',
    statusCode: 200,
    url: 'https://company.se/',
    sha256: `sha256:${'c'.repeat(64)}`,
    capturedAt: AT,
  };
  const bundle = await setup(t, {
    inspectSite: async () => structuredClone(originalFacts),
    chat: async () => ({
      summary: 'Företaget har inga faktiska användare och mobilen är trasig.',
      suggestions: ['Byt logotyp'],
      unknowns: [],
    }),
  });
  await bundle.runtime.importFiles([
    {
      name: 'company.json',
      text: JSON.stringify({ name: 'Företaget', domain: 'company.se' }),
    },
  ]);
  await bundle.runtime.configure({ goal: 1 });
  await bundle.runtime.control('start');
  await until(() => !bundle.runtime.getState().running);
  const company = bundle.runtime.getState().companies[0];
  assert.equal(company.status, 'review');
  assert.deepEqual(company.facts, {
    ...originalFacts,
    geography: 'Unknown - needs verification',
  });
  for (const finding of [
    'Sidtitel saknas i hämtad HTML.',
    'Metabeskrivning saknas i hämtad HTML.',
    'Viewport-information saknas eller är tom i hämtad HTML.',
    'Språkmarkering saknas i hämtad HTML.',
    'en HTML-sida utan JavaScript-rendering',
  ])
    assert.ok(company.report.summary.includes(finding), finding);
  assert.ok(!company.report.summary.includes('användare'));
  assert.ok(!company.report.summary.includes('mobilen är trasig'));
  assert.equal(company.report.suggestions.length, 5);
  for (const [index, field] of [
    'title',
    'description',
    'viewport',
    'lang',
  ].entries())
    assert.ok(company.report.suggestions[index].includes(field));
  assert.equal(
    company.report.suggestions[4],
    'AI-förslag att granska: Byt logotyp',
  );
  assert.ok(company.report.unknowns[0].includes('mobilutseende'));
  assert.ok(company.report.unknowns[1].includes('Göteborgstillhörighet'));
  await bundle.runtime.close();
  const next = await createStationRuntime({
    dataDir: bundle.dataDir,
    discover: async () => {
      throw new Error('Must remain inert');
    },
    inspectSite: async () => ({}),
    chat: async () => sampleReport(),
  });
  bundle.replace(next);
  assert.equal(next.getState().paused, true);
  assert.deepEqual(next.getState().companies[0].report, company.report);
});

test('report assembly distinguishes unobserved metadata from known empty and never recommends fixing present fields', () => {
  const unobserved = assembleStationReport(
    {},
    { summary: 'Fabricated', suggestions: [], unknowns: [] },
  );
  assert.equal(unobserved.suggestions.length, 0);
  assert.match(unobserved.summary, /Uppgift om sidtitel saknas i underlaget/);
  assert.ok(!unobserved.summary.includes('Sidtitel saknas i hämtad HTML'));
  assert.ok(
    !unobserved.summary.includes(
      'Viewport-information saknas eller är tom i hämtad HTML',
    ),
  );
  const present = {
    title: 'Observerad titel',
    description: 'Observerad beskrivning',
    hasViewport: true,
    lang: 'sv',
  };
  const before = structuredClone(present);
  const report = assembleStationReport(present, {
    summary: 'Alla fält saknas.',
    suggestions: [],
    unknowns: [],
  });
  assert.equal(report.suggestions.length, 0);
  assert.match(report.summary, /Observerad titel/);
  assert.match(report.summary, /Metabeskrivning finns/);
  assert.match(report.summary, /Viewport-tagg finns/);
  assert.match(report.summary, /Språkmarkering finns/);
  assert.deepEqual(present, before);
});

test('report assembly caps labelled model additions while keeping deterministic findings and required unknowns first', () => {
  const report = assembleStationReport(
    { title: '', description: '', hasViewport: false, lang: '' },
    {
      summary: 'Discarded',
      suggestions: Array(12).fill('s'.repeat(1000)),
      unknowns: Array(12).fill('u'.repeat(1000)),
    },
  );
  assert.equal(report.suggestions.length, 8);
  assert.equal(report.unknowns.length, 8);
  assert.ok(
    report.suggestions.slice(0, 4).every((value) => !value.startsWith('AI-')),
  );
  assert.ok(
    report.suggestions
      .slice(4)
      .every((value) => value.startsWith('AI-förslag att granska: ')),
  );
  assert.ok(
    report.unknowns
      .slice(2)
      .every((value) => value.startsWith('AI-osäkerhet att granska: ')),
  );
  assert.ok(
    [...report.suggestions, ...report.unknowns].every(
      (value) => value.length <= 1000,
    ),
  );
  assert.ok(report.summary.length <= 4000);
});
