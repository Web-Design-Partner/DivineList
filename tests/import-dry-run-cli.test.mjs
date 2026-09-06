import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  DRY_RUN_VERSION,
  SEQUENCE_VERSION,
  parseArguments,
  prepareRequest,
  renderDryRun,
  runWorker,
  validateWorkerResult,
  writeDryRun,
} from '../scripts/dry-run-company-seeds.mjs';
import {
  prepareSequence,
  loadSequence,
  validateManifest,
  parseSequenceArguments,
  MANIFEST_VERSION,
} from '../scripts/dry-run-company-sequence.mjs';

const AT = '2026-09-04T12:00:00.000Z';
const HASH = 'sha256:' + 'a'.repeat(64);
const CLI = fileURLToPath(
  new URL('../scripts/dry-run-company-seeds.mjs', import.meta.url),
);
const invoke = (args) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const baseArgs = () => [
  'seed.json',
  '--at',
  AT,
  '--observations',
  'observations.json',
  '--engine-root',
  'engine',
  '--source-db',
  'source.sqlite3',
  '--python',
  process.execPath,
];

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

function observationFixture(seed, hash = HASH) {
  return {
    version: 'divinelist.identity-observations.v1',
    seedSha256: hash,
    records: seed.records.map((record) => ({
      sourceRecordId: record.source_record_id,
      checkedAt: AT,
      sources: [
        { url: record.website, role: 'first_party', retrievedAt: AT },
        {
          url: 'https://catalog-fixture.se/company',
          role: 'business_directory',
          retrievedAt: AT,
        },
      ],
      identity: 'supported',
      workplace: 'scoped',
      municipality: 'supported',
      duplicate: 'clear',
      suppression: 'clear',
      segment: 'in_scope',
      note: 'Synthetic tests, no actual company or contact approval.',
    })),
  };
}

test('dry-run excludes a paused candidate while preserving another ready original record', () => {
  const seed = seedFixture();
  seed.records.push({ ...seed.records[0], source_record_id: 'CAND:test:two' });
  seed.candidate_count = 2;
  const observations = observationFixture(seed);
  observations.records[0].researchPause = {
    reason: 'Unresolved',
    resumeWhen: 'New evidence',
  };
  const prepared = prepareRequest({
    seed,
    seedSha256: HASH,
    observations,
    evaluatedAt: AT,
  });
  assert.equal(prepared.plan.summary.deferred, 1);
  assert.equal(prepared.plan.summary.readyForDryRun, 1);
  assert.deepEqual(prepared.request.records, [seed.records[1]]);
  assert.equal(prepared.request.records[0].verification_status, 'unresolved');
  observations.records[1].researchPause = {
    reason: 'Unresolved',
    resumeWhen: 'New evidence',
  };
  const paused = prepareRequest({
    seed,
    seedSha256: HASH,
    observations,
    evaluatedAt: AT,
  });
  assert.equal(paused.request.records.length, 0);
  assert.equal(paused.plan.summary.deferred, 2);
});

function prepared() {
  const seed = seedFixture();
  return prepareRequest({
    seed,
    seedSha256: HASH,
    observations: observationFixture(seed),
    evaluatedAt: AT,
  });
}

function seal(report) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  };
  delete report.reportHash;
  report.reportHash =
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify(canonical(report)))
      .digest('hex');
  return report;
}

