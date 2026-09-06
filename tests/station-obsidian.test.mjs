import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  lstat,
  stat,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createObsidianBridge } from '../scripts/station/obsidian.mjs';

const COMPANY = {
  id: 'a'.repeat(24),
  name: 'Syntetiskt Testbolag',
  domain: 'synthetic-company.se',
  sourceKind: 'openstreetmap',
  sourceUrl: 'https://www.openstreetmap.org/node/42',
  observedAt: '2026-09-06T10:00:00.000Z',
  status: 'review',
  facts: {
    url: 'https://synthetic-company.se/',
    capturedAt: '2026-09-06T10:01:00.000Z',
    title: 'Testbolag',
    description: '',
    hasViewport: false,
    lang: 'sv',
    statusCode: 200,
    sha256: `sha256:${'f'.repeat(64)}`,
    evidenceScope: 'En syntetisk HTML-sida.',
    geography: 'Unknown - needs verification',
  },
  report: {
    summary: 'Syntetiskt underlag, ingen riktig webbplats har hämtats.',
    suggestions: ['Sidbeskrivning saknas i HTML-underlaget.'],
    unknowns: ['Mobilutseende har inte undersökts.'],
  },
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'divinelist-obsidian-test-'));
  const vaultPath = join(root, 'Synthetic Vault');
  const dataDir = join(root, 'station-data');
  await mkdir(join(vaultPath, '.obsidian'), { recursive: true });
  const bridge = await createObsidianBridge({ dataDir });
  t.after(async () => {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    vaultPath,
    dataDir,
    bridge,
    folder: 'DivineList/Agentstation',
  };
}

async function markdownFiles(root) {
  const result = [];
  async function walk(path) {
    for (const name of await readdir(path)) {
      const target = join(path, name);
      if ((await lstat(target)).isDirectory()) await walk(target);
      else if (name.endsWith('.md')) result.push(target);
    }
  }
  await walk(root);
  return result.sort((a, b) => a.localeCompare(b));
}

