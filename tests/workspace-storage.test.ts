/* oxlint-disable typescript/no-floating-promises -- node:test owns registered tests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDataset, stableHash } from '../lib/audit/engine';
import {
  buildReviewDecisionBinding,
  reviewDecisionKey,
} from '../lib/audit/obsidian';
import { serializeReviewSession } from '../lib/audit/review-session';
import { SAMPLE_DATASET } from '../lib/audit/sample-data';
import {
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_DRAFTS,
  WORKSPACE_STORAGE_KEY,
  WorkspaceStorageError,
  readWorkspace,
  writeWorkspace,
  type WorkspaceInput,
  type WorkspaceStorage,
  type WorkspaceStorageErrorCode,
} from '../lib/workbench/workspace-storage';

const at = '2026-08-30T09:00:00.000Z';
const options = { expectedRevision: null, writerId: 'tab-one', savedAt: at };

class MemoryStorage implements WorkspaceStorage {
  values = new Map<string, string>();
  writes = 0;
  removals = 0;
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.removals += 1;
    this.values.delete(key);
  }
}

const fixture = (): { input: WorkspaceInput; key: string } => {
  const dataset = structuredClone(SAMPLE_DATASET);
  const audit = auditDataset(dataset, at)[0];
  const result = audit.results.find(
    (item) =>
      item.state === 'needs_review' && item.proposedState !== 'not_detected',
  )!;
  assert.ok(result);
  const key = reviewDecisionKey(audit.company.id, result.ruleId);
  return {
    key,
    input: {
      dataset,
      evaluatedAt: at,
      decisions: {
        [key]: {
          ...buildReviewDecisionBinding(dataset, audit.company.id, result),
          state: 'manual_check',
          rationale: 'Separat kontroll av det bevarade underlaget behövs.',
          decidedAt: at,
        },
      },
      reviewDrafts: { [key]: { choice: 'dismissed', rationale: 'Påbörjat' } },
    },
  };
};

const expectError = (code: WorkspaceStorageErrorCode, action: () => unknown) =>
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof WorkspaceStorageError && error.code === code,
  );

const tamper = (
  storage: MemoryStorage,
  change: (value: Record<string, unknown>) => void,
  rehash = true,
) => {
  const value = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY)!) as Record<
    string,
    unknown
  >;
  change(value);
  if (rehash) {
    const { workspaceHash: _old, ...payload } = value;
    value.workspaceHash = stableHash(payload);
  }
  storage.values.set(WORKSPACE_STORAGE_KEY, JSON.stringify(value));
};

test('autosave round-trip binds session and unfinished drafts without confirming either', () => {
  const storage = new MemoryStorage();
  const { input, key } = fixture();
  assert.equal(readWorkspace(storage), null);
  const saved = writeWorkspace(storage, input, options);
  const restored = readWorkspace(storage)!;
  assert.deepEqual(restored, saved);
  assert.deepEqual(restored.reviewDrafts, input.reviewDrafts);
  assert.equal(restored.session.decisions[key].state, 'manual_check');
  assert.equal(restored.reviewDrafts[key].choice, 'dismissed');
  assert.equal(restored.session.envelope.productionBatchResult, false);
  assert.equal('savedDecisionHash' in restored, false);
  assert.equal('outreachAuthorized' in restored, false);
  assert.equal(storage.removals, 0);
  assert.deepEqual(input, fixture().input);
});

test('autosave accepts short and empty drafts, not only completed review rationales', () => {
  const { input, key } = fixture();
  input.reviewDrafts[key].rationale = '';
  const storage = new MemoryStorage();
  writeWorkspace(storage, input, options);
  assert.equal(readWorkspace(storage)!.reviewDrafts[key].rationale, '');
});

test('autosave revision blocks stale tabs and default-demo overwrites', () => {
  const storage = new MemoryStorage();
  const { input } = fixture();
  const first = writeWorkspace(storage, input, options);
  const second = writeWorkspace(storage, input, {
    ...options,
    expectedRevision: first.revision,
  });
  const unchanged = storage.getItem(WORKSPACE_STORAGE_KEY);
  assert.notEqual(first.revision, second.revision);
  expectError('stale_writer', () => writeWorkspace(storage, input, options));
  expectError('stale_writer', () =>
    writeWorkspace(storage, input, {
      ...options,
      writerId: 'tab-two',
      expectedRevision: first.revision,
    }),
  );
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), unchanged);
  assert.equal(storage.writes, 2);
});

test('autosave never silently replaces unsupported versions or damaged copies', () => {
  const storage = new MemoryStorage();
  const { input } = fixture();
  for (const [raw, code] of [
    ['{"version":"future-version"}', 'schema_mismatch'],
    ['{broken', 'corrupt'],
  ] as const) {
    storage.values.set(WORKSPACE_STORAGE_KEY, raw);
    expectError(code, () => readWorkspace(storage));
    expectError(code, () => writeWorkspace(storage, input, options));
    assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), raw);
  }
  assert.equal(storage.writes, 0);
});

test('autosave detects content tampering before returning any restoration state', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, fixture().input, options);
  tamper(
    storage,
    (value) => {
      value.savedAt = '2026-08-30T09:01:00.000Z';
    },
    false,
  );
  expectError('corrupt', () => readWorkspace(storage));
});

test('autosave verifies the inner session even when outer checksum is recomputed', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, fixture().input, options);
  tamper(storage, (value) => {
    const session = JSON.parse(value.sessionJson as string);
    session.decisions[0].state = 'confirmed';
    value.sessionJson = JSON.stringify(session);
  });
  expectError('corrupt', () => readWorkspace(storage));
});

test('autosave rejects unknown fields and duplicate drafts even with recomputed checksum', () => {
  for (const change of [
    (value: Record<string, unknown>) => {
      value.outreachAuthorized = true;
    },
    (value: Record<string, unknown>) => {
      (value.drafts as unknown[]).push((value.drafts as unknown[])[0]);
    },
    (value: Record<string, unknown>) => {
      (value.drafts as Record<string, unknown>[])[0].humanApproved = true;
    },
  ]) {
    const storage = new MemoryStorage();
    writeWorkspace(storage, fixture().input, options);
    tamper(storage, change);
    expectError('corrupt', () => readWorkspace(storage));
  }
});

test('autosave rejects copied draft keys and stale result bindings', () => {
  for (const change of [
    (value: Record<string, unknown>) => {
      (value.drafts as Record<string, unknown>[])[0].key =
        '["other-company","rule"]';
    },
    (value: Record<string, unknown>) => {
      (value.drafts as Record<string, unknown>[])[0].bindingHash =
        `sha256:${'0'.repeat(64)}`;
    },
    (value: Record<string, unknown>) => {
      const dataset = structuredClone(SAMPLE_DATASET);
      dataset.createdAt = '2026-08-30T08:30:00.000Z';
      value.sessionJson = serializeReviewSession(
        dataset,
        dataset.createdAt,
        {},
        at,
      );
    },
  ]) {
    const storage = new MemoryStorage();
    writeWorkspace(storage, fixture().input, options);
    tamper(storage, change);
    expectError('corrupt', () => readWorkspace(storage));
  }
});

test('autosave refuses foreign or non-reviewable draft targets before writing', () => {
  const { input } = fixture();
  const audit = auditDataset(input.dataset, at)[0];
  const nonReviewable = audit.results.find(
    (result) => result.state !== 'detected' && result.state !== 'needs_review',
  );
  assert.ok(nonReviewable);
  for (const key of [
    '__proto__',
    '["other-company","rule"]',
    reviewDecisionKey(audit.company.id, nonReviewable.ruleId),
  ]) {
    const storage = new MemoryStorage();
    input.reviewDrafts = { [key]: { choice: 'manual_check', rationale: '' } };
    expectError('invalid', () => writeWorkspace(storage, input, options));
    assert.equal(storage.writes, 0);
  }
});

test('autosave bounds draft length, count and portable text before writing', () => {
  const { input, key } = fixture();
  const storage = new MemoryStorage();
  for (const rationale of ['x'.repeat(601), '\ud800']) {
    input.reviewDrafts = { [key]: { choice: 'manual_check', rationale } };
    expectError('invalid', () => writeWorkspace(storage, input, options));
  }
  input.reviewDrafts = Object.fromEntries(
    Array.from({ length: MAX_WORKSPACE_DRAFTS + 1 }, (_, i) => [
      String(i),
      { choice: 'manual_check', rationale: '' },
    ]),
  );
  expectError('invalid', () => writeWorkspace(storage, input, options));
  assert.equal(storage.writes, 0);
});

test('autosave caps UTF-8 storage bytes before parsing', () => {
  const storage = new MemoryStorage();
  storage.values.set(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({ text: 'å'.repeat(MAX_WORKSPACE_BYTES / 2) }),
  );
  expectError('too_large', () => readWorkspace(storage));
});

test('autosave rejects a valid oversized session before replacing an older copy', () => {
  const storage = new MemoryStorage();
  const { input } = fixture();
  const saved = writeWorkspace(storage, input, options);
  const oldRaw = storage.getItem(WORKSPACE_STORAGE_KEY);
  const source = SAMPLE_DATASET.companies[0];
  input.dataset.companies = Array.from({ length: 2 }, (_, companyIndex) => ({
    ...structuredClone(source),
    id: `size-company-${companyIndex}`,
    facts: [],
    evidence: Array.from({ length: 500 }, (_, index) => ({
      ...source.evidence[0],
      id: `size-evidence-${index}`,
      note: 'å'.repeat(2_000),
    })),
  }));
  input.decisions = {};
  input.reviewDrafts = {};
  expectError('too_large', () =>
    writeWorkspace(storage, input, {
      ...options,
      expectedRevision: saved.revision,
    }),
  );
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), oldRaw);
  assert.equal(storage.writes, 1);
});

test('autosave checks the revision again immediately before the write', () => {
  const storage = new MemoryStorage();
  const { input } = fixture();
  let reads = 0;
  const changing: WorkspaceStorage = {
    getItem() {
      reads += 1;
      return reads === 1 ? null : '{newer-copy}';
    },
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
  };
  expectError('stale_writer', () => writeWorkspace(changing, input, options));
  assert.equal(storage.writes, 0);
});

test('autosave reports unavailable read storage and quota writes explicitly', () => {
  const { input } = fixture();
  const storage = new MemoryStorage();
  const unavailable: WorkspaceStorage = {
    getItem() {
      throw new DOMException('Disabled', 'SecurityError');
    },
    setItem() {
      throw new Error('must not write');
    },
    removeItem() {
      throw new Error('must not remove');
    },
  };
  expectError('unavailable', () => readWorkspace(unavailable));
  expectError('unavailable', () => writeWorkspace(unavailable, input, options));
  const quota: WorkspaceStorage = {
    getItem: storage.getItem.bind(storage),
    setItem() {
      throw new DOMException('Full', 'QuotaExceededError');
    },
    removeItem: storage.removeItem.bind(storage),
  };
  expectError('quota', () => writeWorkspace(quota, input, options));
  assert.equal(readWorkspace(storage), null);
});

test('autosave readback never reports success for ignored or replaced writes', () => {
  const storage = new MemoryStorage();
  const { input } = fixture();
  const ignored: WorkspaceStorage = {
    getItem: storage.getItem.bind(storage),
    setItem() {},
    removeItem: storage.removeItem.bind(storage),
  };
  expectError('stale_writer', () => writeWorkspace(ignored, input, options));
  const conflicting: WorkspaceStorage = {
    ...ignored,
    setItem(key, value) {
      storage.setItem(key, value);
      storage.values.set(key, '{another-writer}');
    },
  };
  expectError('stale_writer', () =>
    writeWorkspace(conflicting, input, options),
  );
});

test('autosave validates decision binding and writer identity before any write', () => {
  const storage = new MemoryStorage();
  const { input, key } = fixture();
  expectError('invalid', () =>
    writeWorkspace(storage, input, { ...options, writerId: '../bad-writer' }),
  );
  input.decisions[key].companyId = 'not-the-company';
  expectError('invalid', () => writeWorkspace(storage, input, options));
  assert.equal(storage.writes, 0);
});