function reportFixture(request = prepared().request) {
  const selectedSourceRecordIds = request.records.map(
    (record) => record.source_record_id,
  );
  return seal({
    version: DRY_RUN_VERSION,
    status: 'PASS',
    sourceName: request.sourceName,
    seedSha256: request.seedSha256,
    planHash: request.planHash,
    evaluatedAt: request.evaluatedAt,
    selectedSourceRecordIds,
    source: {
      unchanged: true,
      familyUnchanged: true,
      logicalBefore: HASH,
      logicalAfter: HASH,
      familyBefore: { main: HASH },
      familyAfter: { main: HASH },
    },
    firstImport: {
      read: 1,
      imported: 1,
      skipped: 0,
      duplicates: 0,
      conflicts: 0,
      queued: 0,
    },
    secondImport: {
      read: 1,
      imported: 0,
      skipped: 0,
      duplicates: 1,
      conflicts: 0,
      queued: 0,
    },
    idempotence: {
      structural: true,
      sourceObservations: true,
      timestampOnly: true,
      exactRows: false,
      sequenceChanges: true,
    },
    integrity: { integrityCheck: 'PASS', foreignKeys: 'PASS' },
    candidates: selectedSourceRecordIds.map((sourceRecordId) => ({
      sourceRecordId,
      verificationStatus: 'unresolved',
      gothenburgStatus: 'unresolved',
      needsManualReview: true,
      domainConfidence: 0,
      manualDecision: 'pending',
      qualifiedForContact: false,
    })),
    guardrails: {
      sourceReadOnly: true,
      simulationDatabase: ':memory:',
      runtimeWrites: false,
      networkRequests: false,
      queueWrites: false,
      humanDecisionsRecorded: false,
      identityEligibilityChanged: false,
      outreachAuthorized: false,
      advertisingAuthorized: false,
      activeVaultWrites: false,
    },
    diff: { first: [], second: [] },
  });
}

const resultOf = (report, status = 0) => ({
  stdout: JSON.stringify(report),
  status,
  signal: null,
});

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'divinelist-import-preview-test-'));
  // This exact directory is test-owned; no caller-supplied cleanup target.
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('dry-run CLI requires explicit runtime, engine, Python, observations and time', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.equal(parseArguments(baseArgs()).sourceDb, 'source.sqlite3');
  for (const args of [
    [],
    ['seed.json'],
    baseArgs().slice(0, -2),
    [...baseArgs(), '--approve'],
    [...baseArgs(), '--at', AT],
    [...baseArgs(), '--output', '../escape'],
    [...baseArgs(), '--output', ''],
  ])
    assert.throws(() => parseArguments(args));
  assert.equal(invoke(['--help']).status, 0);
});

test('dry-run selects only ready candidates and preserves exact fail-closed source records', () => {
  const seed = seedFixture();
  for (let index = 2; index <= 3; index += 1) {
    seed.records.push({
      ...seed.records[0],
      source_record_id: 'CAND:test:' + index,
      company_name: 'Test ' + index,
      workplace_name: 'Test ' + index,
      street_address: 'Testgatan ' + index,
      website: 'https://fixture-' + index + '.se/',
      source_url: 'https://fixture-' + index + '.se/',
      evidence_urls: ['https://fixture-' + index + '.se/'],
    });
  }
  seed.candidate_count = 3;
  const observations = observationFixture(seed);
  observations.records[1].workplace = 'unresolved';
  observations.records[2].segment = 'out_of_scope';
  const before = structuredClone({ seed, observations });
  const { plan, request } = prepareRequest({
    seed,
    seedSha256: HASH,
    observations,
    evaluatedAt: AT,
  });
  assert.equal(plan.summary.readyForDryRun, 1);
  assert.equal(plan.summary.userDecisionsRequired, 0);
  assert.deepEqual(request.records, [before.seed.records[0]]);
  assert.deepEqual({ seed, observations }, before);
  assert.equal(request.records[0].needs_manual_review, true);
  assert.equal(request.records[0].verification_status, 'unresolved');
  assert.equal(request.records[0].domain_confidence, 0);
  assert.equal(Object.hasOwn(request.records[0], 'org_number'), false);
});

test('dry-run stable source name does not depend on run date or report directory', () => {
  const seed = seedFixture();
  const first = prepareRequest({
    seed,
    seedSha256: HASH,
    observations: observationFixture(seed),
    evaluatedAt: AT,
  });
  const second = prepareRequest({
    seed,
    seedSha256: HASH,
    observations: observationFixture(seed),
    evaluatedAt: '2026-09-04T12:00:02Z',
  });
  assert.equal(first.request.sourceName, 'divinelist-seeds:wave-test');
  assert.equal(second.request.sourceName, first.request.sourceName);
  assert.notEqual(first.request.planHash, second.request.planHash);
});