test('500 unchanged companies preserve readback while manifest writes stay constant, and one changed report is journaled', async (t) => {
  const { bridge, vaultPath, dataDir, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const companies = Array.from({ length: 500 }, (_, index) => ({
    ...COMPANY,
    id: index.toString(16).padStart(24, '0'),
    name: `Syntetiskt skalprov ${index}`,
  }));
  const initial = await bridge.sync(companies);
  assert.equal(initial.written, 500);
  const beforeFiles = await markdownFiles(vaultPath);
  const originalRename = fs.promises.rename;
  const statePath = join(dataDir, 'obsidian-state.json');
  let replacements = 0;
  const instrumentedRename = t.mock.method(
    fs.promises,
    'rename',
    async (...arguments_) => {
      if (resolve(arguments_[1]) === statePath) replacements += 1;
      return originalRename(...arguments_);
    },
  );
  syncBuiltinESMExports();
  try {
    const unchanged = await bridge.sync(companies);
    t.diagnostic(
      `500 unchanged companies: ${replacements} manifest replacements`,
    );
    assert.equal(unchanged.unchanged, 500);
    assert.ok(unchanged.companies.every((row) => row.readBackVerified));
    assert.deepEqual(await markdownFiles(vaultPath), beforeFiles);
    assert.equal(
      replacements,
      2,
      'Only recovery bookkeeping and the final lastSync update need persistence.',
    );
    replacements = 0;
    companies[250] = {
      ...companies[250],
      facts: { ...COMPANY.facts, title: 'En ändrad, syntetisk titel' },
    };
    const changed = await bridge.sync(companies);
    t.diagnostic(
      `One changed company out of500: ${replacements} manifest replacements`,
    );
    assert.equal(changed.written, 1);
    assert.equal(changed.unchanged, 499);
    assert.ok(changed.companies.every((row) => row.readBackVerified));
    assert.equal(
      (await markdownFiles(vaultPath)).length,
      beforeFiles.length + 2,
    );
    assert.equal(
      replacements,
      7,
      'The new report and overview keep their pre-publication journals and verified publication writes.',
    );
  } finally {
    instrumentedRename.mock.restore();
    syncBuiltinESMExports();
  }
});

test('configuration is inert and explicit sync writes source-bound cards, reports and current overview', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  assert.equal(bridge.getState().configured, false);
  await bridge.configure({ vaultPath, folder });
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  const result = await bridge.sync([COMPANY]);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.companies[0].readBackVerified, true);
  assert.equal((await markdownFiles(vaultPath)).length, 12);
  const agentOverview = await readFile(
    join(vaultPath, folder, 'Agenterna', '00 Så fungerar agentkedjan.md'),
    'utf8',
  );
  assert.match(agentOverview, /Spanaren.*Kartografen.*Analytikern/su);
  assert.match(agentOverview, /tomt arbetspass/iu);
  assert.match(
    await readFile(join(vaultPath, folder, 'SÅ VERIFIERAR DU.md'), 'utf8'),
    /tre frågor/u,
  );
  assert.match(
    await readFile(result.companies[0].cardPath, 'utf8'),
    /Mina tre verifieringar/u,
  );
  assert.match(await readFile(result.mapPath, 'utf8'), /GRANSKA NU/u);
  const report = await readFile(result.companies[0].reportPath, 'utf8');
  assert.match(report, /openstreetmap\.org\/node\/42/);
  assert.match(report, /Unknown - needs verification/);
  assert.match(report, /behöver mänsklig granskning/);
  assert.match(report, /En syntetisk HTML-sida/);
  assert.match(
    await readFile(result.overviewPath, 'utf8'),
    /Verifiera enkelt.*Öppna maskinrapport/,
  );
  assert.match(
    await readFile(result.companies[0].cardPath, 'utf8'),
    /Mina tre verifieringar/,
  );
  assert.match(
    await readFile(result.companies[0].cardPath, 'utf8'),
    /openstreetmap\.org\/node\/42/,
  );
  assert.match(
    await readFile(result.overviewPath, 'utf8'),
    /Rapport uppdaterad/,
  );
  assert.match(
    await readFile(result.overviewPath, 'utf8'),
    /2026-09-06T10&#58;01/,
  );
  assert.match(
    await readFile(join(vaultPath, folder, 'START.md'), 'utf8'),
    /```query\npath:/,
  );
  assert.ok(result.companies[0].reportUri.startsWith('obsidian://open?path='));
});

test('identical rerun creates no extra notes and edited human cards and START remain untouched', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  const cardPath = first.companies[0].cardPath;
  const mine = `${await readFile(cardPath, 'utf8')}\nMina egna anteckningar: behåll exakt.\n`;
  await writeFile(cardPath, mine);
  const start = join(vaultPath, folder, 'START.md');
  await writeFile(start, 'Min startanteckning som ska bevaras.\n');
  const before = await markdownFiles(vaultPath);
  const cardTime = (await stat(cardPath)).mtimeMs;
  const second = await bridge.sync([COMPANY]);
  assert.equal(second.written, 0);
  assert.equal(second.unchanged, 1);
  assert.deepEqual(second.conflicts, []);
  assert.equal(second.overviewPath, first.overviewPath);
  assert.deepEqual(await markdownFiles(vaultPath), before);
  assert.equal(await readFile(cardPath, 'utf8'), mine);
  assert.equal((await stat(cardPath)).mtimeMs, cardTime);
  assert.equal(
    await readFile(start, 'utf8'),
    'Min startanteckning som ska bevaras.\n',
  );
});

test('changed observations create a new immutable report and overview while preserving old source bytes', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  const firstReport = await readFile(first.companies[0].reportPath);
  const changed = structuredClone(COMPANY);
  changed.facts.title = 'En senare observerad titel';
  const second = await bridge.sync([changed]);
  assert.equal(second.written, 1);
  assert.notEqual(
    second.companies[0].reportPath,
    first.companies[0].reportPath,
  );
  assert.notEqual(second.overviewPath, first.overviewPath);
  assert.deepEqual(await readFile(first.companies[0].reportPath), firstReport);
  assert.match(
    await readFile(second.companies[0].reportPath, 'utf8'),
    /En senare observerad titel/,
  );
  assert.equal((await markdownFiles(vaultPath)).length, 14);
  assert.equal(second.mapPath, first.mapPath);
});

test('edited agent report is parked and never overwritten; another company can complete', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  const reportPath = first.companies[0].reportPath;
  await writeFile(reportPath, 'Samtidig manuell rapportredigering.\n');
  const second = await bridge.sync([
    { ...COMPANY, status: 'blocked' },
    { ...COMPANY, id: 'b'.repeat(24), name: 'Andra syntetiska bolaget' },
  ]);
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.conflicts[0].id, COMPANY.id);
  assert.equal(second.written, 1);
  assert.equal(second.companies[0].readBackVerified, false);
  assert.equal(
    await readFile(reportPath, 'utf8'),
    'Samtidig manuell rapportredigering.\n',
  );
  assert.match(await readFile(second.overviewPath, 'utf8'), /KONFLIKT/);
});

test('colliding unowned company filename is preserved and does not block other companies or reruns', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const path = join(vaultPath, folder, 'Foretag', `${COMPANY.id}.md`);
  await mkdir(join(vaultPath, folder, 'Foretag'), { recursive: true });
  await writeFile(path, 'Min befintliga fil.\n');
  const companies = [COMPANY, { ...COMPANY, id: 'c'.repeat(24) }];
  const first = await bridge.sync(companies);
  assert.equal(first.conflicts.length, 1);
  assert.equal(first.written, 1);
  const second = await bridge.sync(companies);
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.unchanged, 1);
  assert.equal(await readFile(path, 'utf8'), 'Min befintliga fil.\n');
});

test('simultaneous human edits during queued updates survive and the writer serializes snapshots', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  const cardPath = first.companies[0].cardPath;
  const writes = Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      bridge.sync([{ ...COMPANY, status: index % 2 ? 'review' : 'queued' }]),
    ),
  );
  let count = 0;
  const interval = setInterval(() => {
    count += 1;
  }, 1);
  const humanText =
    'Manuell text som skrivs medan agentrapporter uppdateras.\n';
  await writeFile(cardPath, humanText);
  const results = await writes;
  clearInterval(interval);
  assert.ok(count > 0);
  assert.ok(results.every((result) => result.conflicts.length === 0));
  assert.equal(await readFile(cardPath, 'utf8'), humanText);
  assert.equal(
    new Set(results.map((result) => result.companies[0].reportPath)).size,
    8,
  );
});

test('pre-aborted sync creates no vault files and interruption preserves already existing bytes', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const aborted = AbortSignal.abort();
  await assert.rejects(bridge.sync([COMPANY], { signal: aborted }), {
    name: 'AbortError',
  });
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  const first = await bridge.sync([COMPANY]);
  const before = new Map(
    await Promise.all(
      (await markdownFiles(vaultPath)).map(async (path) => [
        path,
        await readFile(path),
      ]),
    ),
  );
  const controller = new AbortController();
  const pending = bridge.sync(
    Array.from({ length: 30 }, (_, index) => ({
      ...COMPANY,
      id: (index + 10).toString(16).padStart(24, '0'),
    })),
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 12);
  await assert.rejects(pending, { name: 'AbortError' });
  for (const [path, bytes] of before)
    assert.deepEqual(await readFile(path), bytes);
  assert.equal(bridge.getState().syncing, false);
  const recovered = await bridge.sync([COMPANY]);
  assert.equal(
    recovered.companies[0].reportPath,
    first.companies[0].reportPath,
  );
  assert.equal(recovered.conflicts.length, 0);
});

test('configuration rejects escaping, system, non-vault and linked targets before writing', async (t) => {
  const { bridge, root, vaultPath, folder } = await fixture(t);
  for (const invalid of [
    '../other',
    '.obsidian',
    '/absolute',
    'C:\\Windows',
    'DivineList/.obsidian',
    'DivineList/../../escape',
    'CON',
    'A|B',
    'Folder"inject',
  ])
    await assert.rejects(bridge.configure({ vaultPath, folder: invalid }));
  await assert.rejects(bridge.configure({ vaultPath: root, folder }));
  await assert.rejects(
    bridge.configure({ vaultPath: '\\\\server\\share', folder }),
  );
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(vaultPath, 'Linked'), 'junction');
  await assert.rejects(
    bridge.configure({ vaultPath, folder: 'Linked/Subfolder' }),
    /länk/,
  );
  assert.deepEqual(await readdir(outside), []);
});

test('a directory replaced with a junction after configuration fails closed at sync', async (t) => {
  const { bridge, root, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(vaultPath, 'DivineList'), 'junction');
  await assert.rejects(bridge.sync([COMPANY]), /länk/);
  assert.deepEqual(await readdir(outside), []);
});

test('untrusted company content cannot inject Markdown embeds, HTML or Obsidian instructions', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const result = await bridge.sync([
    {
      ...COMPANY,
      name: '![[Other]] <script>oops</script>',
      sourceUrl: 'javascript:alert(1)',
      report: {
        summary: '<iframe src=x>\n---\n![[Secrets]]',
        suggestions: ['[click](javascript:alert(1))', '```query path:private'],
        unknowns: ['%%hidden%%'],
      },
    },
  ]);
  const text = await readFile(result.companies[0].reportPath, 'utf8');
  assert.doesNotMatch(
    text,
    /<script>|<iframe|!\[\[Secrets\]\]|\]\(javascript:/,
  );
  assert.doesNotMatch(text, /\n---\n|```query path:private/);
  assert.match(text, /&lt;iframe/);
  assert.match(text, /javascript&#58;/);
});

test('restart retains exact identity and report paths without creating duplicates', async (t) => {
  const { bridge, dataDir, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  await bridge.close();
  const reopened = await createObsidianBridge({ dataDir });
  t.after(() => reopened.close());
  assert.equal(reopened.getState().lastSync, first.lastSync);
  assert.equal(reopened.getState().companies[0].status, 'saved');
  assert.equal(reopened.getState().companies[0].readBackVerified, false);
  assert.equal(
    reopened.getState().companies[0].reportUri,
    first.companies[0].reportUri,
  );
  const second = await reopened.sync([COMPANY]);
  assert.equal(second.written, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(second.overviewPath, first.overviewPath);
  assert.equal(second.companies[0].reportPath, first.companies[0].reportPath);
  assert.equal((await markdownFiles(vaultPath)).length, 12);
});

test('a crash after publication but before manifest commit reuses verified reports without duplicate notes', async (t) => {
  const { bridge, dataDir, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  await bridge.close();
  const path = join(dataDir, 'obsidian-state.json');
  const stored = JSON.parse(await readFile(path, 'utf8'));
  const row = stored.manifest.companies[COMPANY.id];
  stored.manifest.files[row.report].claimed = false;
  stored.manifest.files[row.report].pending = true;
  stored.manifest.files[stored.manifest.index].claimed = false;
  stored.manifest.files[stored.manifest.index].pending = true;
  stored.manifest.companies = {};
  stored.manifest.index = null;
  stored.manifest.indexDigest = null;
  await writeFile(path, JSON.stringify(stored));
  const reopened = await createObsidianBridge({ dataDir });
  t.after(() => reopened.close());
  const recovered = await reopened.sync([COMPANY]);
  assert.equal(recovered.conflicts.length, 0);
  assert.equal(
    recovered.companies[0].reportPath,
    first.companies[0].reportPath,
  );
  assert.equal(recovered.overviewPath, first.overviewPath);
  assert.equal((await markdownFiles(vaultPath)).length, 12);
});

test('registered vault discovery only reads bounded registry metadata and lists real local vaults', async (t) => {
  const { bridge, root, vaultPath } = await fixture(t);
  const previous = process.env.APPDATA;
  process.env.APPDATA = join(root, 'Synthetic AppData');
  t.after(() => {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
  });
  await mkdir(join(process.env.APPDATA, 'obsidian'), { recursive: true });
  await writeFile(
    join(process.env.APPDATA, 'obsidian', 'obsidian.json'),
    JSON.stringify({
      vaults: {
        valid: { path: vaultPath },
        duplicate: { path: vaultPath },
        missing: { path: join(root, 'Missing') },
        ordinary: { path: root },
      },
    }),
  );
  assert.deepEqual(await bridge.listVaults(), [
    { name: 'Synthetic Vault', path: vaultPath },
  ]);
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
});

test('one data directory has exactly one bridge writer and malformed local state is preserved', async (t) => {
  const { bridge, dataDir } = await fixture(t);
  await assert.rejects(
    createObsidianBridge({ dataDir }),
    /annan Obsidian-skrivkö/,
  );
  await bridge.close();
  const path = join(dataDir, 'obsidian-state.json');
  await writeFile(path, '{invalid');
  await assert.rejects(createObsidianBridge({ dataDir }));
  assert.equal(await readFile(path, 'utf8'), '{invalid');
});

test('disabled integration and malformed company ids create no notes', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder, enabled: false });
  await assert.rejects(bridge.sync([COMPANY]), /aktivera/);
  await bridge.configure({ vaultPath, folder });
  await assert.rejects(bridge.sync([{ ...COMPANY, id: '../../escape' }]));
  await assert.rejects(bridge.sync([COMPANY, COMPANY]));
  assert.deepEqual(await readdir(vaultPath), ['.obsidian']);
  const detached = bridge.getState();
  detached.enabled = false;
  assert.equal(bridge.getState().enabled, true);
});

test('changing vault folder creates a separate history and never modifies the former target', async (t) => {
  const { bridge, vaultPath, folder } = await fixture(t);
  await bridge.configure({ vaultPath, folder });
  const first = await bridge.sync([COMPANY]);
  const firstBytes = await readFile(first.companies[0].reportPath);
  await bridge.configure({ vaultPath, folder: 'Separat/Arbetsmapp' });
  await assert.rejects(lstat(resolve(vaultPath, 'Separat')), {
    code: 'ENOENT',
  });
  const second = await bridge.sync([COMPANY]);
  assert.notEqual(
    second.companies[0].reportPath,
    first.companies[0].reportPath,
  );
  assert.deepEqual(await readFile(first.companies[0].reportPath), firstBytes);
});
