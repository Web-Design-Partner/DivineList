/* oxlint-disable typescript/no-floating-promises -- node:test registers promises. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIT_RULES } from '../lib/audit/catalog';
import {
  CONTRACT_MANIFEST_HASH,
  EVALUATION_POLICY_HASH,
  FACT_HASH,
  RULE_HASH,
  stableHash,
} from '../lib/audit/engine';
import type { CompanySnapshot } from '../lib/audit/types';
import {
  getWorkbenchRuleCoverage,
  MAX_WORKBENCH_BYTES,
  MAX_WORKBENCH_COMPANIES,
  parseWorkbenchSnapshotJson,
  WORKBENCH_ADAPTER_SOURCE_SHA256,
  WORKBENCH_ADAPTER_VERSION,
  WORKBENCH_MAPPED_FACT_KEYS,
  WORKBENCH_SCHEMA_HASH,
  WORKBENCH_SNAPSHOT_VERSION,
  WORKBENCH_SOURCE_VERSION,
  workbenchSnapshotIsStaleAt,
  workbenchSourceDigest,
  type WorkbenchSnapshot,
} from '../lib/workbench/snapshot';

const NOW = '2026-09-04T15:00:00.000Z';
const payload = (): WorkbenchSnapshot => {
  const companies: WorkbenchSnapshot['companies'] = [
    {
      companyUid: 'CO:fixture',
      workplaceUid: 'WP:fixture',
      name: 'Syntetiskt Café',
      workplaceName: 'Syntetiskt Café — Haga',
      domain: 'fixture.se',
      reasonCodes: ['analysis_batch_required', 'collection_missing'],
      latestScan: null,
    },
  ];
  const value = {
    version: WORKBENCH_SNAPSHOT_VERSION,
    generatedAt: NOW,
    sourceCapturedAt: NOW,
    sourceVersion: WORKBENCH_SOURCE_VERSION,
    sourceSchemaHash: WORKBENCH_SCHEMA_HASH,
    sourceDigest: workbenchSourceDigest(companies),
    bindings: {
      factHash: FACT_HASH,
      ruleHash: RULE_HASH,
      evaluationPolicyHash: EVALUATION_POLICY_HASH,
      contractManifestHash: CONTRACT_MANIFEST_HASH,
    },
    adapterCoverage: {
      version: WORKBENCH_ADAPTER_VERSION,
      sourceSha256: WORKBENCH_ADAPTER_SOURCE_SHA256,
      factKeys: [...WORKBENCH_MAPPED_FACT_KEYS],
    },
    companies,
  };
  return { ...value, snapshotHash: stableHash(value) };
};
function reseal(value: WorkbenchSnapshot): string {
  value.sourceDigest = workbenchSourceDigest(value.companies);
  const { snapshotHash: _ignored, ...body } = value;
  return JSON.stringify({ ...body, snapshotHash: stableHash(body) });
}
function company(): CompanySnapshot {
  return {
    id: 'WP:fixture',
    workplaceUid: 'WP:fixture',
    name: 'Syntetiskt Café',
    domain: 'fixture.se',
    capturedAt: NOW,
    facts: [
      { key: 'seo.title_present', value: false, evidenceIds: ['E:title'] },
    ],
    evidence: [
      {
        id: 'E:title',
        method: 'html',
        label: 'Synthetic title observation',
        observedAt: NOW,
        strength: 'strong',
      },
    ],
  };
}

test('workbench: accepts bounded real-inventory shape without granting readiness', () => {
  const parsed = parseWorkbenchSnapshotJson(JSON.stringify(payload()), NOW);
  assert.equal(parsed.companies[0].name, 'Syntetiskt Café');
  assert.equal('algorithmReady' in parsed.companies[0], false);
  assert.equal('productionReady' in parsed, false);
  assert.deepEqual(parsed.companies[0].reasonCodes, [
    'analysis_batch_required',
    'collection_missing',
  ]);
});

test('workbench: empty inventory remains valid but has no analysis evidence', () => {
  const value = payload();
  value.companies = [];
  const parsed = parseWorkbenchSnapshotJson(reseal(value), NOW);
  assert.equal(parsed.companies.length, 0);
  assert.equal(getWorkbenchRuleCoverage(parsed).length, 120);
  assert.ok(
    getWorkbenchRuleCoverage(parsed).every(
      (rule) => rule.observedFactKeys.length === 0,
    ),
  );
});

test('workbench: stale inventory is marked stale without refreshing source time', () => {
  const parsed = parseWorkbenchSnapshotJson(
    JSON.stringify(payload()),
    '2026-09-06T15:00:00Z',
  );
  assert.equal(
    workbenchSnapshotIsStaleAt(parsed, '2026-09-05T15:00:00.000Z'),
    false,
  );
  assert.equal(
    workbenchSnapshotIsStaleAt(parsed, '2026-09-05T15:00:00.001Z'),
    true,
  );
  assert.equal(parsed.sourceCapturedAt, NOW);
});

test('workbench: future timestamps, impossible dates and renewed source age are rejected', () => {
  for (const mutate of [
    (value: WorkbenchSnapshot) => {
      value.generatedAt = '2026-09-04T16:00:00Z';
      value.sourceCapturedAt = value.generatedAt;
    },
    (value: WorkbenchSnapshot) => {
      value.sourceCapturedAt = '2026-02-30T15:00:00Z';
    },
    (value: WorkbenchSnapshot) => {
      value.sourceCapturedAt = '2026-09-03T15:00:00Z';
    },
    (value: WorkbenchSnapshot) => {
      value.sourceCapturedAt = '2026-09-04T15:00:01Z';
    },
  ]) {
    const value = payload();
    mutate(value);
    assert.throws(() => parseWorkbenchSnapshotJson(reseal(value), NOW));
  }
});

test('workbench: exact frozen policy and schema bindings are mandatory', () => {
  for (const key of Object.keys(payload().bindings) as Array<
    keyof WorkbenchSnapshot['bindings']
  >) {
    const value = payload();
    value.bindings[key] = 'sha256:' + '0'.repeat(64);
    assert.throws(
      () => parseWorkbenchSnapshotJson(reseal(value), NOW),
      /policyversion/u,
    );
  }
  const value = payload();
  value.sourceSchemaHash = 'sha256:' + '0'.repeat(64);
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /databasschema/u,
  );
});

test('workbench: injected adapter metadata cannot manufacture supported rules', () => {
  const value = payload();
  value.adapterCoverage.factKeys.push('transport.tls_valid');
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /adapterkoden/u,
  );
  value.adapterCoverage.factKeys = [...WORKBENCH_MAPPED_FACT_KEYS];
  value.adapterCoverage.sourceSha256 = 'sha256:' + '1'.repeat(64);
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /adapterkoden/u,
  );
  const untrusted = payload();
  untrusted.adapterCoverage.factKeys.push('transport.tls_valid');
  assert.ok(
    getWorkbenchRuleCoverage(untrusted)
      .find((rule) => rule.ruleId === 'AVL-005')!
      .missingAdapterFacts.includes('transport.tls_valid'),
  );
});

test('workbench: top-level and nested privacy or readiness fields are rejected', () => {
  for (const target of ['root', 'company', 'adapter'] as const) {
    const value = payload();
    const entry =
      target === 'root'
        ? value
        : target === 'company'
          ? value.companies[0]
          : value.adapterCoverage;
    Object.assign(entry, {
      algorithmReady: true,
      privateEmail: 'synthetic@example.invalid',
    });
    assert.throws(
      () => parseWorkbenchSnapshotJson(reseal(value), NOW),
      /fält/u,
    );
  }
});

test('workbench: duplicate JSON keys including escaped keys are rejected', () => {
  const text = JSON.stringify(payload());
  assert.throws(
    () =>
      parseWorkbenchSnapshotJson(
        text.replace('"name":', '"name":"unused","na\\u006de":'),
        NOW,
      ),
    /dubblerade/u,
  );
});

test('workbench: duplicate workplace identifiers and removed batch guard are rejected', () => {
  const value = payload();
  value.companies.push(structuredClone(value.companies[0]));
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /samma arbetsplats/u,
  );
  value.companies = [value.companies[0]];
  value.companies[0].reasonCodes = ['collection_missing'];
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /statusorsaker/u,
  );
});

test('workbench: changed inventory or envelope is rejected unless explicitly re-created', () => {
  const value = payload();
  value.companies[0].name = 'Another name';
  assert.throws(
    () => parseWorkbenchSnapshotJson(JSON.stringify(value), NOW),
    /källbindningen/u,
  );
  value.sourceDigest = workbenchSourceDigest(value.companies);
  assert.throws(
    () => parseWorkbenchSnapshotJson(JSON.stringify(value), NOW),
    /hash/u,
  );
});

test('workbench: inventory, byte, string and portable JSON bounds are enforced', () => {
  assert.throws(
    () => parseWorkbenchSnapshotJson(' '.repeat(MAX_WORKBENCH_BYTES + 1), NOW),
    /storleksgränsen/u,
  );
  const value = payload();
  value.companies = Array.from(
    { length: MAX_WORKBENCH_COMPANIES + 1 },
    (_, index) => ({ ...value.companies[0], workplaceUid: `WP:${index}` }),
  );
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /för många/u,
  );
  for (const name of ['x'.repeat(251), '\ud800', 'not\na name']) {
    const item = payload();
    item.companies[0].name = name;
    assert.throws(() => parseWorkbenchSnapshotJson(reseal(item), NOW));
  }
});

test('workbench: domain is an inert hostname and never a credential or script URL', () => {
  for (const domain of [
    'javascript:alert(1)',
    'https://fixture.se/a',
    'user@fixture.se',
    '127.0.0.1',
    '<script>.se',
  ]) {
    const value = payload();
    value.companies[0].domain = domain;
    assert.throws(
      () => parseWorkbenchSnapshotJson(reseal(value), NOW),
      /domän/u,
    );
  }
  const value = payload();
  value.companies[0].domain = null;
  assert.equal(
    parseWorkbenchSnapshotJson(reseal(value), NOW).companies[0].domain,
    null,
  );
});

test('workbench: invalid or future scan metadata does not become a current result', () => {
  const value = payload();
  value.companies[0].latestScan = {
    id: 'SCAN:fixture',
    startedAt: NOW,
    completedAt: null,
    state: 'current',
    executionStatus: 'completed',
  };
  assert.equal(
    parseWorkbenchSnapshotJson(reseal(value), NOW).companies[0].latestScan
      ?.state,
    'current',
  );
  value.companies[0].latestScan.completedAt = '2026-09-03T15:00:00Z';
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /tidsintervall/u,
  );
  value.companies[0].latestScan.completedAt = null;
  value.companies[0].latestScan.startedAt = '2026-09-05T15:00:00Z';
  assert.throws(
    () => parseWorkbenchSnapshotJson(reseal(value), NOW),
    /källsnapshot/u,
  );
});

test('workbench: scan states require exact strings, including after valid resealing', () => {
  const value = payload();
  value.companies[0].latestScan = {
    id: 'SCAN:fixture',
    startedAt: NOW,
    completedAt: null,
    state: 'current',
    executionStatus: 'completed',
  };
  const scan = value.companies[0].latestScan;
  for (const state of [
    'running',
    'needs_manual_review',
    'blocked',
    'failed',
    'current',
    'stale',
  ] as const) {
    scan.state = state;
    assert.equal(
      parseWorkbenchSnapshotJson(reseal(value), NOW).companies[0].latestScan
        ?.state,
      state,
    );
    for (const malformed of [[state], [[state]]]) {
      Object.assign(scan, { state: malformed });
      assert.throws(
        () => parseWorkbenchSnapshotJson(reseal(value), NOW),
        /okänd insamlingsstatus/u,
      );
    }
  }
  for (const state of [null, 1, true, {}, 'CURRENT']) {
    Object.assign(scan, { state });
    assert.throws(
      () => parseWorkbenchSnapshotJson(reseal(value), NOW),
      /okänd insamlingsstatus/u,
    );
  }
});

test('workbench: rule coverage is derived from frozen rules, not declared package counts', () => {
  const rows = getWorkbenchRuleCoverage(payload());
  assert.equal(rows.length, AUDIT_RULES.length);
  assert.equal(rows.filter((row) => row.status === 'candidate').length, 50);
  assert.equal(
    rows.filter(
      (row) =>
        row.status === 'candidate' && row.missingAdapterFacts.length === 0,
    ).length,
    10,
  );
  assert.ok(
    rows.every(
      (row) =>
        row.observedFactKeys.length === 0 &&
        row.missingObservedFacts.length === row.requiredFacts.length,
    ),
  );
});

test('workbench: null/missing/no-evidence facts remain unknown, false is a real supplied value', () => {
  const supplied = company();
  assert.deepEqual(
    getWorkbenchRuleCoverage(payload(), supplied).find((row) =>
      row.requiredFacts.includes('seo.title_present'),
    )?.observedFactKeys,
    ['seo.title_present'],
  );
  supplied.facts[0].value = null;
  assert.ok(
    getWorkbenchRuleCoverage(payload(), supplied).every(
      (row) => row.observedFactKeys.length === 0,
    ),
  );
  supplied.facts[0].value = true;
  supplied.facts[0].evidenceIds = [];
  assert.ok(
    getWorkbenchRuleCoverage(payload(), supplied).every(
      (row) => row.observedFactKeys.length === 0,
    ),
  );
});

test('workbench: facts from another workplace or host do not fill this inventory', () => {
  for (const mutate of [
    (value: CompanySnapshot) => {
      value.id = 'WP:other';
    },
    (value: CompanySnapshot) => {
      value.workplaceUid = 'WP:other';
    },
    (value: CompanySnapshot) => {
      value.domain = 'other.se';
    },
  ]) {
    const value = company();
    mutate(value);
    assert.ok(
      getWorkbenchRuleCoverage(payload(), value).every(
        (row) => row.observedFactKeys.length === 0,
      ),
    );
  }
});