test('dry-run never bypasses planner validation of inputs or source hash', () => {
  const seed = seedFixture();
  const observations = observationFixture(seed);
  assert.throws(() =>
    prepareRequest({
      seed,
      seedSha256: HASH,
      observations: { ...observations, seedSha256: 'sha256:' + '0'.repeat(64) },
      evaluatedAt: AT,
    }),
  );
  seed.records[0].verification_status = 'verified_current';
  assert.throws(() =>
    prepareRequest({ seed, seedSha256: HASH, observations, evaluatedAt: AT }),
  );
});

test('dry-run no-ready path does not open any database or start a worker', async (t) => {
  const root = await temporary(t);
  const seed = seedFixture();
  const text = JSON.stringify(seed);
  const seedPath = join(root, 'seed.json');
  const observationPath = join(root, 'observations.json');
  const hash = 'sha256:' + createHash('sha256').update(text).digest('hex');
  const observations = observationFixture(seed, hash);
  observations.records[0].suppression = 'not_checked';
  await writeFile(seedPath, text);
  await writeFile(observationPath, JSON.stringify(observations));
  const result = invoke([
    seedPath,
    '--observations',
    observationPath,
    '--at',
    AT,
    '--engine-root',
    join(root, 'DOES-NOT-EXIST'),
    '--source-db',
    join(root, 'DO-NOT-CREATE.sqlite3'),
    '--python',
    join(root, 'DO-NOT-RUN.exe'),
    '--output',
    'do-not-create',
  ]);
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'BLOCKED');
  assert.equal(output.workerStarted, false);
  assert.equal(output.databaseReads, false);
  assert.deepEqual(await readdir(root), ['observations.json', 'seed.json']);
  assert.equal(await readFile(seedPath, 'utf8'), text);
});

test('dry-run validates worker bindings, checksum and exit-code agreement', () => {
  const { request } = prepared();
  const report = reportFixture(request);
  assert.deepEqual(validateWorkerResult(resultOf(report), request), report);
  for (const mutate of [
    (value) => {
      value.planHash = HASH;
    },
    (value) => {
      value.seedSha256 = 'sha256:' + '0'.repeat(64);
    },
    (value) => {
      value.evaluatedAt = '2026-09-05T12:00:00Z';
    },
    (value) => {
      value.sourceName = 'divinelist-seeds:other';
    },
    (value) => {
      value.selectedSourceRecordIds = [];
    },
    (value) => {
      value.version = 'unknown';
    },
    (value) => {
      value.status = 'BLOCKED';
    },
  ]) {
    const altered = structuredClone(report);
    mutate(altered);
    assert.throws(() => validateWorkerResult(resultOf(seal(altered)), request));
  }
  const altered = structuredClone(report);
  altered.source.path = 'unsealed change';
  assert.throws(
    () => validateWorkerResult(resultOf(altered), request),
    /kontrollsumma/,
  );
});

test('dry-run rejects malformed, timed-out and unsuccessful worker responses', () => {
  const { request } = prepared();
  for (const result of [
    { status: 0, stdout: 'invalid' },
    { status: 1, stdout: '{}' },
    { status: null, signal: 'SIGTERM', stdout: '' },
    { status: 0, error: new Error('timeout'), stdout: '{}' },
    resultOf(reportFixture(request), 2),
  ])
    assert.throws(() => validateWorkerResult(result, request));
});

