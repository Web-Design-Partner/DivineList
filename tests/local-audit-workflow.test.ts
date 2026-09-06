/* oxlint-disable typescript/no-floating-promises -- node:test owns registered tests. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  auditDataset,
  computeBatchHash,
  computeDatasetHash,
  CONTRACT_MANIFEST_HASH,
  DATASET_HASH_CONTRACT_HASH,
  EVALUATION_POLICY_HASH,
  FACT_HASH,
  parseDatasetJson,
  serializeDatasetJson,
  RULE_HASH,
} from '../lib/audit/engine';
import {
  buildBatchResult,
  parseBatchResultJson,
} from '../lib/audit/batch-result';
import {
  parseReviewSessionJson,
  serializeReviewSession,
} from '../lib/audit/review-session';
import {
  BATCH_HASH_VERSION,
  DATASET_HASH_VERSION,
  DATASET_VERSION_V2,
  EVALUATION_POLICY_VERSION,
  FACT_REGISTRY_VERSION,
  MAPPING_VERSION,
  MAX_V2_BATCH_BYTES,
  RULESET_VERSION,
  type DatasetHashPayload,
} from '../lib/audit/types';
import {
  buildLocalAuditArtifacts,
  LOCAL_RUN_FILES,
  parseLocalAuditArguments,
  runLocalAudit,
  type LocalAuditOptions,
} from '../scripts/run-local-audit';
import { reviewDecisionKey } from '../lib/audit/obsidian';
import {
  readWorkspace,
  writeWorkspace,
  type WorkspaceStorage,
} from '../lib/workbench/workspace-storage';

const at = '2026-08-30T09:00:00.000Z';
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const batchBytes = (): Buffer => {
  const payload: DatasetHashPayload = {
    version: DATASET_VERSION_V2,
    name: 'Syntetiskt offlinepilotunderlag',
    createdAt: at,
    rulesetVersion: RULESET_VERSION,
    factRegistryVersion: FACT_REGISTRY_VERSION,
    mappingVersion: MAPPING_VERSION,
    datasetHashVersion: DATASET_HASH_VERSION,
    evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
    evaluationPolicyHash: EVALUATION_POLICY_HASH,
    factHash: FACT_HASH,
    ruleHash: RULE_HASH,
    datasetHashContractHash: DATASET_HASH_CONTRACT_HASH,
    contractManifestHash: CONTRACT_MANIFEST_HASH,
    companies: [
      {
        id: 'WORK:offline-fixture',
        workplaceUid: 'WORK:offline-fixture',
        siteUid: 'SITE:offline-fixture',
        name: 'Syntetisk verkstad',
        domain: 'fixture.example',
        city: 'Göteborg',
        industry: 'Verkstad',
        municipalityCode: '1480',
        gothenburgStatus: 'verified',
        verificationStatus: 'verified_current',
        relationshipStatus: 'verified_primary',
        relationshipConfidence: 0.9,
        renderFidelity: 'full',
        pageCoverage: { eligiblePages: 1, testedPages: 1, excludedPages: 0 },
        capturedAt: at,
        facts: [
          {
            key: 'seo.title_present',
            value: false,
            evidenceIds: ['E:offline-title'],
          },
        ],
        evidence: [
          {
            id: 'E:offline-title',
            method: 'html',
            label: 'Syntetisk observerad sidtitel',
            observedAt: at,
            strength: 'strong',
            sourceUrl: 'https://fixture.example/',
            pageId: 'PAGE:home',
            collector: 'safe-crawler',
            collectorVersion: '2.1.0',
            actor: 'tool',
            scope: 'observed-page',
            retentionClass: 'audit',
          },
        ],
        tags: ['syntetisk'],
        reviews: [],
      },
    ],
  };
  const batch = {
    ...payload,
    exportId: 'EXP:offline-fixture',
    batchId: 'BAT:offline-fixture:0000',
    batchHashVersion: BATCH_HASH_VERSION,
    datasetHash: computeDatasetHash(payload),
  };
  return Buffer.from(
    `${JSON.stringify({ ...batch, batchHash: computeBatchHash(batch) }, null, 2)}\n`,
  );
};

const batchWithReviewShape = (
  shape: 'missing' | 'empty' | 'null' | 'nonempty',
): string => {
  const batch = JSON.parse(new TextDecoder().decode(batchBytes()));
  if (shape === 'missing') delete batch.companies[0].reviews;
  else
    batch.companies[0].reviews =
      shape === 'empty'
        ? []
        : shape === 'null'
          ? null
          : [{ state: 'confirmed' }];
  const payload = Object.fromEntries(
    Object.entries(batch).filter(
      ([key]) =>
        ![
          'exportId',
          'batchId',
          'batchHashVersion',
          'datasetHash',
          'batchHash',
        ].includes(key),
    ),
  ) as unknown as DatasetHashPayload;
  batch.datasetHash = computeDatasetHash(payload);
  batch.batchHash = computeBatchHash(batch);
  return JSON.stringify(batch);
};

const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), 'divinelist-local-run-test-'));
  const inputPath = join(root, 'original.batch.json');
  const bytes = batchBytes();
  await writeFile(inputPath, bytes, { flag: 'wx' });
  const options: LocalAuditOptions = {
    inputPath,
    evaluatedAt: at,
    runName: 'pilot-one',
  };
  const directory = join(root, 'reports', 'local-runs', options.runName);
  return {
    root,
    inputPath,
    bytes,
    options,
    directory,
    cleanup: async () => {
      assert.ok(root.startsWith(join(tmpdir(), 'divinelist-local-run-test-')));
      await rm(root, { recursive: true, force: true });
    },
  };
};

test('local workflow keeps omitted V2 review fields transport-stable through a session round-trip', async () => {
  const ctx = await temporary();
  try {
    const inputBytes = Buffer.from(batchWithReviewShape('missing'));
    await writeFile(ctx.inputPath, inputBytes);
    const dataset = parseDatasetJson(new TextDecoder().decode(inputBytes));
    assert.deepEqual(dataset.companies[0].reviews, []);
    const originalResult = buildBatchResult(
      dataset,
      auditDataset(dataset, at),
      at,
    );
    const sessionText = serializeReviewSession(dataset, at, {}, at);
    const session = parseReviewSessionJson(sessionText);
    assert.equal(
      Object.hasOwn(JSON.parse(sessionText).dataset.companies[0], 'reviews'),
      false,
    );
    assert.equal(session.dataset.batchHash, dataset.batchHash);
    assert.deepEqual(session.dataset.companies[0].reviews, []);
    assert.deepEqual(
      parseReviewSessionJson(
        serializeReviewSession(session.dataset, at, {}, at),
      ),
      session,
    );
    const report = await runLocalAudit(ctx.options, ctx.root);
    assert.equal(report.workflowCompleted, true);
    assert.deepEqual(
      await readFile(join(ctx.directory, 'input.batch.json')),
      inputBytes,
    );
    const result = parseBatchResultJson(
      await readFile(join(ctx.directory, 'result.sealed.json'), 'utf8'),
      dataset,
    );
    assert.deepEqual(result, buildBatchResult(dataset, result.companies, at));
    assert.equal(result.resultHash, originalResult.resultHash);
    assert.deepEqual(result, JSON.parse(JSON.stringify(originalResult)));
    assert.deepEqual(await readFile(ctx.inputPath), inputBytes);
  } finally {
    await ctx.cleanup();
  }
});

test('V2 transport preserves missing versus empty review fields and old normalized evaluation', () => {
  const missing = parseDatasetJson(batchWithReviewShape('missing'));
  const empty = parseDatasetJson(batchWithReviewShape('empty'));
  assert.deepEqual(auditDataset(missing, at), auditDataset(empty, at));
  for (const [shape, dataset] of [
    ['missing', missing],
    ['empty', empty],
  ] as const) {
    const transport = serializeDatasetJson(dataset);
    assert.deepEqual(
      JSON.parse(transport),
      JSON.parse(batchWithReviewShape(shape)),
    );
    assert.equal(
      Object.hasOwn(JSON.parse(transport).companies[0], 'reviews'),
      shape === 'empty',
    );
    assert.equal(parseDatasetJson(transport).batchHash, dataset.batchHash);
    const restored = parseReviewSessionJson(
      serializeReviewSession(dataset, at, {}, at),
    );
    assert.equal(
      Object.hasOwn(restored.envelope.dataset.companies[0], 'reviews'),
      shape === 'empty',
    );
    assert.deepEqual(restored.dataset, dataset);
    assert.deepEqual(
      parseReviewSessionJson(JSON.stringify(restored.envelope)),
      restored,
    );
  }
});

test('V2 transport cannot recover old sealed bytes from a mutated parser object or guessed clone', () => {
  const dataset = parseDatasetJson(batchWithReviewShape('missing'));
  const transport = serializeDatasetJson(dataset);
  const externalCopy = JSON.parse(transport);
  externalCopy.companies[0].name = 'Untrusted changed copy';
  assert.equal(serializeDatasetJson(dataset), transport);
  assert.throws(
    () => serializeDatasetJson(structuredClone(dataset)),
    /batchHash/u,
  );
  dataset.companies[0].name = 'Changed normalized object';
  assert.throws(() => serializeDatasetJson(dataset), /ändrats/u);
  assert.throws(() => serializeReviewSession(dataset, at, {}, at), /ändrats/u);
  assert.equal(JSON.parse(transport).companies[0].name, 'Syntetisk verkstad');
});

test('V2 transport keeps the existing rejection of null and nonempty review arrays', () => {
  for (const shape of ['null', 'nonempty'] as const) {
    const json = batchWithReviewShape(shape);
    assert.throws(() => parseDatasetJson(json), /reviews/u);
    assert.throws(() => serializeDatasetJson(JSON.parse(json)), /reviews/u);
  }
});

test('V2 transport remains intact when autosaving and restoring an unfinished review draft', () => {
  const dataset = parseDatasetJson(batchWithReviewShape('missing'));
  const audit = auditDataset(dataset, at)[0];
  const result = audit.results.find(
    (item) =>
      item.state === 'needs_review' && item.proposedState !== 'not_detected',
  )!;
  assert.ok(result);
  const key = reviewDecisionKey(audit.company.id, result.ruleId);
  const values = new Map<string, string>();
  const storage: WorkspaceStorage = {
    getItem(name) {
      return values.get(name) ?? null;
    },
    setItem(name, value) {
      values.set(name, value);
    },
    removeItem(name) {
      values.delete(name);
    },
  };
  const input = {
    dataset,
    evaluatedAt: at,
    decisions: {},
    reviewDrafts: {
      [key]: { choice: 'manual_check' as const, rationale: 'Ofärdigt' },
    },
  };
  const first = writeWorkspace(storage, input, {
    expectedRevision: null,
    writerId: 'fixture',
    savedAt: at,
  });
  const restored = readWorkspace(storage)!;
  assert.equal(restored.revision, first.revision);
  assert.deepEqual(restored.reviewDrafts, input.reviewDrafts);
  assert.deepEqual(restored.session.decisions, {});
  assert.equal(
    Object.hasOwn(
      JSON.parse(serializeDatasetJson(restored.session.dataset)).companies[0],
      'reviews',
    ),
    false,
  );
  writeWorkspace(
    storage,
    { ...input, dataset: restored.session.dataset },
    { expectedRevision: restored.revision, writerId: 'fixture', savedAt: at },
  );
  assert.deepEqual(readWorkspace(storage)!.reviewDrafts, input.reviewDrafts);
});

test('local workflow creates one verifiable package without changing source or inventing data approval', async () => {
  const ctx = await temporary();
  try {
    const before = await stat(ctx.inputPath);
    const report = await runLocalAudit(ctx.options, ctx.root);
    assert.equal(report.status, 'WORKFLOW_COMPLETED');
    assert.equal(report.mode, 'created');
    assert.deepEqual(report.createdFiles, [...LOCAL_RUN_FILES]);
    assert.equal(report.manifest.guardrails.productionReady, false);
    assert.equal(report.manifest.guardrails.dataGateStatus, 'not_assessed');
    assert.equal(report.manifest.guardrails.runtimeWrites, false);
    assert.equal(report.manifest.guardrails.activeVaultWrites, false);
    assert.equal(report.manifest.guardrails.humanDecisionsRecorded, false);
    assert.equal(report.manifest.summary.companies, 1);
    assert.equal(report.manifest.summary.rules, 120);
    assert.ok(
      Object.entries(report.manifest.summary.execution).some(
        ([key, value]) => key !== 'completed' && value > 0,
      ),
    );
    assert.ok(report.manifest.summary.states.needs_review > 0);
    const dataset = parseDatasetJson(
      await readFile(join(ctx.directory, 'input.batch.json'), 'utf8'),
    );
    const result = parseBatchResultJson(
      await readFile(join(ctx.directory, 'result.sealed.json'), 'utf8'),
      dataset,
    );
    assert.equal(result.batchHash, dataset.batchHash);
    const session = parseReviewSessionJson(
      await readFile(join(ctx.directory, 'review-session.json'), 'utf8'),
    );
    assert.deepEqual(session.decisions, {});
    assert.equal(session.envelope.productionBatchResult, false);
    const obsidian = await readFile(
      join(ctx.directory, 'obsidian-workcopy.md'),
      'utf8',
    );
    assert.match(obsidian, /outreach_state: "not_authorized"/u);
    for (const entry of report.manifest.files) {
      const content = await readFile(join(ctx.directory, entry.name));
      assert.equal(content.byteLength, entry.bytes);
      assert.equal(hash(content), entry.sha256);
    }
    assert.deepEqual(await readFile(ctx.inputPath), ctx.bytes);
    assert.equal((await stat(ctx.inputPath)).mtimeMs, before.mtimeMs);
    assert.deepEqual(
      (await readdir(ctx.directory)).sort(),
      [...LOCAL_RUN_FILES].sort(),
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow repeat verifies all existing bytes without rewriting artifacts', async () => {
  const ctx = await temporary();
  try {
    await runLocalAudit(ctx.options, ctx.root);
    const metadata = await Promise.all(
      LOCAL_RUN_FILES.map((name) => stat(join(ctx.directory, name))),
    );
    const repeat = await runLocalAudit(ctx.options, ctx.root);
    assert.equal(repeat.mode, 'verified_existing');
    assert.deepEqual(repeat.createdFiles, []);
    const after = await Promise.all(
      LOCAL_RUN_FILES.map((name) => stat(join(ctx.directory, name))),
    );
    assert.deepEqual(
      after.map((item) => [item.ino, item.mtimeMs, item.size]),
      metadata.map((item) => [item.ino, item.mtimeMs, item.size]),
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow resumes a partial package only after checking every existing file', async () => {
  const ctx = await temporary();
  try {
    const expected = buildLocalAuditArtifacts(ctx.bytes, ctx.options);
    await mkdir(ctx.directory, { recursive: true });
    for (const name of ['run-intent.json', 'input.batch.json'] as const)
      await writeFile(join(ctx.directory, name), expected.files.get(name)!, {
        flag: 'wx',
      });
    const before = await stat(join(ctx.directory, 'input.batch.json'));
    const resumed = await runLocalAudit(ctx.options, ctx.root);
    assert.equal(resumed.mode, 'resumed');
    assert.equal(resumed.createdFiles.length, 4);
    assert.equal(
      (await stat(join(ctx.directory, 'input.batch.json'))).mtimeMs,
      before.mtimeMs,
    );
    assert.deepEqual(
      await readFile(join(ctx.directory, 'run-manifest.json')),
      expected.files.get('run-manifest.json'),
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow blocks input, evaluation time or policy drift under an existing run name', async () => {
  const ctx = await temporary();
  try {
    await runLocalAudit(ctx.options, ctx.root);
    const manifestBefore = await readFile(
      join(ctx.directory, 'run-manifest.json'),
    );
    await assert.rejects(
      runLocalAudit(
        { ...ctx.options, evaluatedAt: '2026-08-30T10:00:00.000Z' },
        ctx.root,
      ),
      /avviker/u,
    );
    await writeFile(
      ctx.inputPath,
      Buffer.concat([ctx.bytes, Buffer.from(' ')]),
    );
    await assert.rejects(runLocalAudit(ctx.options, ctx.root), /avviker/u);
    await writeFile(ctx.inputPath, ctx.bytes);
    const intentPath = join(ctx.directory, 'run-intent.json');
    const intent = JSON.parse(await readFile(intentPath, 'utf8'));
    intent.evaluationPolicyHash = `sha256:${'0'.repeat(64)}`;
    await writeFile(intentPath, JSON.stringify(intent));
    await assert.rejects(runLocalAudit(ctx.options, ctx.root), /avviker/u);
    assert.deepEqual(
      await readFile(join(ctx.directory, 'run-manifest.json')),
      manifestBefore,
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow refuses tampered partial output before adding any missing file', async () => {
  const ctx = await temporary();
  try {
    const expected = buildLocalAuditArtifacts(ctx.bytes, ctx.options);
    await mkdir(ctx.directory, { recursive: true });
    await writeFile(
      join(ctx.directory, 'run-intent.json'),
      expected.files.get('run-intent.json')!,
    );
    await writeFile(join(ctx.directory, 'input.batch.json'), 'tampered');
    await assert.rejects(runLocalAudit(ctx.options, ctx.root), /avviker/u);
    assert.deepEqual((await readdir(ctx.directory)).sort(), [
      'input.batch.json',
      'run-intent.json',
    ]);
    assert.equal(
      await readFile(join(ctx.directory, 'input.batch.json'), 'utf8'),
      'tampered',
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow leaves stale locks and unknown files untouched', async () => {
  const ctx = await temporary();
  try {
    await mkdir(ctx.directory, { recursive: true });
    const lockPath = join(ctx.directory, '.run.lock');
    await writeFile(lockPath, 'previous-process');
    await assert.rejects(runLocalAudit(ctx.options, ctx.root), /låst/u);
    assert.equal(await readFile(lockPath, 'utf8'), 'previous-process');
    await unlink(lockPath);
    await writeFile(join(ctx.directory, '.interrupted.tmp'), 'preserve');
    await assert.rejects(runLocalAudit(ctx.options, ctx.root), /okänd/u);
    assert.deepEqual(await readdir(ctx.directory), ['.interrupted.tmp']);
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow simultaneous calls either verify one package or stop at the owned lock', async () => {
  const ctx = await temporary();
  try {
    const results = await Promise.allSettled([
      runLocalAudit(ctx.options, ctx.root),
      runLocalAudit(ctx.options, ctx.root),
    ]);
    assert.ok(results.some((item) => item.status === 'fulfilled'));
    for (const item of results) {
      if (item.status === 'rejected')
        assert.match(String(item.reason), /låst/u);
      else assert.equal(item.value.workflowCompleted, true);
    }
    assert.deepEqual(
      (await readdir(ctx.directory)).sort(),
      [...LOCAL_RUN_FILES].sort(),
    );
    assert.equal(
      (await runLocalAudit(ctx.options, ctx.root)).mode,
      'verified_existing',
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow does not adopt an orphaned result without its original run intent', async () => {
  const ctx = await temporary();
  try {
    const expected = buildLocalAuditArtifacts(ctx.bytes, ctx.options);
    await mkdir(ctx.directory, { recursive: true });
    await writeFile(
      join(ctx.directory, 'result.sealed.json'),
      expected.files.get('result.sealed.json')!,
    );
    await assert.rejects(
      runLocalAudit(ctx.options, ctx.root),
      /ursprungliga bindning/u,
    );
    assert.deepEqual(await readdir(ctx.directory), ['result.sealed.json']);
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow rejects unsafe or incomplete arguments and output-root overrides', () => {
  assert.equal(
    parseLocalAuditArguments(['batch.json', '--at', at, '--run', 'pilot-1'])
      .runName,
    'pilot-1',
  );
  for (const args of [
    [],
    ['batch.json'],
    ['batch.json', '--at', at, '--run', '../escape'],
    ['batch.json', '--at', at, '--run', 'CON'],
    ['batch.json', '--at', at, '--at', at],
    ['batch.json', '--at', at, '--output', 'elsewhere'],
    ['batch.json', '--at', 'not-a-time', '--run', 'pilot'],
    ['batch.json', '--at', '2999-01-01T00:00:00.000Z', '--run', 'pilot'],
    ['batch.json', '--at', at, '--run', 'pilot', '--extra'],
  ])
    assert.throws(() => parseLocalAuditArguments(args));
});

test('local workflow rejects invalid or oversized input before creating report directories', async () => {
  const ctx = await temporary();
  try {
    for (const bytes of [
      Buffer.from([0xff]),
      Buffer.from('{}'),
      Buffer.alloc(MAX_V2_BATCH_BYTES + 1, 32),
    ]) {
      await writeFile(ctx.inputPath, bytes);
      await assert.rejects(runLocalAudit(ctx.options, ctx.root));
      assert.deepEqual(await readdir(ctx.root), ['original.batch.json']);
    }
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow rejects network paths and input from its own outputs', async () => {
  const ctx = await temporary();
  try {
    for (const inputPath of [
      '\\\\server\\share\\batch.json',
      '//server/share/batch.json',
      '\\\\?\\C:\\batch.json',
    ])
      await assert.rejects(
        runLocalAudit({ ...ctx.options, inputPath }, ctx.root),
      );
    await runLocalAudit(ctx.options, ctx.root);
    await assert.rejects(
      runLocalAudit(
        {
          ...ctx.options,
          inputPath: join(ctx.directory, 'input.batch.json'),
          runName: 'another',
        },
        ctx.root,
      ),
      /egen utdatakatalog/u,
    );
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow rejects junction ancestors and hardlink aliases without changing their targets', async () => {
  const ctx = await temporary();
  try {
    const outside = join(ctx.root, 'separate-source');
    const alias = join(ctx.root, 'redirect');
    await mkdir(outside);
    await writeFile(join(outside, 'batch.json'), ctx.bytes);
    await symlink(
      outside,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      runLocalAudit(
        { ...ctx.options, inputPath: join(alias, 'batch.json') },
        ctx.root,
      ),
    );
    assert.deepEqual(await readFile(join(outside, 'batch.json')), ctx.bytes);
    const hardAlias = join(ctx.root, 'hard-alias.json');
    await link(ctx.inputPath, hardAlias);
    await assert.rejects(
      runLocalAudit({ ...ctx.options, inputPath: hardAlias }, ctx.root),
    );
    assert.deepEqual(await readFile(ctx.inputPath), ctx.bytes);
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow refuses redirected output parents without writing outside the designated tree', async () => {
  const ctx = await temporary();
  try {
    const other = join(ctx.root, 'other-directory');
    await mkdir(other);
    await writeFile(join(other, 'keep.txt'), 'untouched');
    await symlink(
      other,
      join(ctx.root, 'reports'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(runLocalAudit(ctx.options, ctx.root));
    assert.deepEqual(await readdir(other), ['keep.txt']);
    assert.equal(await readFile(join(other, 'keep.txt'), 'utf8'), 'untouched');
  } finally {
    await ctx.cleanup();
  }
});

test('local workflow handles read-only source and restores missing bytes without overwriting retained files', async () => {
  const ctx = await temporary();
  try {
    await chmod(ctx.inputPath, 0o444);
    await runLocalAudit(ctx.options, ctx.root);
    await unlink(join(ctx.directory, 'review-session.json'));
    const before = await stat(join(ctx.directory, 'result.sealed.json'));
    const resumed = await runLocalAudit(ctx.options, ctx.root);
    assert.deepEqual(resumed.createdFiles, ['review-session.json']);
    assert.equal(
      (await stat(join(ctx.directory, 'result.sealed.json'))).mtimeMs,
      before.mtimeMs,
    );
    assert.deepEqual(await readFile(ctx.inputPath), ctx.bytes);
  } finally {
    await chmod(ctx.inputPath, 0o600);
    await ctx.cleanup();
  }
});

test('local workflow CLI offers bounded help and rejects arguments without running an import', () => {
  const cli = resolve('scripts/run-local-audit.mjs');
  const help = execFileSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
  });
  assert.match(help, /Ingen insamling/u);
  try {
    execFileSync(
      process.execPath,
      [cli, 'missing.json', '--at', at, '--output', 'escape'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.fail('CLI should reject output overrides');
  } catch (error) {
    assert.equal((error as { status?: number }).status, 2);
    const report = JSON.parse((error as { stdout: string }).stdout);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.workflowCompleted, false);
    assert.equal(report.productionReady, false);
  }
});
