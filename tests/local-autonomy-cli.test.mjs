import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  assertLocalPath,
  parseArguments,
  renderPlan,
  writeNewPlan,
} from '../scripts/plan-local-work.mjs';

const CLI = fileURLToPath(
  new URL('../scripts/plan-local-work.mjs', import.meta.url),
);
const AT = '2026-09-04T12:00:00.000Z';
const invoke = (args) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const emptyPlan = () => ({
  evaluatedAt: AT,
  records: [],
  summary: {
    total: 0,
    readyForDryRun: 0,
    research: 0,
    deferred: 0,
    excluded: 0,
  },
  seedSha256: 'sha256:fixture',
  planHash: 'sha256:fixture',
});

function seedFixture() {
  return {
    schema_version: 'foretagskarta.company-seeds.v1',
    wave_id: 'wave-test',
    generated_at: AT,
    mode: 'local_candidate_staging',
    candidate_count: 1,
    database_import_performed: false,
    algorithm_evaluation_performed: false,
    human_decision_required: true,
    data_policy: {
      company_level_public_data_only: true,
      personal_contacts_included: false,
      outreach_authorized: false,
      advertising_authorized: false,
    },
    deduplication_baseline: {
      runtime_id: 'synthetic-only',
      checked_at: AT,
      inventory_count: 0,
      result: 'not_checked',
      limitations: [],
    },
    records: [
      {
        source_record_id: 'CAND:test:one',
        company_name: 'Test café',
        workplace_name: 'Test café – Göteborg',
        street_address: 'Testgatan 1',
        postal_code: '413 01',
        municipality_code: '1480',
        gothenburg_status: 'unresolved',
        verification_status: 'unresolved',
        needs_manual_review: true,
        verification_note: 'Synthetic fixture only',
        segment: 'restaurang/café',
        website: 'https://cafe-fixture.se/',
        domain_status: 'unresolved',
        domain_confidence: 0,
        source_url: 'https://cafe-fixture.se/',
        evidence_urls: ['https://cafe-fixture.se/'],
        observed_at: AT,
      },
    ],
  };
}

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'divinelist-autonomy-test-'));
  // This test owns this exact mkdtemp directory; never use a caller-supplied path.
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('autonomy rapport: pausvillkor visas som säker text och utlovar ingen automatisk återstart', () => {
  const plan = emptyPlan();
  plan.records = [
    {
      companyName: 'Testföretag',
      status: 'agent_deferred',
      nextAction: 'research_or_replace_candidate',
      researchPause: {
        reason: '<script>untrusted</script>\n| nytt',
        resumeWhen: '[länk](https://untrusted.se)\n## nytt',
      },
    },
  ];
  const report = renderPlan(plan);
  assert.match(report, /Parkerade utredningar/);
  assert.match(report, /Återuppta när:/);
  assert.match(report, /en ny körtid tar inte bort pausen/);
  assert.ok(!report.includes('<script>'));
  assert.ok(!report.includes('[länk]'));
  assert.ok(!report.includes('\n## nytt'));
  assert.ok(!renderPlan(emptyPlan()).includes('Parkerade utredningar'));
});

test('autonomy CLI: explicit tid, entydiga argument och säkert körnamn krävs', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.equal(parseArguments(['seed.json', '--at', AT]).evaluatedAt, AT);
  for (const args of [
    [],
    ['seed.json'],
    ['--at', AT],
    ['seed.json', '--at'],
    ['seed.json', '--at', AT, '--at', AT],
    ['seed.json', '--at', AT, '--approve'],
    ['seed.json', '--at', AT, '--output', '../escape'],
    ['seed.json', '--at', AT, '--output', 'C:\\runtime'],
    ['seed.json', '--at', AT, '--output', 'a/b'],
  ])
    assert.throws(() => parseArguments(args));
});

test('autonomy CLI: stdout-plan kräver ingen fråga och ändrar inga indata', async (t) => {
  const root = await temporary(t);
  const seedPath = join(root, 'seed.json');
  const original = JSON.stringify(seedFixture());
  await writeFile(seedPath, original);
  const result = invoke([seedPath, '--at', AT]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plan.summary.research, 1);
  assert.equal(report.plan.summary.userDecisionsRequired, 0);
  assert.equal(report.plan.guardrails.networkRequests, false);
  assert.equal(report.plan.guardrails.databaseWrites, false);
  assert.equal(report.plan.records[0].identityVerified, false);
  assert.equal(report.outputDirectory, undefined);
  assert.deepEqual(await readdir(root), ['seed.json']);
  assert.equal(await readFile(seedPath, 'utf8'), original);
  assert.equal(invoke([seedPath, '--at', AT]).stdout, result.stdout);
});

test('autonomy CLI: trasig UTF-8, överstor fil och felaktig JSON stoppas', async (t) => {
  const root = await temporary(t);
  const path = join(root, 'input.json');
  for (const content of [
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(256_001, 32),
    '{bad json}',
  ]) {
    await writeFile(path, content);
    const result = invoke([path, '--at', AT]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).status, 'FAIL');
    assert.equal(result.stdout, '');
  }
});