test('dry-run cannot accept PASS if source, queue or eligibility protections disagree', () => {
  const { request } = prepared();
  for (const mutate of [
    (r) => {
      r.source.unchanged = false;
    },
    (r) => {
      r.source.logicalAfter = 'sha256:' + 'b'.repeat(64);
    },
    (r) => {
      r.source.familyUnchanged = false;
    },
    (r) => {
      r.source.familyAfter = {};
    },
    (r) => {
      r.guardrails.sourceReadOnly = false;
    },
    (r) => {
      r.guardrails.simulationDatabase = 'runtime.sqlite3';
    },
    (r) => {
      r.guardrails.runtimeWrites = true;
    },
    (r) => {
      r.guardrails.networkRequests = true;
    },
    (r) => {
      r.guardrails.queueWrites = true;
    },
    (r) => {
      r.guardrails.humanDecisionsRecorded = true;
    },
    (r) => {
      r.guardrails.identityEligibilityChanged = true;
    },
    (r) => {
      r.firstImport.queued = 1;
    },
    (r) => {
      r.firstImport.skipped = 1;
    },
    (r) => {
      r.firstImport.imported = 0;
    },
    (r) => {
      r.secondImport.imported = 1;
    },
    (r) => {
      r.secondImport.duplicates = 0;
    },
    (r) => {
      r.idempotence.structural = false;
    },
    (r) => {
      r.idempotence.sourceObservations = false;
    },
    (r) => {
      r.integrity.foreignKeys = 'FAIL';
    },
    (r) => {
      r.candidates[0].verificationStatus = 'verified_current';
    },
    (r) => {
      r.candidates[0].needsManualReview = false;
    },
    (r) => {
      r.candidates[0].manualDecision = 'approved';
    },
    (r) => {
      r.candidates[0].qualifiedForContact = true;
    },
    (r) => {
      r.candidates[0].domainConfidence = 0.9;
    },
  ]) {
    const report = reportFixture(request);
    mutate(report);
    assert.throws(() => validateWorkerResult(resultOf(seal(report)), request));
  }
});

test('dry-run preserves an honestly bound BLOCKED worker report without claiming PASS', () => {
  const { request } = prepared();
  const report = reportFixture(request);
  report.status = 'BLOCKED';
  report.reason = 'Source changed concurrently';
  report.source.unchanged = false;
  const result = validateWorkerResult(resultOf(seal(report), 2), request);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.source.unchanged, false);
});

test('dry-run worker invocation is bounded, shell-free and does not forward credentials', async (t) => {
  const root = await temporary(t);
  const sourceDb = join(root, 'source.sqlite3');
  await writeFile(sourceDb, 'synthetic; never actually opened');
  const { request } = prepared();
  const report = reportFixture(request);
  let calls = 0;
  const output = await runWorker(
    request,
    { pythonPath: process.execPath, engineRoot: root, sourceDb },
    (command, args, options) => {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.deepEqual(args.slice(0, 2), ['-B', '-I']);
      assert.equal(args.at(-1), sourceDb);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 40_000);
      assert.deepEqual(JSON.parse(options.input), request);
      assert.ok(
        Object.keys(options.env).every((key) =>
          ['SystemRoot', 'WINDIR'].includes(key),
        ),
      );
      return resultOf(report);
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(output, report);
  assert.equal(
    await readFile(sourceDb, 'utf8'),
    'synthetic; never actually opened',
  );
  await assert.rejects(
    runWorker({ ...request, records: [] }, {}, () => assert.fail()),
  );
});

test('dry-run worker rejects network and linked paths before spawning', async (t) => {
  const root = await temporary(t);
  const target = join(root, 'target');
  await mkdir(target);
  await writeFile(join(target, 'source.sqlite3'), 'synthetic');
  const link = join(root, 'linked');
  await symlink(
    target,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const sourceDb of [
    '\\\\server\\share\\runtime.sqlite3',
    join(link, 'source.sqlite3'),
  ]) {
    await assert.rejects(
      runWorker(
        prepared().request,
        {
          pythonPath: process.execPath,
          engineRoot: root,
          sourceDb,
        },
        () => assert.fail('must not spawn'),
      ),
    );
  }
});

test('dry-run reports are new-only and preserve prior reports', async (t) => {
  const root = await temporary(t);
  const { plan, request } = prepared();
  const bundle = { plan, simulation: reportFixture(request) };
  const saved = await writeDryRun(bundle, 'run-001', root);
  assert.equal(
    saved.outputDirectory,
    join(root, 'reports', 'import-dry-run', 'run-001'),
  );
  const before = await readFile(saved.files[0], 'utf8');
  assert.deepEqual(JSON.parse(before), bundle);
  await assert.rejects(writeDryRun(bundle, 'run-001', root), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(saved.files[0], 'utf8'), before);
  for (const invalid of ['../escape', '', undefined, '..', 'a/b']) {
    await assert.rejects(writeDryRun(bundle, invalid, root));
  }
});

test('dry-run report refuses a linked output root and reports partial writes', async (t) => {
  const root = await temporary(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(
    outside,
    join(root, 'reports'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const { plan, request } = prepared();
  const bundle = { plan, simulation: reportFixture(request) };
  await assert.rejects(writeDryRun(bundle, 'run', root), /symbolisk länk/);
  assert.deepEqual(await readdir(outside), []);
  let calls = 0;
  await assert.rejects(
    writeDryRun(bundle, 'partial', outside, async (...args) => {
      if (++calls === 2) throw new Error('synthetic write failure');
      await writeFile(...args);
    }),
    (error) => {
      assert.equal(error.partialOutput, true);
      assert.equal(error.completedFiles.length, 1);
      assert.equal(error.attemptedFiles.length, 2);
      return true;
    },
  );
});

test('dry-run report escapes untrusted labels and never describes BLOCKED as imported', () => {
  const { plan, request } = prepared();
  plan.records[0].companyName =
    '<script>bad</script>\n| [länk](https://bad.se)';
  const simulation = reportFixture(request);
  simulation.status = 'BLOCKED';
  const rendered = renderDryRun({ plan, simulation });
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('[länk]'));
  assert.ok(!rendered.includes('Provad endast i minnet'));
  assert.ok(rendered.includes('simuleringen inte godkänd'));
  assert.ok(rendered.includes('inte en import till den aktiva databasen'));
});

function sequenceInputs() {
  return [1, 2, 3].map((number) => {
    const seed = seedFixture();
    Object.assign(seed.records[0], {
      source_record_id: 'CAND:sequence:' + number,
      company_name: 'Sequence fixture ' + number,
      workplace_name: 'Sequence fixture ' + number,
      street_address: 'Fixturegatan ' + number,
      website: 'https://sequence-' + number + '.se/',
      source_url: 'https://sequence-' + number + '.se/',
      evidence_urls: ['https://sequence-' + number + '.se/'],
    });
    return {
      packetId: 'packet-' + number,
      seed,
      seedSha256: HASH,
      observations: observationFixture(seed),
    };
  });
}

function sequenceReport(request) {
  const report = reportFixture(request);
  report.version = SEQUENCE_VERSION;
  const count = request.records.length;
  report.firstImport = {
    read: count,
    imported: count,
    duplicates: 0,
    conflicts: 0,
    skipped: 0,
    queued: 0,
  };
  report.secondImport = {
    read: count,
    imported: 0,
    duplicates: count,
    conflicts: 0,
    skipped: 0,
    queued: 0,
  };
  let previous = HASH;
  report.sequence = {
    sameMemoryDatabase: true,
    packetOrder: request.packets.map((packet) => packet.packetId),
    steps: [0, 1].flatMap((pass) =>
      request.packets.map((packet, index) => {
        const next = 'sha256:' + String(pass * 3 + index + 1).repeat(64);
        const step = {
          packetId: packet.packetId,
          pass: pass + 1,
          seedSha256: packet.seedSha256,
          planHash: packet.planHash,
          selectedSourceRecordIds: packet.records.map(
            (record) => record.source_record_id,
          ),
          beforeLogicalHash: previous,
          afterLogicalHash: next,
          import: {
            read: packet.records.length,
            imported: pass ? 0 : packet.records.length,
            duplicates: pass ? packet.records.length : 0,
            conflicts: 0,
            skipped: 0,
            queued: 0,
            simulatedAt: new Date(
              Date.parse(AT) + (pass * request.packets.length + index) * 1000,
            ).toISOString(),
          },
          diff: pass
            ? []
            : [
                'companies',
                'workplaces',
                'websites',
                'source_observations',
              ].map((table) => ({
                table,
                created: packet.records.length,
                updated: 0,
                deleted: 0,
                changedColumns: [],
              })),
        };
        previous = next;
        return step;
      }),
    ),
  };
  return seal(report);
}

test('sequence keeps packet boundaries, original records and deterministic order bindings', () => {
  const inputs = sequenceInputs();
  const before = structuredClone(inputs);
  const prepared = prepareSequence(inputs, AT);
  assert.equal(prepared.request.packets.length, 3);
  assert.deepEqual(
    prepared.request.records,
    inputs.flatMap((input) => input.seed.records),
  );
  assert.deepEqual(inputs, before);
  assert.deepEqual(prepareSequence(inputs, AT), prepared);
  assert.notEqual(
    prepareSequence([...inputs].reverse(), AT).request.planHash,
    prepared.request.planHash,
  );
  assert.notEqual(
    prepareSequence(inputs, '2026-09-04T12:00:01Z').request.planHash,
    prepared.request.planHash,
  );
});

test('sequence rejects cross-packet source IDs, www domain aliases and different waves', () => {
  for (const edit of [
    (inputs) => {
      inputs[1].seed.records[0].source_record_id =
        inputs[0].seed.records[0].source_record_id;
    },
    (inputs) => {
      inputs[1].seed.records[0].website = 'https://www.sequence-1.se/';
      inputs[1].seed.records[0].evidence_urls = ['https://www.sequence-1.se/'];
    },
    (inputs) => {
      inputs[1].seed.wave_id = 'different-wave';
    },
    (inputs) => {
      inputs[1].packetId = inputs[0].packetId;
    },
  ]) {
    const inputs = sequenceInputs();
    edit(inputs);
    for (const input of inputs)
      input.observations = observationFixture(input.seed);
    assert.throws(() => prepareSequence(inputs, AT));
  }
});

test('sequence does not silently omit an empty, paused or stale packet', () => {
  const inputs = sequenceInputs();
  inputs[1].observations.records[0].researchPause = {
    reason: 'Unknown',
    resumeWhen: 'New evidence',
  };
  assert.throws(() => prepareSequence(inputs, AT), /saknar agentklara/);
  assert.throws(
    () => prepareSequence(sequenceInputs(), '2026-09-12T12:00:00Z'),
    /saknar agentklara/,
  );
  assert.throws(() => prepareSequence([], AT));
  assert.throws(() =>
    prepareSequence([...sequenceInputs(), sequenceInputs()[0]], AT),
  );
});

test('sequence preserves the three-record seed cap and fail-closed identity fields', () => {
  const inputs = sequenceInputs();
  inputs[0].seed.records = Array(4).fill(inputs[0].seed.records[0]);
  inputs[0].seed.candidate_count = 4;
  assert.throws(() => prepareSequence(inputs, AT));
  const promoted = sequenceInputs();
  promoted[0].seed.records[0].verification_status = 'verified_current';
  assert.throws(() => prepareSequence(promoted, AT));
});

test('sequence requires exact manifest schema and explicit runtime options', () => {
  const packet = {
    packetId: 'one',
    seedPath: 'seed.json',
    seedSha256: HASH,
    observationsPath: 'obs.json',
    observationsSha256: HASH,
  };
  const manifest = { version: MANIFEST_VERSION, packets: [packet] };
  validateManifest(manifest);
  for (const bad of [
    { ...manifest, approved: true },
    { ...manifest, version: 'unknown' },
    { ...manifest, packets: [] },
    { ...manifest, packets: [packet, packet] },
    { ...manifest, packets: [{ ...packet, seedSha256: 1 }] },
    { ...manifest, packets: [{ ...packet, observationsSha256: 'missing' }] },
  ])
    assert.throws(() => validateManifest(bad));
  const args = [
    'sequence.json',
    '--at',
    AT,
    '--engine-root',
    'engine',
    '--source-db',
    'source',
    '--python',
    process.execPath,
  ];
  assert.equal(parseSequenceArguments(args).manifestPath, 'sequence.json');
  assert.deepEqual(parseSequenceArguments(['--help']), { help: true });
  for (const bad of [
    [],
    ['sequence.json'],
    [...args, '--approve'],
    [...args, '--output', '../escape'],
    [...args, '--at', AT],
  ]) {
    assert.throws(() => parseSequenceArguments(bad));
  }
});

test('sequence rechecks actual input bytes and blocks stale manifest bindings before any worker', async (t) => {
  const root = await temporary(t);
  const input = sequenceInputs()[0];
  const seedPath = join(root, 'seed.json');
  const observationsPath = join(root, 'obs.json');
  const seedBytes = JSON.stringify(input.seed);
  const seedHash =
    'sha256:' + createHash('sha256').update(seedBytes).digest('hex');
  const observationsBytes = JSON.stringify(
    observationFixture(input.seed, seedHash),
  );
  const obsHash =
    'sha256:' + createHash('sha256').update(observationsBytes).digest('hex');
  await writeFile(seedPath, seedBytes);
  await writeFile(observationsPath, observationsBytes);
  const manifestPath = join(root, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: MANIFEST_VERSION,
      packets: [
        {
          packetId: 'one',
          seedPath,
          seedSha256: seedHash,
          observationsPath,
          observationsSha256: obsHash,
        },
      ],
    }),
  );
  assert.equal(
    (await loadSequence(manifestPath, AT)).request.records.length,
    1,
  );
  await writeFile(observationsPath, observationsBytes + ' ');
  await assert.rejects(loadSequence(manifestPath, AT), /Indata har ändrats/);
});

test('sequence result requires every first and replay step bound to the same continuous chain', () => {
  const { request } = prepareSequence(sequenceInputs(), AT);
  const report = sequenceReport(request);
  assert.equal(validateWorkerResult(resultOf(report), request).status, 'PASS');
  for (const edit of [
    (r) => {
      r.sequence.sameMemoryDatabase = false;
    },
    (r) => {
      r.sequence.steps.pop();
    },
    (r) => {
      r.sequence.steps[1].beforeLogicalHash = HASH;
    },
    (r) => {
      r.sequence.steps[1].packetId = 'wrong';
    },
    (r) => {
      r.sequence.steps[1].planHash = HASH;
    },
    (r) => {
      r.sequence.steps[1].import.queued = 1;
    },
    (r) => {
      r.sequence.steps[1].import.simulatedAt = AT;
    },
    (r) => {
      r.sequence.steps[1].diff[0].updated = 1;
    },
    (r) => {
      r.sequence.steps[1].diff[0].created = 0;
    },
    (r) => {
      r.sequence.steps[4].import.imported = 1;
    },
    (r) => {
      r.sequence.steps[4].diff = [
        { table: 'audit_reviews', created: 1, updated: 0, deleted: 0 },
      ];
    },
  ]) {
    const changed = structuredClone(report);
    edit(changed);
    assert.throws(() => validateWorkerResult(resultOf(seal(changed)), request));
  }
});

test('sequence renderer distinguishes complete and blocked whole-sequence simulations', () => {
  const prepared = prepareSequence(sequenceInputs(), AT);
  const simulation = sequenceReport(prepared.request);
  assert.match(
    renderDryRun({ plan: prepared.plan, simulation }),
    /Sammanhängande paketföljd bekräftad: ja/,
  );
  simulation.status = 'BLOCKED';
  assert.match(
    renderDryRun({ plan: prepared.plan, simulation }),
    /Sammanhängande paketföljd bekräftad: nej/,
  );
  assert.doesNotMatch(
    renderDryRun({ plan: prepared.plan, simulation }),
    /Provad endast i minnet/,
  );
});