test('autonomy CLI: felaktig hashbindning i observationsfil stoppas', async (t) => {
  const root = await temporary(t);
  const seedPath = join(root, 'seed.json');
  const observationPath = join(root, 'observations.json');
  await writeFile(seedPath, JSON.stringify(seedFixture()));
  await writeFile(
    observationPath,
    JSON.stringify({
      version: 'divinelist.identity-observations.v1',
      seedSha256: `sha256:${'0'.repeat(64)}`,
      records: [],
    }),
  );
  const result = invoke([
    seedPath,
    '--at',
    AT,
    '--observations',
    observationPath,
  ]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).databaseWrites, false);
  assert.equal(result.stdout, '');
});

test('autonomy rapport: sparar bara en ny körning och bevarar befintliga filer', async (t) => {
  const root = await temporary(t);
  const seedPath = join(root, 'seed.json');
  await writeFile(seedPath, JSON.stringify(seedFixture()));
  const plan = JSON.parse(invoke([seedPath, '--at', AT]).stdout).plan;
  const saved = await writeNewPlan(plan, 'run-001', root);
  assert.equal(
    saved.outputDirectory,
    join(root, 'reports', 'autonomy', 'run-001'),
  );
  assert.deepEqual(JSON.parse(await readFile(saved.files[0], 'utf8')), plan);
  const before = await readFile(saved.files[1], 'utf8');
  await assert.rejects(writeNewPlan(plan, 'run-001', root), { code: 'EEXIST' });
  assert.equal(await readFile(saved.files[1], 'utf8'), before);
  for (const invalid of ['../escape', '', undefined, '..', 'a/b']) {
    await assert.rejects(writeNewPlan(plan, invalid, root));
  }
});

test('autonomy rapport: följer inte en länk från rapportroten', async (t) => {
  const root = await temporary(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(
    outside,
    join(root, 'reports'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    writeNewPlan(emptyPlan(), 'run-001', root),
    /symbolisk länk/,
  );
  assert.deepEqual(await readdir(outside), []);
});

test('autonomy filer: nätverks- och enhetssökvägar stoppas före filåtkomst', () => {
  for (const path of [
    '\\\\server\\share\\seed.json',
    '//server/share/seed.json',
    '\\\\?\\C:\\seed.json',
    '\\\\.\\device',
    '',
  ]) {
    assert.throws(() => assertLocalPath(path));
    const result = invoke([path, '--at', AT]);
    assert.equal(result.status, 2);
  }
});

test('autonomy filer: kandidatindata får inte läsas genom en kataloglänk', async (t) => {
  const root = await temporary(t);
  const target = join(root, 'target');
  await mkdir(target);
  await writeFile(join(target, 'seed.json'), JSON.stringify(seedFixture()));
  const linked = join(root, 'linked');
  await symlink(
    target,
    linked,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = invoke([join(linked, 'seed.json'), '--at', AT]);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stderr).message, /symboliska länkar/);
});

test('autonomy rapport: renderingsfel skapar ingen ofullständig körning', async (t) => {
  const root = await temporary(t);
  await assert.rejects(writeNewPlan({}, 'invalid-plan', root));
  assert.deepEqual(await readdir(root), []);
});

test('autonomy rapport: partiellt skrivfel redovisar katalog och färdigskrivna filer', async (t) => {
  const root = await temporary(t);
  let writes = 0;
  const failingWrite = async (...args) => {
    writes += 1;
    if (writes === 2)
      throw Object.assign(new Error('synthetic disk failure'), {
        code: 'ENOSPC',
      });
    await writeFile(...args);
  };
  await assert.rejects(
    writeNewPlan(emptyPlan(), 'partial-run', root, failingWrite),
    (error) => {
      assert.equal(error.partialOutput, true);
      assert.equal(error.code, 'ENOSPC');
      assert.equal(
        error.outputDirectory,
        join(root, 'reports', 'autonomy', 'partial-run'),
      );
      assert.equal(error.completedFiles.length, 1);
      assert.equal(error.attemptedFiles.length, 2);
      return true;
    },
  );
  assert.deepEqual(
    await readdir(join(root, 'reports', 'autonomy', 'partial-run')),
    ['local-work-plan.json'],
  );
});

test('autonomy rapport: företagsnamn kan inte skapa HTML, länkar eller nya tabellrader', () => {
  const report = renderPlan({
    evaluatedAt: AT,
    records: [
      {
        companyName: '<script>x</script>\n| [länk](https://evil.se)',
        status: 'agent_research',
        nextAction: 'research_public_company',
      },
    ],
    summary: {
      total: 1,
      readyForDryRun: 0,
      research: 1,
      deferred: 0,
      excluded: 0,
    },
    seedSha256: 'sha256:fixture',
    planHash: 'sha256:fixture',
  });
  assert.ok(!report.includes('<script>'));
  assert.ok(!report.includes('[länk]'));
  assert.ok(report.includes('Utred vidare'));
  assert.ok(report.includes('&#124;'));
});
