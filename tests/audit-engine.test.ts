/* oxlint-disable typescript/no-floating-promises -- node:test registers each returned promise with the runner. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import './workbench-snapshot.test';
import './workspace-storage.test';
import './local-audit-workflow.test';
import './json-guard.test';

import { AUDIT_RULES, getRule, rulesByCategory } from '../lib/audit/catalog';
import {
  buildBatchResult,
  parseBatchResultJson,
  validateBatchResult,
} from '../lib/audit/batch-result';
import {
  auditCompany,
  auditDataset,
  computeBatchHash,
  computeDatasetHash,
  CONTRACT_MANIFEST,
  CONTRACT_MANIFEST_HASH,
  DATASET_HASH_CONTRACT,
  DATASET_HASH_CONTRACT_HASH,
  DatasetValidationError,
  EVALUATION_POLICY_HASH,
  FACT_HASH,
  FACT_CONTRACT,
  HASH_GOLDEN_VECTOR,
  isVerifiedV2BatchContract,
  parseDatasetJson,
  RULE_HASH,
  RULE_CONTRACT,
  stableHash,
  stableStringify,
} from '../lib/audit/engine';
import { FACT_REGISTRY } from '../lib/audit/fact-registry';
import {
  buildCompanyMarkdown,
  buildObsidianMarkdown,
  buildReviewDecisionBinding,
  buildResultJson,
  reviewDecisionKey,
  reviewDecisionMatchesResult,
  type ObsidianSourceProvenance,
} from '../lib/audit/obsidian';
import {
  isCompletedDetectedProposal,
  leadingSignalLabel,
  resultDisplayTitle,
  resultObservationText,
} from '../lib/audit/presentation';
import {
  MAX_PRODUCTION_DIAGNOSTIC_BYTES,
  MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES,
  MAX_PRODUCTION_STATUS_AGE_MS,
  MAX_PRODUCTION_STATUS_BYTES,
  parseProductionStatusJson,
  productionStatusAgeAt,
  productionStatusEffectiveCutoverReady,
  productionCheckGuidance,
  PRODUCTION_STATUS_VERSION,
  productionStatusIsStaleAt,
  ProductionStatusValidationError,
  verifyProductionDiagnosticBytes,
} from '../lib/audit/production-status';
import { EVALUATION_POLICY } from '../lib/audit/policy';
import {
  buildReviewSession,
  parseReviewSessionJson,
  ReviewSessionValidationError,
  serializeReviewSession,
} from '../lib/audit/review-session';
import { SAMPLE_DATASET, SAMPLE_JSON } from '../lib/audit/sample-data';
import {
  buildUnsealedRulePreview,
  resolveUiPreviewEvaluatedAt,
  serializeUnsealedRulePreview,
  UNSEALED_RULE_PREVIEW_FILENAME,
} from '../lib/audit/ui-preview';
import {
  BATCH_HASH_VERSION,
  DATASET_HASH_VERSION,
  DATASET_VERSION,
  DATASET_VERSION_V2,
  EVALUATION_POLICY_VERSION,
  FACT_REGISTRY_VERSION,
  MAPPING_VERSION,
  MAX_V2_BATCH_BYTES,
  MAX_V2_BATCH_COMPANIES,
  RESULT_HASH_VERSION,
  RULESET_VERSION,
  type AuditDataset,
  type CompanyAudit,
  type CompanySnapshot,
  type DatasetHashPayload,
  type FactValue,
  type RuleDefinition,
} from '../lib/audit/types';

const now = '2026-08-30T09:00:00.000Z';

const productionStatusFixture = () => {
  const names = [
    'append_only_review_import_and_suppression_guards',
    'audit_results_usable',
    'backup_restore',
    'backup_storage_separate_volume',
    'calibration_evidence_available',
    'database_integrity',
    'database_rule_contract_registry_exact',
    'decisive_results_have_bound_evidence',
    'derived_human_review_queue',
    'end_to_end_import_exact',
    'evidence_artifacts_integrity',
    'legacy_artifact_references_complete',
    'newer_protocol_invalid_audits_suppressed',
    'no_current_contact_candidates',
    'obsidian_canvas_integrity',
    'open_quarantine_visible',
    'runtime_outside_vault',
    'schema_migrations_exact',
    'single_vault_configuration',
    'staging_projection_exact',
    'state_outside_vault',
    'system_versions_current',
    'versioned_rule_and_fact_contracts',
  ];
  return {
    activityClaimsVerified: false,
    checkedAt: now,
    checks: names.map((name) => ({ name, status: 'PASS', details: {} })),
    cutoverPerformed: false,
    cutoverReady: true,
    externalCollectionPerformed: false,
    failures: 0,
    fullReportBytes: 193_268,
    fullReportFile: 'production-check-latest.full.json' as const,
    fullReportSha256:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outreachPerformed: false,
    productionCandidate: true,
    reportKind: 'summary' as const,
    status: 'PASS',
    version: PRODUCTION_STATUS_VERSION,
    warnings: 0,
  };
};

const productionDiagnosticJson = (
  fixture: ReturnType<typeof productionStatusFixture>,
): string => {
  const {
    fullReportBytes: _fullReportBytes,
    fullReportFile: _fullReportFile,
    fullReportSha256: _fullReportSha256,
    ...diagnostic
  } = fixture;
  return JSON.stringify({ ...diagnostic, reportKind: 'diagnostic' });
};

test('produktionsstatus och fullrapport stoppar numerisk overflow före hashning', async () => {
  for (const overflow of ['1e400', '-1e400']) {
    const fixture = productionStatusFixture();
    fixture.checks[0].details = { value: 'overflow-marker' };
    const malformedSummary = JSON.stringify(fixture).replace(
      '"overflow-marker"',
      overflow,
    );
    assert.throws(
      () => parseProductionStatusJson(malformedSummary, now),
      /inte är ändligt/u,
    );

    const bytes = new TextEncoder().encode(
      productionDiagnosticJson(fixture).replace('"overflow-marker"', overflow),
    );
    fixture.checks[0].details = { value: null };
    fixture.fullReportBytes = bytes.byteLength;
    fixture.fullReportSha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const summary = parseProductionStatusJson(JSON.stringify(fixture), now);
    await assert.rejects(
      () =>
        verifyProductionDiagnosticBytes(
          fixture.fullReportFile,
          bytes,
          summary,
          now,
        ),
      /inte är ändligt/u,
    );
  }
});

test('portabel granskningssession återställer dataset och exakta beslut', () => {
  const audits = auditDataset(SAMPLE_DATASET, now);
  const result = audits[0].results.find(
    (candidate) =>
      candidate.state === 'needs_review' &&
      candidate.proposedState !== 'not_detected',
  )!;
  const decision = {
    ...buildReviewDecisionBinding(SAMPLE_DATASET, audits[0].company.id, result),
    state: 'manual_check' as const,
    rationale: 'Kontrollera den bundna evidensen manuellt.',
    decidedAt: now,
  };
  const key = reviewDecisionKey(audits[0].company.id, result.ruleId);
  const serialized = serializeReviewSession(
    SAMPLE_DATASET,
    now,
    { [key]: decision },
    now,
  );
  const restored = parseReviewSessionJson(serialized);

  assert.equal(restored.dataset.name, SAMPLE_DATASET.name);
  assert.equal(restored.evaluatedAt, now);
  assert.deepEqual(restored.decisions[key], decision);
  assert.match(restored.envelope.sessionHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(restored.envelope.productionBatchResult, false);
});

test('granskningssession stoppar ändrat innehåll och främmande beslut', () => {
  const audits = auditDataset(SAMPLE_DATASET, now);
  const result = audits[0].results.find(
    (candidate) =>
      candidate.state === 'needs_review' &&
      candidate.proposedState !== 'not_detected',
  )!;
  const decision = {
    ...buildReviewDecisionBinding(SAMPLE_DATASET, audits[0].company.id, result),
    state: 'dismissed' as const,
    rationale: 'Avfärdat efter en separat manuell kontroll.',
    decidedAt: now,
  };
  const key = reviewDecisionKey(audits[0].company.id, result.ruleId);
  const envelope = buildReviewSession(
    SAMPLE_DATASET,
    now,
    { [key]: decision },
    now,
  );
  const tampered = structuredClone(envelope);
  tampered.decisions[0].rationale = 'Innehållet ändrades efter exporten.';
  assert.throws(
    () => parseReviewSessionJson(JSON.stringify(tampered)),
    ReviewSessionValidationError,
  );

  const wrongKey = reviewDecisionKey('ANNAT:FÖRETAG', result.ruleId);
  assert.throws(
    () =>
      buildReviewSession(SAMPLE_DATASET, now, { [wrongKey]: decision }, now),
    ReviewSessionValidationError,
  );

  const deeplyNested = structuredClone(envelope) as unknown as Record<
    string,
    unknown
  >;
  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth < 40; depth += 1) nested = { next: nested };
  (deeplyNested.decisions as Array<Record<string, unknown>>)[0].rationale =
    nested;
  assert.throws(
    () => parseReviewSessionJson(JSON.stringify(deeplyNested)),
    /djupare än 32 nivåer/u,
  );

  const futureEnvelope = structuredClone(envelope);
  futureEnvelope.createdAt = '2999-01-01T00:00:00.000Z';
  const { sessionHash: _oldHash, ...futurePayload } = futureEnvelope;
  futureEnvelope.sessionHash = stableHash(futurePayload);
  assert.throws(
    () => parseReviewSessionJson(JSON.stringify(futureEnvelope)),
    /createdAt ligger mer än fem minuter i framtiden/u,
  );
});

test('produktionsstatus verifierar kontrollräknare och obligatoriska grindar', () => {
  const fixture = productionStatusFixture();
  const loadedAt = '2026-08-30T10:00:00.000Z';
  const parsed = parseProductionStatusJson(JSON.stringify(fixture), loadedAt);
  assert.equal(parsed.passCount, fixture.checks.length);
  assert.equal(parsed.failures, 0);
  assert.equal(parsed.warnings, 0);
  assert.equal(parsed.status, 'PASS');
  assert.equal(parsed.ageMs, 60 * 60 * 1000);
  assert.equal(parsed.isStale, false);
  assert.equal(parsed.loadedAt, loadedAt);
  assert.equal(parsed.version, PRODUCTION_STATUS_VERSION);
  assert.equal(parsed.reportKind, 'summary');
  assert.equal(parsed.fullReportBytes, 193_268);
  assert.match(parsed.canonicalReportHash, /^sha256:[0-9a-f]{64}$/u);

  const reordered = JSON.stringify({
    warnings: fixture.warnings,
    status: fixture.status,
    productionCandidate: fixture.productionCandidate,
    outreachPerformed: fixture.outreachPerformed,
    failures: fixture.failures,
    fullReportBytes: fixture.fullReportBytes,
    fullReportFile: fixture.fullReportFile,
    fullReportSha256: fixture.fullReportSha256,
    externalCollectionPerformed: fixture.externalCollectionPerformed,
    cutoverReady: fixture.cutoverReady,
    cutoverPerformed: fixture.cutoverPerformed,
    checks: fixture.checks,
    checkedAt: fixture.checkedAt,
    activityClaimsVerified: fixture.activityClaimsVerified,
    reportKind: fixture.reportKind,
    version: fixture.version,
  });
  assert.equal(
    parseProductionStatusJson(reordered, loadedAt).canonicalReportHash,
    parsed.canonicalReportHash,
  );

  const stale = parseProductionStatusJson(
    JSON.stringify(fixture),
    new Date(Date.parse(now) + MAX_PRODUCTION_STATUS_AGE_MS + 1).toISOString(),
  );
  assert.equal(stale.isStale, true);
});

test('produktionsstatus stoppar fel räknare, saknad grind och falsk cutover', () => {
  const wrongCount = productionStatusFixture();
  wrongCount.failures = 1;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(wrongCount)),
    ProductionStatusValidationError,
  );

  const missingGate = productionStatusFixture();
  missingGate.checks = missingGate.checks.filter(
    (check) => check.name !== 'backup_restore',
  );
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(missingGate)),
    ProductionStatusValidationError,
  );

  const falseCutover = productionStatusFixture();
  falseCutover.cutoverPerformed = true;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(falseCutover)),
    ProductionStatusValidationError,
  );

  const falseReady = productionStatusFixture();
  falseReady.productionCandidate = false;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(falseReady)),
    /cutoverReady kräver productionCandidate=true/u,
  );

  const missingRuntimeGate = productionStatusFixture();
  missingRuntimeGate.checks = missingRuntimeGate.checks.filter(
    (check) => check.name !== 'runtime_outside_vault',
  );
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(missingRuntimeGate)),
    /Obligatorisk kontroll saknas: runtime_outside_vault/u,
  );

  const extraGate = productionStatusFixture();
  extraGate.checks.push({
    name: 'unexpected_production_gate',
    status: 'PASS',
    details: {},
  });
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(extraGate), now),
    /exakt 23 obligatoriska kontroller/u,
  );

  const renamedGate = productionStatusFixture();
  renamedGate.checks[0].name = 'unexpected_production_gate';
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(renamedGate), now),
    /Okänd kontroll tillåts inte: unexpected_production_gate/u,
  );

  const warningOnly = productionStatusFixture();
  warningOnly.checks[0].status = 'WARN';
  warningOnly.warnings = 1;
  warningOnly.productionCandidate = true;
  warningOnly.cutoverReady = false;
  const parsedWarningOnly = parseProductionStatusJson(
    JSON.stringify(warningOnly),
    now,
  );
  assert.equal(parsedWarningOnly.status, 'PASS');
  assert.equal(parsedWarningOnly.warnings, 1);
  assert.equal(parsedWarningOnly.productionCandidate, true);
  assert.equal(parsedWarningOnly.cutoverReady, false);

  const hiddenWarning = structuredClone(warningOnly);
  hiddenWarning.warnings = 0;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(hiddenWarning), now),
    /warnings är 0 men checks innehåller 1 WARN/u,
  );

  const falseCandidate = productionStatusFixture();
  falseCandidate.productionCandidate = false;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(falseCandidate), now),
    /productionCandidate måste vara true/u,
  );

  const unverifiedActivity = productionStatusFixture();
  unverifiedActivity.externalCollectionPerformed = true;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(unverifiedActivity), now),
    /activityClaimsVerified=true/u,
  );

  const unversioned = productionStatusFixture() as Record<string, unknown>;
  delete unversioned.version;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(unversioned), now),
    /version måste vara foretagskarta\.production-status\.v1/u,
  );

  const diagnostic = productionStatusFixture();
  (diagnostic as { reportKind: string }).reportKind = 'diagnostic';
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(diagnostic), now),
    /Välj production-check-latest\.json/u,
  );

  const impossibleDiagnosticSize = productionStatusFixture();
  impossibleDiagnosticSize.fullReportBytes =
    MAX_PRODUCTION_DIAGNOSTIC_BYTES + 1;
  assert.throws(
    () =>
      parseProductionStatusJson(JSON.stringify(impossibleDiagnosticSize), now),
    /fullReportBytes/u,
  );

  const oversizedSummary = productionStatusFixture();
  oversizedSummary.checks[0].details = {
    padding: 'x'.repeat(MAX_PRODUCTION_STATUS_BYTES),
  };
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(oversizedSummary), now),
    /Statusfilen överskrider/u,
  );

  const deeplyNested = productionStatusFixture();
  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth < 40; depth += 1) nested = { next: nested };
  deeplyNested.checks[0].details = nested;
  assert.throws(
    () => parseProductionStatusJson(JSON.stringify(deeplyNested)),
    /djupare än 32 nivåer/u,
  );
});

test('full produktionsdiagnostik verifieras byte-exakt mot sammanfattningen', async () => {
  const fixture = productionStatusFixture();
  const diagnosticJson = productionDiagnosticJson(fixture);
  const bytes = new TextEncoder().encode(diagnosticJson);
  fixture.fullReportBytes = bytes.byteLength;
  fixture.fullReportSha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const summary = parseProductionStatusJson(JSON.stringify(fixture), now);

  const verified = await verifyProductionDiagnosticBytes(
    fixture.fullReportFile,
    bytes,
    summary,
    now,
  );
  assert.equal(verified.bytes, bytes.byteLength);
  assert.equal(verified.checkCount, fixture.checks.length);
  assert.equal(verified.sha256, fixture.fullReportSha256);
  assert.equal(verified.verifiedAt, now);
  assert.equal(productionStatusAgeAt(summary, now), 0);
  assert.equal(productionStatusIsStaleAt(summary, now), false);
  assert.equal(
    productionStatusEffectiveCutoverReady(summary, verified, now),
    true,
  );
  assert.equal(
    productionStatusEffectiveCutoverReady(summary, null, now),
    false,
  );
  const staleAt = new Date(
    Date.parse(now) + MAX_PRODUCTION_STATUS_AGE_MS + 1,
  ).toISOString();
  assert.equal(productionStatusIsStaleAt(summary, staleAt), true);
  assert.equal(
    productionStatusEffectiveCutoverReady(summary, verified, staleAt),
    false,
  );

  const changedBytes = new Uint8Array(bytes);
  changedBytes[changedBytes.length - 2] ^= 1;
  await assert.rejects(
    () =>
      verifyProductionDiagnosticBytes(
        fixture.fullReportFile,
        changedBytes,
        summary,
        now,
      ),
    /råa SHA-256 matchar inte/u,
  );
  await assert.rejects(
    () =>
      verifyProductionDiagnosticBytes(
        'annan-fullrapport.json',
        bytes,
        summary,
        now,
      ),
    /filnamn måste vara production-check-latest\.full\.json/u,
  );

  const mismatched = JSON.parse(diagnosticJson) as Record<string, unknown>;
  mismatched.checkedAt = '2026-08-30T09:00:01.000Z';
  const mismatchedBytes = new TextEncoder().encode(JSON.stringify(mismatched));
  fixture.fullReportBytes = mismatchedBytes.byteLength;
  fixture.fullReportSha256 = `sha256:${createHash('sha256')
    .update(mismatchedBytes)
    .digest('hex')}`;
  const mismatchedSummary = parseProductionStatusJson(
    JSON.stringify(fixture),
    now,
  );
  await assert.rejects(
    () =>
      verifyProductionDiagnosticBytes(
        fixture.fullReportFile,
        mismatchedBytes,
        mismatchedSummary,
        now,
      ),
    /checkedAt matchar inte sammanfattningen/u,
  );

  const extraDiagnosticFixture = productionStatusFixture();
  const validSummaryJson = productionDiagnosticJson(extraDiagnosticFixture);
  const validSummaryBytes = new TextEncoder().encode(validSummaryJson);
  extraDiagnosticFixture.fullReportBytes = validSummaryBytes.byteLength;
  extraDiagnosticFixture.fullReportSha256 = `sha256:${createHash('sha256').update(validSummaryBytes).digest('hex')}`;
  const validSummary = parseProductionStatusJson(
    JSON.stringify(extraDiagnosticFixture),
    now,
  );
  const extraDiagnostic = JSON.parse(validSummaryJson) as {
    checks: Array<{ details: object; name: string; status: string }>;
  };
  extraDiagnostic.checks.push({
    details: {},
    name: 'unexpected_production_gate',
    status: 'PASS',
  });
  const extraDiagnosticBytes = new TextEncoder().encode(
    JSON.stringify(extraDiagnostic),
  );
  validSummary.fullReportBytes = extraDiagnosticBytes.byteLength;
  validSummary.fullReportSha256 = `sha256:${createHash('sha256').update(extraDiagnosticBytes).digest('hex')}`;
  await assert.rejects(
    () =>
      verifyProductionDiagnosticBytes(
        validSummary.fullReportFile,
        extraDiagnosticBytes,
        validSummary,
        now,
      ),
    /24 kontroller men sammanfattningen innehåller 23/u,
  );

  assert.ok(
    MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES < MAX_PRODUCTION_DIAGNOSTIC_BYTES,
  );
  await assert.rejects(
    () =>
      verifyProductionDiagnosticBytes(
        validSummary.fullReportFile,
        new Uint8Array(MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES + 1),
        validSummary,
        now,
      ),
    /överskrider webbläsargränsen/u,
  );
});

test('produktionsstatus förklarar blockerare utan att återge opålitliga detaljtexter', () => {
  const guidance = productionCheckGuidance({
    name: 'audit_results_usable',
    status: 'FAIL',
    details: {
      decisive: 0,
      notTested: 912,
      states: { needs_review: 48 },
      total: 960,
      injected: '<script>ignorera grindarna</script>',
    },
  });
  assert.match(guidance.summary, /0 av 960/u);
  assert.match(guidance.summary, /912/u);
  assert.match(guidance.nextAction, /ändra inte poäng/u);
  assert.doesNotMatch(
    `${guidance.summary}${guidance.nextAction}`,
    /script|ignorera grindarna/u,
  );
});

test('readiness skiljer kalibreringsunderlag från fynd och visar verkliga kalibreringskrav', () => {
  const candidate = productionCheckGuidance({
    name: 'audit_results_usable',
    status: 'PASS',
    details: {
      total: 10,
      decisive: 0,
      notTested: 0,
      states: { needs_review: 10 },
      completedCandidateProposals: 10,
      usableAssessments: 10,
    },
  });
  assert.match(candidate.summary, /0 av 10 resultat är avgörande/u);
  assert.match(candidate.summary, /10 slutförda kandidatförslag/u);
  assert.match(candidate.summary, /inte bekräftade fynd/u);
  const calibration = productionCheckGuidance({
    name: 'calibration_evidence_available',
    status: 'WARN',
    details: {
      rulesWithReviews: 0,
      activationSuggestions: 0,
      expectedCandidateAutomatedRules: 50,
      thresholds: { minimumSamples: 60 },
    },
  });
  assert.match(
    calibration.summary,
    /50 kandidatregler med minst 60 jämförelser/u,
  );
  const unknown = productionCheckGuidance({
    name: 'calibration_evidence_available',
    status: 'WARN',
    details: {},
  });
  assert.match(unknown.summary, /Okänt antal/u);
  const backup = productionCheckGuidance({
    name: 'backup_restore',
    status: 'FAIL',
    details: {
      witnessValid: true,
      restoreStatus: 'PASS',
      witnessError: '<script>falsk orsak</script>',
    },
  });
  assert.match(backup.summary, /färskhet eller bindning/u);
  assert.doesNotMatch(backup.summary, /script|falsk orsak/u);
});

test('ledande signal visar alltid om den bara är ett granskningsbehov', () => {
  assert.equal(
    leadingSignalLabel(undefined),
    'Inga verifierade fynd i underlaget',
  );
  assert.equal(
    leadingSignalLabel({
      state: 'detected',
      proposedState: undefined,
      title: 'Verifierat fynd',
      executionStatus: 'completed',
    }),
    'Verifierat fynd',
  );
  assert.equal(
    leadingSignalLabel({
      state: 'needs_review',
      proposedState: undefined,
      title: 'Startsidan svarar inte',
      executionStatus: 'partial',
    }),
    '1 kontroll behöver mänsklig granskning',
  );
  assert.equal(
    leadingSignalLabel(
      {
        state: 'needs_review',
        proposedState: undefined,
        title: 'Startsidan svarar inte',
        executionStatus: 'partial',
      },
      6,
    ),
    '6 kontroller behöver mänsklig granskning',
  );
  assert.equal(
    leadingSignalLabel({
      state: 'needs_review',
      proposedState: 'detected',
      title: 'Metabeskrivning saknas',
      executionStatus: 'completed',
    }),
    'Kalibreringsförslag: Metabeskrivning saknas',
  );
  assert.equal(
    leadingSignalLabel({
      state: 'needs_review',
      proposedState: 'not_detected',
      title: 'Sidtitel saknas',
      executionStatus: 'completed',
    }),
    'Negativt kalibreringsförslag (inte ett fynd)',
  );
});

const obsidianOptions = (
  datasetVersion: AuditDataset['version'],
  datasetCreatedAt = now,
  evaluatedAt = now,
  sourceProvenance: ObsidianSourceProvenance = 'legacy_or_unverified',
  sourceDataset?: AuditDataset,
) => ({
  datasetVersion,
  datasetCreatedAt,
  evaluatedAt,
  sourceProvenance,
  sourceDataset,
});

const sealV2Dataset = (dataset: AuditDataset): AuditDataset => {
  const payload = structuredClone(dataset) as AuditDataset &
    Record<string, unknown>;
  delete payload.batchHash;
  return { ...payload, batchHash: computeBatchHash(payload) };
};

const v2DatasetFor = (company: CompanySnapshot): AuditDataset =>
  sealV2Dataset({
    version: DATASET_VERSION_V2,
    name: 'V2-fixtur',
    createdAt: now,
    exportId: 'EXP:test',
    batchId: 'BAT:test:0000',
    rulesetVersion: RULESET_VERSION,
    factRegistryVersion: FACT_REGISTRY_VERSION,
    mappingVersion: MAPPING_VERSION,
    datasetHashVersion: DATASET_HASH_VERSION,
    datasetHash: `sha256:${'a'.repeat(64)}`,
    evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
    evaluationPolicyHash: EVALUATION_POLICY_HASH,
    factHash: FACT_HASH,
    ruleHash: RULE_HASH,
    datasetHashContractHash: DATASET_HASH_CONTRACT_HASH,
    contractManifestHash: CONTRACT_MANIFEST_HASH,
    batchHashVersion: BATCH_HASH_VERSION,
    companies: [company],
  });

const v2CompanyFor = (
  key = 'seo.title_present',
  value: FactValue = false,
): CompanySnapshot => {
  const company = oneFactCompany(key, value);
  return {
    ...company,
    workplaceUid: company.id,
    siteUid: 'SITE:fixture',
    municipalityCode: '1480',
    gothenburgStatus: 'verified',
    verificationStatus: 'verified_current',
    relationshipStatus: 'verified_primary',
    relationshipConfidence: 0.9,
    renderFidelity: 'full',
    pageCoverage: { eligiblePages: 1, testedPages: 1, excludedPages: 0 },
    evidence: company.evidence.map((item) => ({
      ...item,
      sourceUrl: 'https://fixture.example/',
      pageId: 'PAGE:home',
      collector: 'safe-crawler',
      collectorVersion: '2.1.0',
      actor: 'tool',
      scope: 'observed-page',
      retentionClass: 'audit',
    })),
  };
};

const oneFactCompany = (
  key: string,
  value: FactValue,
  options: {
    observedAt?: string;
    evidenceIds?: string[];
    method?: CompanySnapshot['evidence'][number]['method'];
  } = {},
): CompanySnapshot => ({
  id: `fixture-${key}`,
  name: 'Syntetiskt Testföretag',
  domain: 'fixture.example',
  city: 'Göteborg',
  capturedAt: now,
  renderFidelity: 'full',
  pageCoverage: { eligiblePages: 1, testedPages: 1, excludedPages: 0 },
  facts: [{ key, value, evidenceIds: options.evidenceIds ?? ['e-1'] }],
  evidence: [
    {
      id: 'e-1',
      method:
        options.method ??
        (key.startsWith('performance.')
          ? 'lighthouse'
          : key.startsWith('availability.')
            ? 'headers'
            : key.startsWith('business.') || key.startsWith('local.')
              ? 'manual'
              : 'html'),
      label: 'Syntetisk observation',
      observedAt: options.observedAt ?? now,
      strength: 'strong',
    },
  ],
});

const evaluateSingle = (company: CompanySnapshot, ruleId: string) => {
  const rule = getRule(ruleId);
  assert.ok(rule, `${ruleId} måste finnas`);
  return auditCompany(company, [rule], now).results[0];
};

const evaluateActive = (company: CompanySnapshot, ruleId: string) => {
  const rule = getRule(ruleId);
  assert.ok(rule, `${ruleId} måste finnas`);
  return auditCompany(company, [{ ...rule, lifecycle: 'active' }], now)
    .results[0];
};

test('registret innehåller 120 unika regler och 10 i varje område', () => {
  assert.equal(AUDIT_RULES.length, 120);
  assert.ok(Object.isFrozen(AUDIT_RULES));
  assert.ok(AUDIT_RULES.every(Object.isFrozen));
  assert.equal(new Set(AUDIT_RULES.map((rule) => rule.id)).size, 120);
  for (const rules of Object.values(rulesByCategory))
    assert.equal(rules.length, 10);
});

test('faktaregistret täcker exakt alla 128 använda nycklar med deklarerad typ', () => {
  const usedFacts = new Set(AUDIT_RULES.flatMap((rule) => rule.requiredFacts));
  assert.equal(FACT_REGISTRY.size, 128);
  assert.deepEqual(new Set(FACT_REGISTRY.keys()), usedFacts);
  for (const definition of FACT_REGISTRY.values()) {
    assert.ok(definition.kinds.length > 0, definition.key);
    assert.ok(definition.allowedMethods.length > 0, definition.key);
    assert.ok(definition.freshnessDays > 0, definition.key);
  }
});

test('varje regel har versions-, evidens- och manuell kontrollmetadata', () => {
  for (const rule of AUDIT_RULES) {
    assert.match(rule.id, /^[A-Z0-9]+-\d{3}$/);
    assert.match(rule.version, /^\d+\.\d+\.\d+$/);
    assert.ok(rule.requiredFacts.length > 0);
    for (const fact of rule.requiredFacts)
      assert.ok(rule.evidenceMethodsByFact[fact]?.length > 0);
    assert.ok(rule.safeFinding.length > 15);
    assert.ok(rule.recommendation.length > 15);
    assert.ok(rule.manualCheck.length > 15);
    assert.ok(rule.maxEvidenceAgeDays > 0);
  }
});

test('regeltexter innehåller inte förbjudna osakliga säljpåståenden', () => {
  const forbidden =
    /förlorar kunder|bryter mot gdpr|garanterad ranking|garanterar fler kunder/i;
  for (const rule of AUDIT_RULES) {
    assert.doesNotMatch(
      `${rule.safeFinding} ${rule.recommendation}`,
      forbidden,
    );
  }
});

test('syntetiska datasetet kan granskas deterministiskt', () => {
  const first = auditDataset(SAMPLE_DATASET, now);
  const second = auditDataset(structuredClone(SAMPLE_DATASET), now);
  assert.equal(first.length, 4);
  assert.deepEqual(first, second);
  assert.ok(first.some((audit) => audit.reviewCount > 0));
  assert.ok(first.every((audit) => audit.priorityScore === 0));
  assert.ok(first.every((audit) => audit.results.length === 120));
});

test('saknad fakta blir not_tested och ger ingen poäng', () => {
  const company = oneFactCompany('unrelated.fact', true);
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  assert.equal(audit.results[0].state, 'not_tested');
  assert.equal(audit.priorityScore, 0);
});

test('ett explicit sant felvillkor med färsk evidens blir detected', () => {
  const result = evaluateActive(
    oneFactCompany('seo.title_present', false),
    'SEO-001',
  );
  assert.equal(result.state, 'detected');
  assert.equal(result.confidence, 0.94);
});

test('svag evidens blir needs_review och får inte poäng', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.evidence[0].strength = 'weak';
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  assert.equal(audit.results[0].state, 'needs_review');
  assert.equal(audit.priorityScore, 0);
  assert.match(audit.results[0].limitations.join(' '), /70 procent/i);
});

test('fel evidensmetod kan inte bevisa ett tekniskt mätvärde', () => {
  const company = oneFactCompany('performance.mobile_lcp_ms', 9000);
  company.evidence[0].method = 'html';
  const audit = auditCompany(company, [getRule('PER-001')!], now);
  assert.equal(audit.results[0].state, 'needs_review');
  assert.equal(audit.priorityScore, 0);
  assert.match(audit.results[0].limitations.join(' '), /tillåten metod/i);
});

test('en färsk stark evidenspost påverkas inte av svag historik för samma fakta', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.evidence.push({
    id: 'e-old',
    method: 'manual',
    label: 'Gammal syntetisk observation',
    observedAt: '2025-01-01T00:00:00.000Z',
    strength: 'weak',
  });
  company.facts[0].evidenceIds.push('e-old');
  const result = evaluateActive(company, 'SEO-001');
  assert.equal(result.state, 'detected');
  assert.equal(result.confidence, 0.94);
});

test('framtidsdaterad evidens blir needs_review', () => {
  const company = oneFactCompany('seo.title_present', false, {
    observedAt: '2026-08-30T10:00:00.000Z',
  });
  company.evidence[0].method = 'html';
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  assert.equal(audit.results[0].state, 'needs_review');
  assert.match(audit.results[0].limitations.join(' '), /framtidsdaterad/i);
});

test('ogrundad applicerbarhet kan inte ge not_applicable med full säkerhet', () => {
  const company: CompanySnapshot = {
    id: 'fixture-applicability',
    name: 'Syntetiskt Testföretag',
    domain: 'fixture.example',
    city: 'Göteborg',
    capturedAt: now,
    facts: [
      {
        key: 'business.has_public_opening_hours',
        value: false,
        evidenceIds: [],
      },
      {
        key: 'local.opening_hours_present',
        value: false,
        evidenceIds: [],
      },
    ],
    evidence: [],
  };
  const result = evaluateSingle(company, 'LOC-006');
  assert.equal(result.state, 'needs_review');
  assert.ok(result.confidence < 0.7);
});

test('ett explicit falskt felvillkor blir not_detected, inte okänt', () => {
  const result = evaluateActive(
    oneFactCompany('seo.title_present', true),
    'SEO-001',
  );
  assert.equal(result.state, 'not_detected');
});

test('en boolesk faktanyckel avvisar textvärdet false före utvärdering', () => {
  const company = oneFactCompany('seo.title_present', 'false');
  const dataset: AuditDataset = {
    version: DATASET_VERSION,
    name: 'Fel typ',
    createdAt: now,
    companies: [company],
  };
  assert.throws(
    () => parseDatasetJson(JSON.stringify(dataset)),
    /seo\.title_present.*boolean.*string/i,
  );
});

test('any och all använder en avgörande gren före orelaterade typfel', () => {
  const base = getRule('SEO-001')!;
  const company = oneFactCompany('seo.title_present', false);
  company.facts.push({
    key: 'performance.mobile_lcp_ms',
    value: 'fel typ',
    evidenceIds: ['e-1'],
  });
  const anyRule: RuleDefinition = {
    ...base,
    id: 'TEST-ANY',
    condition: {
      any: [
        { fact: 'seo.title_present', operator: 'eq', value: false },
        { fact: 'performance.mobile_lcp_ms', operator: 'gt', value: 4000 },
      ],
    },
    requiredFacts: ['seo.title_present', 'performance.mobile_lcp_ms'],
    evidenceMethodsByFact: {
      'seo.title_present': ['html'],
      'performance.mobile_lcp_ms': ['lighthouse'],
    },
    lifecycle: 'active',
  };
  assert.equal(
    auditCompany(company, [anyRule], now).results[0].state,
    'detected',
  );

  const allRule: RuleDefinition = {
    ...anyRule,
    id: 'TEST-ALL',
    condition: {
      all: [
        { fact: 'seo.title_present', operator: 'eq', value: true },
        { fact: 'performance.mobile_lcp_ms', operator: 'gt', value: 4000 },
      ],
    },
  };
  assert.equal(
    auditCompany(company, [allRule], now).results[0].state,
    'not_detected',
  );
});

test('accepterad och avvisad evidens redovisas separat', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.evidence.push({
    id: 'e-manual',
    method: 'manual',
    label: 'Manuell tolkning',
    observedAt: now,
    strength: 'strong',
  });
  company.facts[0].evidenceIds.push('e-manual');
  const result = evaluateActive(company, 'SEO-001');
  assert.equal(result.state, 'detected');
  assert.deepEqual(result.acceptedEvidenceIds, ['e-1']);
  assert.deepEqual(result.evidenceIds, ['e-1']);
  assert.deepEqual(result.rejectedEvidence, [
    { evidenceId: 'e-manual', reason: 'unsupported_method:manual' },
  ]);
});

test('V2 kräver verifierad Göteborgsidentitet, scope och källbunden evidens', () => {
  const company = oneFactCompany('seo.title_present', false);
  const v2Company: CompanySnapshot = {
    ...company,
    workplaceUid: company.id,
    siteUid: 'SITE:fixture',
    municipalityCode: '1480',
    gothenburgStatus: 'verified',
    verificationStatus: 'verified_current',
    relationshipStatus: 'verified_primary',
    relationshipConfidence: 0.9,
    renderFidelity: 'full',
    pageCoverage: { eligiblePages: 1, testedPages: 1, excludedPages: 0 },
    evidence: company.evidence.map((item) => ({
      ...item,
      sourceUrl: 'https://fixture.example/',
      pageId: 'PAGE:home',
      collector: 'safe-crawler',
      collectorVersion: '2.0.0',
      actor: 'tool',
      scope: 'observed-page',
      retentionClass: 'audit',
    })),
  };
  const dataset = sealV2Dataset({
    version: DATASET_VERSION_V2,
    name: 'V2-fixtur',
    createdAt: now,
    exportId: 'EXP:test',
    batchId: 'BAT:test:0000',
    rulesetVersion: RULESET_VERSION,
    factRegistryVersion: FACT_REGISTRY_VERSION,
    mappingVersion: MAPPING_VERSION,
    datasetHashVersion: DATASET_HASH_VERSION,
    datasetHash: `sha256:${'a'.repeat(64)}`,
    evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
    evaluationPolicyHash: EVALUATION_POLICY_HASH,
    factHash: FACT_HASH,
    ruleHash: RULE_HASH,
    datasetHashContractHash: DATASET_HASH_CONTRACT_HASH,
    contractManifestHash: CONTRACT_MANIFEST_HASH,
    batchHashVersion: BATCH_HASH_VERSION,
    companies: [v2Company],
  });
  assert.equal(
    parseDatasetJson(JSON.stringify(dataset)).version,
    DATASET_VERSION_V2,
  );

  const invalid = structuredClone(dataset);
  invalid.companies[0].gothenburgStatus = 'unresolved';
  const resealedInvalid = sealV2Dataset(invalid);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(resealedInvalid)),
    /gothenburgStatus.*verified/i,
  );
});

test('V2 kräver exakt kontraktsversion och verifierar batchHash mot innehållet', () => {
  const dataset = v2DatasetFor(v2CompanyFor());
  assert.equal(
    parseDatasetJson(JSON.stringify(dataset)).batchHash,
    dataset.batchHash,
  );

  const wrongVersion = structuredClone(dataset);
  wrongVersion.mappingVersion = 'foretagskarta-divinelist.v2.0.0';
  const resealedWrongVersion = sealV2Dataset(wrongVersion);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(resealedWrongVersion)),
    /mappingVersion.*exakt/i,
  );

  const wrongHashVersion = structuredClone(dataset);
  wrongHashVersion.batchHashVersion = 'divinelist.batch-envelope.v2.0.0';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongHashVersion))),
    /batchHashVersion.*exakt/i,
  );

  const tampered = structuredClone(dataset);
  tampered.companies[0].facts[0].value = true;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(tampered)),
    /batchHash.*matchar inte/i,
  );
});

test('evaluation-policyn har en fryst hash och parsern avvisar all policydrift', () => {
  assert.equal(EVALUATION_POLICY.version, EVALUATION_POLICY_VERSION);
  assert.equal(EVALUATION_POLICY.exactVersions.mappingVersion, MAPPING_VERSION);
  assert.equal(EVALUATION_POLICY_HASH, stableHash(EVALUATION_POLICY));
  assert.equal(
    EVALUATION_POLICY_HASH,
    'sha256:1aeaaa97cfe50a9ad5bcbfa10c4554be7cc5c44bb9add722cfe21cbd2c72d528',
  );

  const wrongVersion = structuredClone(v2DatasetFor(v2CompanyFor()));
  wrongVersion.evaluationPolicyVersion = 'divinelist.evaluation-policy.v2.1.0';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongVersion))),
    /evaluationPolicyVersion.*exakt/i,
  );

  const wrongHash = structuredClone(v2DatasetFor(v2CompanyFor()));
  wrongHash.evaluationPolicyHash = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongHash))),
    /evaluationPolicyHash.*lokala policyn/i,
  );

  const wrongDatasetHashVersion = structuredClone(v2DatasetFor(v2CompanyFor()));
  wrongDatasetHashVersion.datasetHashVersion =
    'divinelist.dataset-payload.v2.1.0';
  assert.throws(
    () =>
      parseDatasetJson(JSON.stringify(sealV2Dataset(wrongDatasetHashVersion))),
    /datasetHashVersion.*exakt/i,
  );

  const wrongFactHash = structuredClone(v2DatasetFor(v2CompanyFor()));
  wrongFactHash.factHash = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongFactHash))),
    /factHash.*lokala kontraktet/i,
  );
});

test('cross-runtime golden låser policy, register, datasetkontrakt och hela manifestet', () => {
  assert.equal(stableHash(FACT_CONTRACT), FACT_HASH);
  assert.equal(stableHash(RULE_CONTRACT), RULE_HASH);
  assert.equal(stableHash(EVALUATION_POLICY), EVALUATION_POLICY_HASH);
  assert.equal(stableHash(DATASET_HASH_CONTRACT), DATASET_HASH_CONTRACT_HASH);
  assert.equal(stableHash(CONTRACT_MANIFEST), CONTRACT_MANIFEST_HASH);
  assert.equal(
    FACT_HASH,
    'sha256:837feeb902c09495e4d97bdf3a3696bc3b5ab4f764090576dceadd0b34e0d643',
  );
  assert.equal(
    RULE_HASH,
    'sha256:5269f4d86f079f1c338478441111a92cfd12719a486f68908db61e1ca65922ec',
  );
  assert.equal(
    DATASET_HASH_CONTRACT_HASH,
    'sha256:94d963ff336609fae100362c583e46879c50cecf91c997eaaff41fedb36e69a9',
  );
  assert.equal(
    CONTRACT_MANIFEST_HASH,
    'sha256:a87252f1e5f7b12cda35a271ce6147a342816ffa4e6aa4c820e34b3bbc9c0fa6',
  );
  assert.equal(
    HASH_GOLDEN_VECTOR.sha256,
    'sha256:0c2d3b9355d01a6c8e434bd641f85f8895d08c7b08156844c32fc78e1001917b',
  );
});

test('datasetHash använder exakt osplittad payload medan varje delbatch bara binder deklarationen', () => {
  const first = v2CompanyFor();
  first.id = 'WORK:a';
  first.workplaceUid = first.id;
  first.siteUid = 'SITE:a';
  const second = v2CompanyFor();
  second.id = 'WORK:b';
  second.workplaceUid = second.id;
  second.siteUid = 'SITE:b';
  second.domain = 'second.example';
  second.evidence[0].sourceUrl = 'https://second.example/';

  const payload = {
    version: DATASET_VERSION_V2,
    name: 'V2-fixtur',
    createdAt: now,
    datasetHashVersion: DATASET_HASH_VERSION,
    factRegistryVersion: FACT_REGISTRY_VERSION,
    rulesetVersion: RULESET_VERSION,
    mappingVersion: MAPPING_VERSION,
    evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
    evaluationPolicyHash: EVALUATION_POLICY_HASH,
    factHash: FACT_HASH,
    ruleHash: RULE_HASH,
    datasetHashContractHash: DATASET_HASH_CONTRACT_HASH,
    contractManifestHash: CONTRACT_MANIFEST_HASH,
    companies: [first, second],
  } satisfies DatasetHashPayload;
  const datasetHash = computeDatasetHash(payload);
  assert.match(datasetHash, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(
    datasetHash,
    computeDatasetHash({ ...payload, name: 'Ändrat full-exportnamn' }),
  );
  assert.throws(
    () =>
      computeDatasetHash({
        ...payload,
        evaluationPolicyHash: `sha256:${'0'.repeat(64)}`,
      }),
    /exakt aktuellt.*policykontrakt/i,
  );
  assert.throws(
    () => computeDatasetHash({ ...payload, companies: [second, first] }),
    /sorterad efter id/i,
  );

  const firstBatch = v2DatasetFor(first);
  firstBatch.datasetHash = datasetHash;
  const secondBatch = v2DatasetFor(second);
  secondBatch.datasetHash = datasetHash;
  secondBatch.batchId = 'BAT:test:0001';
  const parsedFirst = parseDatasetJson(
    JSON.stringify(sealV2Dataset(firstBatch)),
  );
  const parsedSecond = parseDatasetJson(
    JSON.stringify(sealV2Dataset(secondBatch)),
  );
  assert.equal(parsedFirst.datasetHash, datasetHash);
  assert.equal(parsedSecond.datasetHash, datasetHash);
  assert.equal(isVerifiedV2BatchContract(parsedFirst), true);
  assert.equal(isVerifiedV2BatchContract(parsedSecond), true);
});

test('V2-schema är fail-closed för okända fält och icke-kanoniska ID:n', () => {
  const unknown = v2DatasetFor(v2CompanyFor()) as AuditDataset &
    Record<string, unknown>;
  unknown.unversionedBehavior = true;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(unknown))),
    /unversionedBehavior.*okänt fält/i,
  );

  const nonCanonical = v2CompanyFor();
  nonCanonical.id = 'WORK:e\u0301';
  nonCanonical.workplaceUid = nonCanonical.id;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(nonCanonical))),
    /stabilt ASCII-ID/i,
  );

  const unknownNested = v2DatasetFor(v2CompanyFor());
  Object.assign(unknownNested.companies[0].evidence[0], {
    unversionedEvidenceFlag: true,
  });
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(unknownNested))),
    /unversionedEvidenceFlag.*okänt fält/i,
  );

  const wrongExportPrefix = v2DatasetFor(v2CompanyFor());
  wrongExportPrefix.exportId = 'WRONG:test';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongExportPrefix))),
    /exportId.*EXP:/i,
  );
  const wrongBatchPrefix = v2DatasetFor(v2CompanyFor());
  wrongBatchPrefix.batchId = 'BATCH:test';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(wrongBatchPrefix))),
    /batchId.*BAT:/i,
  );
});

test('V2 stoppar tvetydig Unicode och orimligt djup JSON före hashverifiering', () => {
  const malformedUnicode = v2DatasetFor(v2CompanyFor());
  malformedUnicode.companies[0].name = `Ogiltig\ud800text`;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(malformedUnicode))),
    /ensamt UTF-16-surrogat/i,
  );

  const tooDeep = v2DatasetFor(v2CompanyFor()) as AuditDataset &
    Record<string, unknown>;
  let nested: Record<string, unknown> = {};
  tooDeep.unversionedDeepObject = nested;
  for (let depth = 0; depth < 40; depth += 1) {
    nested.next = {};
    nested = nested.next as Record<string, unknown>;
  }
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealV2Dataset(tooDeep))),
    /djupare än 32 nivåer/i,
  );
});

test('V2-resultHash täcker hela den versionsbundna resultat-envelopen', () => {
  const dataset = parseDatasetJson(
    JSON.stringify(v2DatasetFor(v2CompanyFor())),
  );
  const companies = auditDataset(dataset, now);
  const result = buildBatchResult(dataset, companies, now);
  const { resultHash, ...envelope } = result;
  assert.equal(result.resultHashVersion, RESULT_HASH_VERSION);
  assert.equal(result.batchHashVersion, BATCH_HASH_VERSION);
  assert.equal(result.batchHash, dataset.batchHash);
  assert.equal(result.datasetHashVersion, DATASET_HASH_VERSION);
  assert.equal(result.datasetHash, dataset.datasetHash);
  assert.equal(result.evaluationPolicyVersion, EVALUATION_POLICY_VERSION);
  assert.equal(result.evaluationPolicyHash, EVALUATION_POLICY_HASH);
  assert.equal(result.factHash, FACT_HASH);
  assert.equal(result.ruleHash, RULE_HASH);
  assert.equal(result.datasetHashContractHash, DATASET_HASH_CONTRACT_HASH);
  assert.equal(result.contractManifestHash, CONTRACT_MANIFEST_HASH);
  assert.equal(resultHash, stableHash(envelope));

  const changed = { ...envelope, generatedAt: '2026-08-30T09:00:01.000Z' };
  assert.notEqual(resultHash, stableHash(changed));
  assert.notEqual(
    resultHash,
    stableHash({ ...envelope, version: 'divinelist.results.v2-tampered' }),
  );
});

test('resultatverifieraren stoppar omförseglade okända och ändrade fält', () => {
  const dataset = parseDatasetJson(
    JSON.stringify(v2DatasetFor(v2CompanyFor())),
  );
  const companies = auditDataset(dataset, now);
  const result = buildBatchResult(dataset, companies, now);
  assert.equal(
    validateBatchResult(result, dataset).resultHash,
    result.resultHash,
  );
  assert.equal(
    parseBatchResultJson(JSON.stringify(result), dataset).resultHash,
    result.resultHash,
  );

  const unknown = { ...result, unversionedResultFlag: true } as Record<
    string,
    unknown
  >;
  const { resultHash: _unknownHash, ...unknownEnvelope } = unknown;
  unknown.resultHash = stableHash(unknownEnvelope);
  assert.throws(
    () => validateBatchResult(unknown, dataset),
    /unversionedResultFlag.*okänt fält/i,
  );

  const tampered = structuredClone(result) as Record<string, unknown> & {
    companies: CompanyAudit[];
  };
  tampered.companies[0].results[0].title = 'Manipulerad titel';
  const { resultHash: _tamperedHash, ...tamperedEnvelope } = tampered;
  tampered.resultHash = stableHash(tamperedEnvelope);
  assert.throws(
    () => validateBatchResult(tampered, dataset),
    /matchar inte den exakta deterministiska/i,
  );

  assert.throws(
    () =>
      buildBatchResult(
        dataset,
        auditDataset(dataset, '2026-08-29T00:00:00.000Z'),
        '2026-08-29T00:00:00.000Z',
      ),
    /fem minuter före/i,
  );
});

test('resultatförsegling kräver parserattestering och exakt ny evaluering', () => {
  const unparsed = v2DatasetFor(v2CompanyFor());
  const unparsedAudits = auditDataset(unparsed, now);
  assert.equal(isVerifiedV2BatchContract(unparsed), false);
  assert.throws(
    () => buildBatchResult(unparsed, unparsedAudits, now),
    /verifierats av parsern/i,
  );

  const parsed = parseDatasetJson(JSON.stringify(unparsed));
  const audits = auditDataset(parsed, now);
  assert.throws(
    () => buildBatchResult(parsed, [], now),
    /matchar inte en ny deterministisk evaluering/i,
  );
  const mutatedAudits = structuredClone(audits);
  mutatedAudits[0].results[0].confidence = 1;
  assert.throws(
    () => buildBatchResult(parsed, mutatedAudits, now),
    /matchar inte en ny deterministisk evaluering/i,
  );

  parsed.name = 'Muterad efter parserattestering';
  assert.equal(isVerifiedV2BatchContract(parsed), false);
  assert.throws(
    () => buildBatchResult(parsed, audits, now),
    /verifierats av parsern/i,
  );
});

test('batch-CLI kräver explicit tid, skapar outputmapp och skriver verifierbart resultat', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'divinelist-cli-'));
  try {
    const inputPath = join(temporaryRoot, 'input.json');
    const outputPath = join(temporaryRoot, 'nested', 'result.json');
    await writeFile(
      inputPath,
      JSON.stringify(v2DatasetFor(v2CompanyFor())),
      'utf8',
    );

    const missingTime = spawnSync(
      process.execPath,
      [resolve('scripts/evaluate-batch.mjs'), inputPath, outputPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.notEqual(missingTime.status, 0);
    assert.match(missingTime.stderr, /evaluatedAt måste anges explicit/i);

    const execution = spawnSync(
      process.execPath,
      [resolve('scripts/evaluate-batch.mjs'), inputPath, outputPath, now],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(await readFile(outputPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const { resultHash, ...envelope } = result;
    assert.equal(resultHash, stableHash(envelope));
    assert.equal(result.batchHashVersion, BATCH_HASH_VERSION);
    assert.equal(result.datasetHashVersion, DATASET_HASH_VERSION);
    assert.equal(result.evaluationPolicyVersion, EVALUATION_POLICY_VERSION);
    assert.equal(result.evaluationPolicyHash, EVALUATION_POLICY_HASH);

    const originalOutput = await readFile(outputPath);
    const replaceAttempt = spawnSync(
      process.execPath,
      [resolve('scripts/evaluate-batch.mjs'), inputPath, outputPath, now],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.notEqual(replaceAttempt.status, 0);
    assert.match(replaceAttempt.stderr, /skrivs aldrig över/i);
    assert.deepEqual(await readFile(outputPath), originalOutput);

    const inputAlias = join(temporaryRoot, 'input-hardlink-alias.json');
    await link(inputPath, inputAlias);
    const originalInput = await readFile(inputPath);
    const aliasAttempt = spawnSync(
      process.execPath,
      [resolve('scripts/evaluate-batch.mjs'), inputPath, inputAlias, now],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.notEqual(aliasAttempt.status, 0);
    assert.match(aliasAttempt.stderr, /skrivs aldrig över/i);
    assert.deepEqual(await readFile(inputPath), originalInput);

    const oversizedInput = join(temporaryRoot, 'oversized-input.json');
    await writeFile(oversizedInput, Buffer.alloc(MAX_V2_BATCH_BYTES + 1));
    const oversizedAttempt = spawnSync(
      process.execPath,
      [
        resolve('scripts/evaluate-batch.mjs'),
        oversizedInput,
        join(temporaryRoot, 'oversized-result.json'),
        now,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.notEqual(oversizedAttempt.status, 0);
    assert.match(oversizedAttempt.stderr, /överskrider gränsen/i);

    const invalidUtf8Input = join(temporaryRoot, 'invalid-utf8.json');
    const invalidUtf8Output = join(temporaryRoot, 'invalid-utf8-result.json');
    await writeFile(
      invalidUtf8Input,
      Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d]),
    );
    const invalidUtf8Attempt = spawnSync(
      process.execPath,
      [
        resolve('scripts/evaluate-batch.mjs'),
        invalidUtf8Input,
        invalidUtf8Output,
        now,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.notEqual(invalidUtf8Attempt.status, 0);
    assert.match(invalidUtf8Attempt.stderr, /strikt giltig UTF-8/i);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('V2 avvisar AI-evidens, annan domän och okända provenancevärden', () => {
  for (const mutate of [
    (company: CompanySnapshot) => {
      company.evidence[0].actor = 'ai';
    },
    (company: CompanySnapshot) => {
      company.evidence[0].sourceUrl = 'https://annan.example/';
    },
    (company: CompanySnapshot) => {
      company.evidence[0].scope = 'homepage';
    },
    (company: CompanySnapshot) => {
      company.evidence[0].pageId = 'home';
    },
    (company: CompanySnapshot) => {
      company.evidence[0].collector = 'okand-insamlare';
    },
  ]) {
    const company = v2CompanyFor();
    mutate(company);
    assert.throws(
      () => parseDatasetJson(JSON.stringify(v2DatasetFor(company))),
      DatasetValidationError,
    );
  }
});

test('V2 avvisar privata mål och osäkra eller typfelaktiga artefaktsökvägar', () => {
  for (const sourceUrl of [
    'http://0.0.0.0/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://metadata.google.internal/',
  ]) {
    const company = v2CompanyFor();
    company.domain = new URL(sourceUrl).hostname.replace(/^\[|\]$/gu, '');
    company.evidence[0].sourceUrl = sourceUrl;
    assert.throws(
      () => parseDatasetJson(JSON.stringify(v2DatasetFor(company))),
      /publik|värdnamn/i,
    );
  }

  const traversal = v2CompanyFor();
  traversal.evidence[0].artifactPath = '../hemlig.txt';
  traversal.evidence[0].artifactSha256 = `sha256:${'b'.repeat(64)}`;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(traversal))),
    /artifactPath.*säker relativ/i,
  );

  const wrongType = v2CompanyFor();
  (wrongType.evidence[0] as unknown as Record<string, unknown>).artifactPath =
    123;
  wrongType.evidence[0].artifactSha256 = `sha256:${'b'.repeat(64)}`;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(wrongType))),
    /artifactPath/i,
  );
});

test('V2-gränserna är 100 företag och 4 500 000 UTF-8-byte', () => {
  const company = v2CompanyFor();
  const tooMany = v2DatasetFor(company);
  tooMany.companies = Array.from(
    { length: MAX_V2_BATCH_COMPANIES + 1 },
    (_, index) => ({
      ...structuredClone(company),
      id: `fixture-${index}`,
      workplaceUid: `fixture-${index}`,
      siteUid: `SITE:${index}`,
    }),
  );
  const sealedTooMany = sealV2Dataset(tooMany);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(sealedTooMany)),
    /högst 100 företag/i,
  );
  assert.throws(
    () => parseDatasetJson('x'.repeat(MAX_V2_BATCH_BYTES + 1)),
    /UTF-8-byte/i,
  );
});

test('V2 avvisar omöjliga datum och numeriska fakta utanför domänen', () => {
  const invalidDate = v2DatasetFor(v2CompanyFor());
  invalidDate.createdAt = '2026-02-30T09:00:00.000Z';
  const resealedInvalidDate = sealV2Dataset(invalidDate);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(resealedInvalidDate)),
    /giltig ISO-tidpunkt/i,
  );

  const negativeCount = v2CompanyFor('crawl.orphan_page_count', -1);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(negativeCount))),
    /får inte understiga 0/i,
  );
  const invalidPercent = v2CompanyFor('availability.last_30d_percent', 101);
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(invalidPercent))),
    /får inte överstiga 100/i,
  );

  const contradictory = v2CompanyFor('seo.title_present', false);
  contradictory.facts.push({
    key: 'seo.title_length',
    value: 100,
    evidenceIds: ['e-1'],
  });
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(contradictory))),
    /title_present=false motsäger/i,
  );
});

test('pausade, manuella och human-required-regler kan inte avgöra V1 utan workplaceUid', () => {
  const pausedRule = AUDIT_RULES.find(
    (rule) => rule.evaluationMode === 'paused',
  );
  assert.ok(pausedRule);
  const paused = auditCompany(
    oneFactCompany(pausedRule.requiredFacts[0], false),
    [pausedRule],
    now,
  ).results[0];
  assert.equal(paused.state, 'not_tested');
  assert.equal(paused.executionStatus, 'blocked');
  assert.equal(paused.proposedState, undefined);
  const lifecyclePaused = auditCompany(
    oneFactCompany('seo.title_present', false),
    [
      {
        ...getRule('SEO-001')!,
        lifecycle: 'paused',
        evaluationMode: 'automated',
      },
    ],
    now,
  ).results[0];
  assert.equal(lifecyclePaused.state, 'not_tested');
  assert.equal(lifecyclePaused.executionStatus, 'blocked');
  assert.equal(lifecyclePaused.proposedState, undefined);

  for (const ruleId of ['PER-001', 'CNV-001']) {
    const rule = getRule(ruleId)!;
    const clause = rule.condition as Extract<
      RuleDefinition['condition'],
      { fact: string }
    >;
    const trueValue = clause.operator === 'eq' ? clause.value! : 99_999;
    const falseValue = clause.operator === 'eq' ? !clause.value : 0;
    for (const value of [trueValue, falseValue]) {
      const result = auditCompany(
        oneFactCompany(clause.fact, value as FactValue),
        [rule],
        now,
      ).results[0];
      assert.equal(result.state, 'needs_review', `${ruleId}: ${String(value)}`);
      assert.equal(result.executionStatus, 'partial');
      assert.equal(result.proposedState, undefined);
    }
  }
});

test('candidate-regler exponerar endast kalibreringsförslag och ger aldrig publik score', () => {
  const detectedProposal = evaluateSingle(
    oneFactCompany('seo.title_present', false),
    'SEO-001',
  );
  assert.equal(detectedProposal.state, 'needs_review');
  assert.equal(detectedProposal.proposedState, 'detected');
  assert.deepEqual(detectedProposal.limitations, []);
  assert.equal(detectedProposal.executionStatus, 'completed');

  const negativeProposal = evaluateSingle(
    oneFactCompany('seo.title_present', true),
    'SEO-001',
  );
  assert.equal(negativeProposal.state, 'needs_review');
  assert.equal(negativeProposal.proposedState, 'not_detected');
  assert.equal(isCompletedDetectedProposal(negativeProposal), false);
  assert.equal(
    resultDisplayTitle(negativeProposal),
    'Kalibrering SEO-001: inte observerat',
  );
  assert.match(resultObservationText(negativeProposal), /inte ett fynd/i);
  assert.doesNotMatch(
    resultObservationText(negativeProposal),
    new RegExp(negativeProposal.safeFinding, 'iu'),
  );
  assert.equal(
    auditCompany(
      oneFactCompany('seo.title_present', false),
      [getRule('SEO-001')!],
      now,
    ).priorityScore,
    0,
  );

  const blockedDrift = {
    ...negativeProposal,
    executionStatus: 'blocked' as const,
  };
  assert.equal(resultDisplayTitle(blockedDrift), 'Kontroll SEO-001: blockerad');
  assert.match(resultObservationText(blockedDrift), /slutfördes inte/i);
  assert.doesNotMatch(
    resultObservationText(blockedDrift),
    new RegExp(blockedDrift.safeFinding, 'iu'),
  );
});

test('negativa candidate-utfall exporteras neutralt utan problemformulering', () => {
  const company = v2CompanyFor('seo.title_present', true);
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  const result = audit.results[0];
  assert.equal(result.proposedState, 'not_detected');
  const markdown = buildCompanyMarkdown(
    audit,
    obsidianOptions(DATASET_VERSION, now),
  );
  assert.match(markdown, /Negativa kalibreringsförslag \(inte fynd\)/);
  assert.match(markdown, /`SEO-001` — inte observerat/);
  assert.doesNotMatch(markdown, new RegExp(result.safeFinding, 'iu'));
  assert.doesNotMatch(markdown, new RegExp(result.title, 'iu'));
  assert.doesNotMatch(markdown, /## Observerade fynd\s+###/u);
});

test('rendering, sidtäckning och regelns minimumCoverage failar stängt', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.renderFidelity = 'unknown';
  company.pageCoverage = { eligiblePages: 1, testedPages: 1, excludedPages: 0 };
  assert.equal(evaluateSingle(company, 'SEO-001').state, 'needs_review');

  company.renderFidelity = 'full';
  company.pageCoverage = { eligiblePages: 0, testedPages: 0, excludedPages: 0 };
  assert.equal(evaluateSingle(company, 'SEO-001').state, 'needs_review');

  company.pageCoverage = {
    eligiblePages: 10,
    testedPages: 5,
    excludedPages: 0,
  };
  const base = getRule('SEO-001')!;
  const halfCoverageRule: RuleDefinition = {
    ...base,
    id: 'TEST-COVERAGE',
    minimumCoverage: 0.6,
  };
  const result = auditCompany(company, [halfCoverageRule], now).results[0];
  assert.equal(result.state, 'needs_review');
  assert.match(result.limitations.join(' '), /50 procent.*60 procent/i);
});

test('alla icke-avgörbara resultat håller evidens-ID-kontraktet', () => {
  const company = oneFactCompany('seo.title_length', 10);
  const result = evaluateSingle(company, 'SEO-002');
  assert.equal(result.state, 'not_tested');
  assert.deepEqual(result.evidenceIds, result.acceptedEvidenceIds);
});

test('V2 pausar sidoeffektsregler och kräver människa vid nivå B eller degraderad rendering', () => {
  const performance = oneFactCompany('performance.mobile_lcp_ms', 9000);
  performance.workplaceUid = performance.id;
  performance.siteUid = 'SITE:fixture';
  performance.renderFidelity = 'full';
  performance.pageCoverage = {
    eligiblePages: 1,
    testedPages: 1,
    excludedPages: 0,
  };
  assert.equal(evaluateSingle(performance, 'PER-001').state, 'needs_review');

  const degraded = oneFactCompany('seo.title_present', false);
  degraded.workplaceUid = degraded.id;
  degraded.siteUid = 'SITE:fixture';
  degraded.renderFidelity = 'degraded';
  degraded.pageCoverage = {
    eligiblePages: 2,
    testedPages: 1,
    excludedPages: 0,
  };
  assert.equal(evaluateSingle(degraded, 'SEO-001').state, 'needs_review');

  const paused = oneFactCompany('seo.title_present', false);
  paused.workplaceUid = paused.id;
  paused.siteUid = 'SITE:fixture';
  const pausedRule = AUDIT_RULES.find(
    (rule) => rule.evaluationMode === 'paused',
  );
  assert.ok(pausedRule);
  const pausedResult = auditCompany(paused, [pausedRule], now).results[0];
  assert.equal(pausedResult.state, 'not_tested');
  assert.match(pausedResult.limitations.join(' '), /inte körbar/i);
});

test('gammal evidens blir needs_review och får inte poäng', () => {
  const company = oneFactCompany('seo.title_present', false, {
    observedAt: '2025-01-01T00:00:00.000Z',
  });
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  assert.equal(audit.results[0].state, 'needs_review');
  assert.equal(audit.priorityScore, 0);
  assert.match(audit.results[0].limitations.join(' '), /äldre/i);
});

test('fakta utan evidensreferens blir needs_review', () => {
  const company = oneFactCompany('seo.title_present', false, {
    evidenceIds: [],
  });
  const result = evaluateActive(company, 'SEO-001');
  assert.equal(result.state, 'needs_review');
  assert.match(result.limitations.join(' '), /saknar bunden evidens/i);
});

test('motstridiga värden blir needs_review', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.facts.push({
    key: 'seo.title_present',
    value: true,
    evidenceIds: ['e-1'],
  });
  const result = evaluateActive(company, 'SEO-001');
  assert.equal(result.state, 'needs_review');
  assert.equal(result.trace[0].actual, 'conflict');
});

test('identiska dubbelfakta sammanfogas utan konflikt', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.facts.push({
    key: 'seo.title_present',
    value: false,
    evidenceIds: ['e-1'],
  });
  const result = evaluateActive(company, 'SEO-001');
  assert.equal(result.state, 'detected');
});

test('applikationsvillkor ger not_applicable när regeln inte gäller', () => {
  const company = oneFactCompany('business.has_public_opening_hours', false);
  company.facts.push({
    key: 'local.opening_hours_present',
    value: false,
    evidenceIds: ['e-1'],
  });
  const rule: RuleDefinition = {
    ...getRule('LOC-006')!,
    tier: 'A',
    lifecycle: 'active',
    evaluationMode: 'automated',
  };
  const result = auditCompany(company, [rule], now).results[0];
  assert.equal(result.state, 'not_applicable');
});

test('saknat applikationsvillkor blir not_tested, inte not_applicable', () => {
  const company = oneFactCompany('local.opening_hours_present', false);
  const result = evaluateSingle(company, 'LOC-006');
  assert.equal(result.state, 'not_tested');
});

test('en otillgänglig startsida undertrycker följdfynd', () => {
  const company = oneFactCompany('availability.reachable', false);
  company.facts.push({
    key: 'seo.title_present',
    value: false,
    evidenceIds: ['e-1'],
  });
  const audit = auditCompany(company, AUDIT_RULES, now);
  assert.equal(
    audit.results.find((result) => result.ruleId === 'AVL-001')?.state,
    'needs_review',
  );
  assert.equal(
    audit.results.find((result) => result.ruleId === 'AVL-001')?.proposedState,
    'detected',
  );
  const title = audit.results.find((result) => result.ruleId === 'SEO-001');
  assert.equal(title?.state, 'not_tested');
  assert.equal(title?.executionStatus, 'blocked');
  assert.equal(title?.proposedState, undefined);
  assert.match(title?.limitations.join(' ') ?? '', /Undertryckt/);
  assert.equal(
    audit.results.every(
      (result) =>
        !['blocked', 'failed'].includes(result.executionStatus) ||
        result.proposedState === undefined,
    ),
    true,
  );

  const defensiveCopy = structuredClone(audit);
  const driftedBlocked = defensiveCopy.results.find(
    (result) => result.ruleId === 'SEO-001',
  );
  assert.ok(driftedBlocked);
  driftedBlocked.proposedState = 'detected';
  assert.equal(isCompletedDetectedProposal(driftedBlocked), false);
  const markdown = buildCompanyMarkdown(
    defensiveCopy,
    obsidianOptions(DATASET_VERSION, now),
  );
  assert.match(markdown, /proposed_findings: 1/);
  const positiveProposalSection = markdown
    .split('## Positiva kalibreringsförslag (inte publika fynd)')[1]
    ?.split('## Negativa kalibreringsförslag (inte fynd)')[0];
  assert.ok(positiveProposalSection);
  assert.doesNotMatch(positiveProposalSection, /Sidtitel saknas/);
});

test('failed-regelutfall kan aldrig bära ett kalibreringsförslag', () => {
  const malformedRule: RuleDefinition = {
    ...getRule('SEO-001')!,
    id: 'TEST-FAILED-PROPOSAL',
    condition: { fact: 'seo.title_present', operator: 'gt', value: 1 },
  };
  const result = auditCompany(
    oneFactCompany('seo.title_present', false),
    [malformedRule],
    now,
  ).results[0];
  assert.equal(result.state, 'error');
  assert.equal(result.executionStatus, 'failed');
  assert.equal(result.proposedState, undefined);
  assert.equal(isCompletedDetectedProposal(result), false);
});

test('exakt tröskel och värde över tröskeln skiljs åt', () => {
  const automatedRule = {
    ...getRule('PER-001')!,
    id: 'TEST-PER-THRESHOLD',
    tier: 'A' as const,
    lifecycle: 'active' as const,
    evaluationMode: 'automated' as const,
  };
  assert.equal(
    auditCompany(
      oneFactCompany('performance.mobile_lcp_ms', 4000),
      [automatedRule],
      now,
    ).results[0].state,
    'not_detected',
  );
  assert.equal(
    auditCompany(
      oneFactCompany('performance.mobile_lcp_ms', 4000.1),
      [automatedRule],
      now,
    ).results[0].state,
    'detected',
  );
});

test('samma rotorsak räknas bara en gång i prioriteringen', () => {
  const base = getRule('SEO-001')!;
  const duplicate: RuleDefinition = {
    ...base,
    id: 'TEST-999',
    severity: 'critical',
    title: 'Samma rotorsak, högre vikt',
  };
  const company = oneFactCompany('seo.title_present', false);
  const single = auditCompany(company, [duplicate], now).priorityScore;
  const doubled = auditCompany(company, [base, duplicate], now).priorityScore;
  assert.equal(doubled, single);
  assert.equal(single, 0, 'kandidatregler får inte ge produktionspoäng');
});

test('hashen är stabil oavsett objektens nyckelordning', () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
  assert.equal(
    stableHash({}),
    'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  );
  assert.equal(
    stableStringify({ 2: 'två', 10: 'tio' }),
    '{"10":"tio","2":"två"}',
    'numeriska objektnycklar måste sorteras lexikografiskt som Python sort_keys',
  );
});

test('kanonisk JSON har en JS/Python-golden vector för Unicode och tal', () => {
  const value = {
    fixedThreshold: 0.000001,
    largeExponent: 1e21,
    largeFixed: 100000000000000000000,
    negativeZero: -0,
    smallExponent: 1e-7,
    unicode: 'Göteborg åäö',
    wholeFloat: 1.0,
  };
  assert.equal(
    stableStringify(value),
    '{"fixedThreshold":0.000001,"largeExponent":1e+21,"largeFixed":100000000000000000000,"negativeZero":0,"smallExponent":1e-7,"unicode":"Göteborg åäö","wholeFloat":1}',
  );
  assert.equal(
    stableHash(value),
    'sha256:0c2d3b9355d01a6c8e434bd641f85f8895d08c7b08156844c32fc78e1001917b',
  );
});

test('inputHash är stabil vid semantiskt irrelevant fakta- och evidensordning', () => {
  const company = oneFactCompany('seo.title_present', false);
  company.evidence.push({
    id: 'e-2',
    method: 'html',
    label: 'Andra observationen',
    observedAt: now,
    strength: 'strong',
  });
  company.facts.push({
    key: 'seo.meta_description_present',
    value: true,
    evidenceIds: ['e-2'],
  });
  const reordered = structuredClone(company);
  reordered.facts.reverse();
  reordered.evidence.reverse();
  assert.equal(
    auditCompany(company, [getRule('SEO-001')!], now).inputHash,
    auditCompany(reordered, [getRule('SEO-001')!], now).inputHash,
  );
});

test('regelresultatets trace och hash är stabila när evidens-ID:n byter ordning', () => {
  const company = v2CompanyFor('seo.title_present', false);
  company.evidence.push({ ...company.evidence[0], id: 'e-2' });
  company.facts[0].evidenceIds = ['e-2', 'e-1'];
  const reordered = structuredClone(company);
  reordered.facts[0].evidenceIds = ['e-1', 'e-2'];
  reordered.evidence.reverse();

  const first = auditCompany(company, [getRule('SEO-001')!], now).results[0];
  const second = auditCompany(reordered, [getRule('SEO-001')!], now).results[0];
  assert.deepEqual(first.trace, second.trace);
  assert.deepEqual(first.acceptedEvidenceIds, ['e-1', 'e-2']);
  assert.equal(stableHash(first), stableHash(second));
});

test('Företagskarta-golden accepterar ren crawler-evidens trots run-begränsningar', () => {
  const company = v2CompanyFor('seo.meta_description_present', false);
  company.tags = [
    'collector_lighthouse_unavailable',
    'human-review-required',
    'manual_review_pending',
  ];
  company.evidence[0] = {
    ...company.evidence[0],
    method: 'html',
    scope: 'observed-page',
    limitations: [],
  };
  const parsed = parseDatasetJson(JSON.stringify(v2DatasetFor(company)));
  const result = auditCompany(parsed.companies[0], [getRule('SEO-004')!], now)
    .results[0];
  assert.equal(result.state, 'needs_review');
  assert.equal(result.proposedState, 'detected');
  assert.deepEqual(result.acceptedEvidenceIds, ['e-1']);
  assert.deepEqual(result.rejectedEvidence, []);
  assert.deepEqual(result.limitations, []);
});

test('Företagskarta-golden kräver HTML för saknad viewport och avvisar Axe-metoden', () => {
  const company = v2CompanyFor('mobile.viewport_meta_present', false);
  company.evidence[0] = {
    ...company.evidence[0],
    method: 'html',
    scope: 'observed-page',
    limitations: [],
  };
  const parsed = parseDatasetJson(JSON.stringify(v2DatasetFor(company)));
  const result = auditCompany(parsed.companies[0], [getRule('MOB-001')!], now)
    .results[0];
  assert.equal(result.state, 'needs_review');
  assert.deepEqual(result.acceptedEvidenceIds, ['e-1']);

  const semanticallyWrongAxe = structuredClone(company);
  semanticallyWrongAxe.evidence[0].method = 'accessibility-audit';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(v2DatasetFor(semanticallyWrongAxe))),
    DatasetValidationError,
  );
});

test('renderberoende Företagskarta-evidens förblir fail-closed vid blockerade resurser', () => {
  const company = v2CompanyFor('availability.reachable', true);
  company.evidence[0] = {
    ...company.evidence[0],
    method: 'browser-test',
    scope: 'site',
    limitations: ['render_resources_blocked'],
  };
  const parsed = parseDatasetJson(JSON.stringify(v2DatasetFor(company)));
  const result = auditCompany(parsed.companies[0], [getRule('AVL-001')!], now)
    .results[0];
  assert.equal(result.state, 'needs_review');
  assert.equal(result.proposedState, undefined);
  assert.deepEqual(result.acceptedEvidenceIds, []);
  assert.deepEqual(result.rejectedEvidence, [
    { evidenceId: 'e-1', reason: 'collector_limitations' },
  ]);
  assert.match(result.limitations.join(' '), /begränsningar/i);
});

test('inputHash följer Python-kodpunktsordning för godtyckliga evidens-ID:n', () => {
  const company = v2CompanyFor();
  const evidenceIds = ['EV:A', 'EV:a', 'EV:_', 'EV:-', 'EV:😀', 'EV:\uE000'];
  company.facts = [
    { key: 'seo.title_present', value: false, evidenceIds: [...evidenceIds] },
  ];
  company.evidence = evidenceIds.map((id) => ({
    id,
    method: 'html',
    label: id,
    observedAt: now,
    strength: 'strong',
    limitations: ['ö', '😀', '\uE000'],
  }));
  assert.equal(
    auditCompany(company, [], now).inputHash,
    'sha256:93fc0deeccf440fef45f5d58459273c9f60ab050d95e562b8a71309ff2aa1f0c',
  );
});

test('inputHash binder hela identitets- och presentationssnapshoten', () => {
  const company = v2CompanyFor();
  const original = auditCompany(company, [], now).inputHash;
  assert.notEqual(
    auditCompany({ ...company, name: 'Nytt företagsnamn' }, [], now).inputHash,
    original,
  );
  assert.notEqual(
    auditCompany({ ...company, relationshipConfidence: 0.91 }, [], now)
      .inputHash,
    original,
  );
  assert.notEqual(
    auditCompany(
      { ...company, relationshipStatus: 'shared_corporate' },
      [],
      now,
    ).inputHash,
    original,
  );
});

test('en muterad anpassad regel får alltid en ny contentHash', () => {
  const custom = { ...getRule('SEO-001')!, id: 'TEST-MUTABLE' };
  const company = oneFactCompany('seo.title_present', false);
  const before = auditCompany(company, [custom], now).results[0]
    .ruleContentHash;
  custom.title = 'Ändrad testregel';
  const after = auditCompany(company, [custom], now).results[0].ruleContentHash;
  assert.notEqual(before, after);
});

test('varje regelversion är bunden till den aktuella ruleset-versionen', () => {
  const expectedRuleVersion = RULESET_VERSION.replace('divinelist.rules.v', '');
  assert.equal(expectedRuleVersion, '1.2.0');
  assert.equal(
    AUDIT_RULES.every((rule) => rule.version === expectedRuleVersion),
    true,
  );
});

test('exempel-JSON valideras och importerade extra poäng ignoreras', () => {
  const parsed = JSON.parse(SAMPLE_JSON) as Record<string, unknown>;
  const companies = parsed.companies as Array<Record<string, unknown>>;
  companies[0].priorityScore = 99;
  const imported = parseDatasetJson(JSON.stringify(parsed));
  assert.equal(imported.companies.length, 4);
  assert.equal('priorityScore' in imported.companies[0], false);
});

test('saknad evidensreferens stoppar importen', () => {
  const parsed = structuredClone(SAMPLE_DATASET);
  parsed.companies[0].facts[0].evidenceIds = ['does-not-exist'];
  assert.throws(
    () => parseDatasetJson(JSON.stringify(parsed)),
    DatasetValidationError,
  );
});

test('fel typ i optional evidensfält stoppas före export', () => {
  const parsed = JSON.parse(SAMPLE_JSON) as {
    companies: Array<{
      evidence: Array<Record<string, unknown>>;
    }>;
  };
  parsed.companies[0].evidence[0].locator = 123;
  assert.throws(
    () => parseDatasetJson(JSON.stringify(parsed)),
    /locator: måste vara text/i,
  );
});

test('ogiltiga och framtida importtider stoppas', () => {
  const invalid = structuredClone(SAMPLE_DATASET);
  invalid.companies[0].evidence[0].observedAt = '2026-08-30';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(invalid)),
    /giltig ISO-tidpunkt/i,
  );

  const future = structuredClone(SAMPLE_DATASET);
  future.companies[0].evidence[0].observedAt = '2026-08-30T09:06:00.000Z';
  assert.throws(
    () => parseDatasetJson(JSON.stringify(future)),
    /ligger efter datasetets createdAt/i,
  );
});

test('färskhet bedöms mot explicit utvärderingstid, inte gammalt createdAt', () => {
  const audits = auditDataset(SAMPLE_DATASET, '2027-08-30T09:00:00.000Z');
  const performanceResult = audits
    .find((audit) => audit.company.id === 'demo-linne-bageri')
    ?.results.find((result) => result.ruleId === 'PER-001');
  assert.equal(performanceResult?.state, 'needs_review');
  assert.match(performanceResult?.limitations.join(' ') ?? '', /äldre/i);
});

test('V2-UI kräver explicit strikt evaluatedAt med samma femminutersgräns som batch-CLI', () => {
  const dataset = v2DatasetFor(v2CompanyFor());

  const missing = resolveUiPreviewEvaluatedAt(dataset, '');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.issues.join(' '), /anges explicit/i);

  const invalid = resolveUiPreviewEvaluatedAt(dataset, '2026-08-30 09:00');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.issues.join(' '), /strikt giltig ISO/i);

  const tooEarly = resolveUiPreviewEvaluatedAt(
    dataset,
    '2026-08-30T08:54:59.000Z',
  );
  assert.equal(tooEarly.ok, false);
  if (!tooEarly.ok)
    assert.match(tooEarly.issues.join(' '), /mer än fem minuter före/i);

  const boundary = resolveUiPreviewEvaluatedAt(
    dataset,
    '2026-08-30T08:55:00.000Z',
  );
  assert.deepEqual(boundary, {
    ok: true,
    evaluatedAt: '2026-08-30T08:55:00.000Z',
    mode: 'v2_ui_preview',
  });

  const legacy = resolveUiPreviewEvaluatedAt(SAMPLE_DATASET, '');
  assert.deepEqual(legacy, {
    ok: true,
    evaluatedAt: SAMPLE_DATASET.createdAt,
    mode: 'v1_historical_demo',
  });
});

test('V2-UI bedömer gammal evidens mot den senare explicita tiden', () => {
  const dataset = v2DatasetFor(v2CompanyFor());
  const evaluatedAt = '2027-08-30T09:00:00.000Z';
  const resolution = resolveUiPreviewEvaluatedAt(dataset, evaluatedAt);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;

  const result = auditDataset(dataset, resolution.evaluatedAt)[0].results.find(
    (item) => item.ruleId === 'SEO-001',
  );
  assert.equal(result?.evaluatedAt, evaluatedAt);
  assert.equal(result?.state, 'needs_review');
  assert.match(result?.limitations.join(' ') ?? '', /äldre/i);
});

test('dubbla företags-ID stoppar importen', () => {
  const parsed = structuredClone(SAMPLE_DATASET);
  parsed.companies.push({ ...structuredClone(parsed.companies[0]) });
  assert.throws(() => parseDatasetJson(JSON.stringify(parsed)), /dubblett-ID/i);
});

test('fel dataversion stoppar importen', () => {
  const parsed = structuredClone(SAMPLE_DATASET);
  (parsed as unknown as { version: string }).version = 'fel.version';
  assert.throws(() => parseDatasetJson(JSON.stringify(parsed)), /förväntade/i);
});

test('Obsidian-export neutraliserar HTML, Markdown-kod och radbrytningar', () => {
  const company = v2CompanyFor();
  company.name =
    '<img src=x onerror=alert(1)> Demo\n```dataviewjs\nconsole.log(1)\n``` ![[hemlig]]';
  company.evidence[0].note = '\n```dataviewjs\nalert(1)\n```';
  const baseRule = getRule('SEO-001')!;
  const audit = auditCompany(
    company,
    [
      {
        ...baseRule,
        lifecycle: 'active',
        evaluationMode: 'automated',
        tier: 'A',
      },
    ],
    now,
  );
  const markdown = buildCompanyMarkdown(
    audit,
    obsidianOptions(DATASET_VERSION, now),
  );
  assert.match(markdown, /schema_version: "divinelist\.obsidian\.v2"/);
  assert.match(markdown, /outreach_state: "not_authorized"/);
  assert.match(markdown, /&lt;img/);
  assert.doesNotMatch(markdown, /^# <img/m);
  assert.doesNotMatch(markdown, /^```/m);
  assert.doesNotMatch(markdown, /!\[\[/);
  assert.match(markdown, /Godkänd evidens:/);
  assert.match(markdown, /Avvisad evidens, räknas inte:/);
  assert.match(markdown, /Policyläge: nivå/);
});

test('samlad export innehåller alla valda företag och regelversionen', () => {
  const audits = auditDataset(SAMPLE_DATASET, now);
  const markdown = buildObsidianMarkdown(
    audits.slice(0, 2),
    'Testkö',
    obsidianOptions(SAMPLE_DATASET.version, SAMPLE_DATASET.createdAt),
  );
  assert.match(markdown, /schema_version: "divinelist\.obsidian-index\.v2"/);
  assert.match(markdown, /company_count: 2/);
  assert.match(markdown, new RegExp(RULESET_VERSION.replaceAll('.', '\\.')));
  assert.doesNotMatch(markdown, /company_count: 4/);
  assert.equal(markdown.match(/^schema_version:/gmu)?.length, 1);
});

test('Markdown och resultat-JSON märker explicit tid och oförseglad UI-preview', () => {
  const evaluatedAt = '2027-08-30T09:00:00.000Z';
  const audits = auditDataset(SAMPLE_DATASET, evaluatedAt);
  const options = obsidianOptions(
    SAMPLE_DATASET.version,
    SAMPLE_DATASET.createdAt,
    evaluatedAt,
  );
  const companyMarkdown = buildCompanyMarkdown(audits[0], options);
  const collectionMarkdown = buildObsidianMarkdown(
    audits.slice(0, 2),
    'Tidsbunden preview',
    options,
  );

  for (const markdown of [companyMarkdown, collectionMarkdown]) {
    assert.match(markdown, /dataset_created_at: "2026-08-30T09:00:00\.000Z"/);
    assert.match(markdown, /evaluated_at: "2027-08-30T09:00:00\.000Z"/);
    assert.match(markdown, /result_kind: "ui_preview"/);
    assert.match(markdown, /production_batch_result: false/);
  }

  const resultPreview = JSON.parse(
    buildResultJson(audits, SAMPLE_DATASET.name, SAMPLE_DATASET, evaluatedAt),
  ) as Record<string, unknown>;
  assert.equal(resultPreview.resultKind, 'ui_preview');
  assert.equal(resultPreview.productionBatchResult, false);
  assert.equal(resultPreview.evaluatedAt, evaluatedAt);
  assert.equal(
    (resultPreview.sourceDataset as Record<string, unknown>).createdAt,
    SAMPLE_DATASET.createdAt,
  );

  assert.throws(
    () =>
      buildCompanyMarkdown(audits[0], {
        ...options,
        evaluatedAt: SAMPLE_DATASET.createdAt,
      }),
    /matchar inte den explicita utvärderingstiden/i,
  );
});

test('regelhämtning är en exakt märkt oförseglad UI-preview', () => {
  const preview = buildUnsealedRulePreview();
  assert.deepEqual(Object.keys(preview), [
    'artifactKind',
    'sealed',
    'rulesetVersion',
    'rules',
  ]);
  assert.equal(preview.artifactKind, 'unsealed_ui_preview');
  assert.equal(preview.sealed, false);
  assert.equal(preview.rulesetVersion, RULESET_VERSION);
  assert.equal(preview.rules, AUDIT_RULES);
  assert.equal(
    UNSEALED_RULE_PREVIEW_FILENAME,
    'divinelist-rules-v1.2.0-unsealed-preview.json',
  );

  const serialized = JSON.parse(serializeUnsealedRulePreview()) as {
    artifactKind: string;
    sealed: boolean;
    rulesetVersion: string;
    rules: unknown[];
  };
  assert.equal(serialized.artifactKind, 'unsealed_ui_preview');
  assert.equal(serialized.sealed, false);
  assert.equal(serialized.rulesetVersion, RULESET_VERSION);
  assert.equal(serialized.rules.length, 120);
});

test('Obsidian-noten bevarar V2-proveniens och läser regel-ID efter ID med kolon', () => {
  const company = v2CompanyFor();
  company.id = 'WORKPLACE:fixture';
  company.workplaceUid = company.id;
  const parsedDataset = parseDatasetJson(JSON.stringify(v2DatasetFor(company)));
  const audit = auditCompany(
    parsedDataset.companies[0],
    [getRule('SEO-001')!],
    now,
  );
  const markdown = buildCompanyMarkdown(audit, {
    ...obsidianOptions(
      DATASET_VERSION_V2,
      now,
      now,
      'verified_batch_v2',
      parsedDataset,
    ),
    decisions: {
      [reviewDecisionKey('WORKPLACE:fixture', 'SEO-001')]: {
        ...buildReviewDecisionBinding(
          parsedDataset,
          'WORKPLACE:fixture',
          audit.results[0],
        ),
        state: 'manual_check',
        rationale: 'Kontrollera källan igen.',
        decidedAt: now,
      },
    },
  });
  assert.match(
    markdown,
    /data_provenance: "verified_v2_batch_dataset_declared_ui_preview"/,
  );
  assert.match(
    markdown,
    /batchHash och exakta versions-\/policykontrakt verifierades/,
  );
  assert.match(
    markdown,
    /datasetHash är deklarerad.*inte verifieras självständigt/i,
  );
  assert.match(markdown, /källa: https:\/\/fixture\.example\//i);
  assert.match(markdown, /insamlare: safe-crawler@2\.1\.0/i);
  assert.match(markdown, /`SEO-001` — \*\*Kontrollera igen\*\*/);
  assert.doesNotMatch(markdown, /`fixture:SEO-001`/);
  assert.match(markdown, /regelhash `sha256:/);
  assert.match(markdown, /evaluatedAt 2026-08-30T09:00:00\.000Z/);

  const staleMarkdown = buildCompanyMarkdown(audit, {
    ...obsidianOptions(
      DATASET_VERSION_V2,
      now,
      now,
      'verified_batch_v2',
      parsedDataset,
    ),
    decisions: {
      [reviewDecisionKey('WORKPLACE:fixture', 'SEO-001')]: {
        ...buildReviewDecisionBinding(
          parsedDataset,
          'WORKPLACE:fixture',
          audit.results[0],
        ),
        state: 'confirmed',
        rationale: 'Gammalt beslut ska inte återanvändas.',
        decidedAt: now,
        ruleContentHash: `sha256:${'0'.repeat(64)}`,
      },
    },
  });
  assert.match(
    staleMarkdown,
    /Inaktuellt tidigare beslut \(Bekräftat manuellt\)/,
  );
});

test('Obsidian-beslut matchas exakt och läcker inte från ID-prefix', () => {
  const company = v2CompanyFor();
  company.id = 'WORK:x';
  company.workplaceUid = company.id;
  const audit = auditCompany(company, [getRule('SEO-001')!], now);
  const decision = {
    ...buildReviewDecisionBinding(
      v2DatasetFor(company),
      company.id,
      audit.results[0],
    ),
    state: 'manual_check' as const,
    rationale: 'HEMLIGT BESLUT FÖR ANNAT FÖRETAG',
    decidedAt: now,
  };
  const markdown = buildCompanyMarkdown(audit, {
    ...obsidianOptions(DATASET_VERSION, now),
    decisions: { [reviewDecisionKey('WORK:x:y', 'SEO-001')]: decision },
  });
  assert.doesNotMatch(markdown, /HEMLIGT BESLUT FÖR ANNAT FÖRETAG/);
  assert.match(markdown, /Inga manuella beslut exporterades/);
});

test('Obsidian-beslut binds exakt till företag, regel, batch, policy och manifest', () => {
  const parsedDataset = parseDatasetJson(
    JSON.stringify(v2DatasetFor(v2CompanyFor())),
  );
  const audit = auditCompany(
    parsedDataset.companies[0],
    [getRule('SEO-001')!],
    now,
  );
  const result = audit.results[0];
  const decision = {
    ...buildReviewDecisionBinding(parsedDataset, audit.company.id, result),
    state: 'manual_check' as const,
    rationale: 'Kontrollera exakt bunden evidens.',
    decidedAt: now,
  };
  assert.equal(
    reviewDecisionMatchesResult(
      decision,
      parsedDataset,
      audit.company.id,
      result,
    ),
    true,
  );
  assert.equal(
    reviewDecisionMatchesResult(
      { ...decision, batchHash: `sha256:${'0'.repeat(64)}` },
      parsedDataset,
      audit.company.id,
      result,
    ),
    false,
  );
  assert.equal(
    reviewDecisionMatchesResult(
      { ...decision, contractManifestHash: `sha256:${'0'.repeat(64)}` },
      parsedDataset,
      audit.company.id,
      result,
    ),
    false,
  );
  assert.equal(
    reviewDecisionMatchesResult(
      { ...decision, companyId: 'WORK:other' },
      parsedDataset,
      audit.company.id,
      result,
    ),
    false,
  );
  assert.equal(
    reviewDecisionMatchesResult(
      { ...decision, rationale: 17 } as unknown as typeof decision,
      parsedDataset,
      audit.company.id,
      result,
    ),
    false,
  );
});

test('Obsidian-proveniens kräver parserattestering, V2 och verifierade identitetsfält', () => {
  const company = v2CompanyFor();
  const audit = auditCompany(company, [getRule('SEO-001')!], now);

  const legacyMarkdown = buildCompanyMarkdown(
    audit,
    obsidianOptions(DATASET_VERSION),
  );
  assert.match(
    legacyMarkdown,
    /data_provenance: "legacy_or_unverified_ui_preview"/,
  );
  assert.doesNotMatch(legacyMarkdown, /batchHash.*verifierades/);
  const legacyCollection = buildObsidianMarkdown(
    [audit],
    'V1 med V2-liknande fält',
    obsidianOptions(DATASET_VERSION),
  );
  assert.match(
    legacyCollection,
    /data_provenance: "legacy_or_unverified_ui_preview"/,
  );
  assert.doesNotMatch(legacyCollection, /batchHash.*verifierades/);

  const unattestedV2 = buildCompanyMarkdown(
    audit,
    obsidianOptions(DATASET_VERSION_V2),
  );
  assert.match(
    unattestedV2,
    /data_provenance: "legacy_or_unverified_ui_preview"/,
  );

  const parsedDataset = parseDatasetJson(JSON.stringify(v2DatasetFor(company)));
  const parsedAudit = auditCompany(
    parsedDataset.companies[0],
    [getRule('SEO-001')!],
    now,
  );
  const verifiedOptions = obsidianOptions(
    DATASET_VERSION_V2,
    now,
    now,
    'verified_batch_v2',
    parsedDataset,
  );
  const verifiedMarkdown = buildCompanyMarkdown(parsedAudit, verifiedOptions);
  assert.match(
    verifiedMarkdown,
    /data_provenance: "verified_v2_batch_dataset_declared_ui_preview"/,
  );
  assert.match(verifiedMarkdown, /batchHash.*verifierades/);
  assert.match(verifiedMarkdown, /datasetHash.*inte verifieras självständigt/i);
  const verifiedCollection = buildObsidianMarkdown(
    [parsedAudit],
    'Verifierad V2',
    verifiedOptions,
  );
  assert.match(
    verifiedCollection,
    /data_provenance: "verified_v2_batch_dataset_declared_ui_preview"/,
  );
  const preview = JSON.parse(
    buildResultJson([parsedAudit], parsedDataset.name, parsedDataset, now),
  ) as { sourceDataset: Record<string, unknown> };
  assert.equal(preview.sourceDataset.batchContractVerified, true);
  assert.equal(
    preview.sourceDataset.datasetHashVerification,
    'declared_bound_not_independently_verified_from_batch',
  );
  assert.equal(
    preview.sourceDataset.evaluationPolicyHash,
    EVALUATION_POLICY_HASH,
  );

  const incompleteCompany = structuredClone(company);
  incompleteCompany.relationshipStatus = 'probable_primary';
  const incompleteAudit = auditCompany(
    incompleteCompany,
    [getRule('SEO-001')!],
    now,
  );
  const incompleteMarkdown = buildCompanyMarkdown(
    incompleteAudit,
    verifiedOptions,
  );
  assert.match(
    incompleteMarkdown,
    /data_provenance: "legacy_or_unverified_ui_preview"/,
  );
  assert.doesNotMatch(incompleteMarkdown, /batchHash.*verifierades/);
});

test('1 000 syntetiska företag kan utvärderas i en lokal batch', () => {
  const base = SAMPLE_DATASET.companies[3];
  const dataset: AuditDataset = {
    version: DATASET_VERSION,
    name: 'Prestandafixtur',
    createdAt: now,
    companies: Array.from({ length: 1000 }, (_, index) => ({
      ...structuredClone(base),
      id: `bulk-${index.toString().padStart(4, '0')}`,
      name: `Syntetiskt företag ${index}`,
      domain: `company-${index}.example`,
    })),
  };
  const started = performance.now();
  const audits = auditDataset(dataset, now);
  const elapsed = performance.now() - started;
  assert.equal(audits.length, 1000);
  assert.ok(elapsed < 10_000, `batchen tog ${Math.round(elapsed)} ms`);
});

test('produktionsgränsen 100 företag × 120 regler håller lokal resursbudget', () => {
  const base = SAMPLE_DATASET.companies[3];
  const dataset: AuditDataset = {
    version: DATASET_VERSION,
    name: 'Stresstest',
    createdAt: now,
    companies: Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(base),
      id: `stress-${index.toString().padStart(5, '0')}`,
      name: `Stresstestföretag ${index}`,
      domain: `stress-${index}.example`,
    })),
  };
  const memoryBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const audits = auditDataset(dataset, now);
  const elapsed = performance.now() - started;
  const memoryGrowth = process.memoryUsage().heapUsed - memoryBefore;
  assert.equal(audits.length, 100);
  assert.ok(elapsed < 5_000, `stresstestet tog ${Math.round(elapsed)} ms`);
  assert.ok(
    memoryGrowth < 100 * 1024 * 1024,
    `heap ökade med ${Math.round(memoryGrowth / 1024 / 1024)} MB`,
  );
});

test('UI-källan bevarar de kritiska tillgänglighetskontrakten', async () => {
  const pageSource = await readFile(resolve('app/page.tsx'), 'utf8');
  const cssSource = await readFile(resolve('app/globals.css'), 'utf8');

  assert.equal(
    pageSource.match(/ref=\{viewHeadingRef\}/gu)?.length,
    3,
    'varje SPA-vy ska ha en programmerbart fokuserbar huvudrubrik',
  );
  assert.match(pageSource, /ref=\{workbenchHeadingRef\}/u);
  assert.match(
    pageSource,
    /\? workbenchHeadingRef\s*: viewHeadingRef\s*\)\.current\?\.focus/u,
  );
  assert.match(pageSource, /useState<View>\('workbench'\)/u);
  assert.match(pageSource, /hidden=\{view !== 'workbench'\}/u);
  assert.match(
    pageSource,
    /setPage\(Math\.floor\(index \/ PAGE_SIZE\) \+ 1\)/u,
  );
  assert.match(
    pageSource,
    /hasUnsavedWork \|\| revision !== workspaceRevisionRef\.current/u,
  );
  assert.match(
    pageSource,
    /const request = \+\+localImportRequestRef\.current/u,
  );
  assert.match(pageSource, /aria-label="Sidindelning för företagslistan"/gu);
  assert.match(pageSource, /id="company-list"/gu);
  assert.match(
    pageSource,
    /ref=\{companyPageStatusRef\}[\s\S]*?aria-live="polite"/gu,
  );
  assert.match(pageSource, /Prioritet \$\{audit\.priorityScore\} av 100/gu);
  assert.match(pageSource, /<ol[\s\S]*?aria-label="Dataflöde"/gu);
  assert.match(
    pageSource,
    /<fieldset[\s\S]*?aria-labelledby="review-decision-heading"/gu,
  );
  assert.match(pageSource, /type="radio"[\s\S]*?name="review-decision"/gu);
  assert.match(
    pageSource,
    /Regelfiltret visar \$\{visibleRules\.length\} regler/gu,
  );
  assert.match(pageSource, /<dl[\s\S]*?aria-label="Produktionskontroller"/gu);
  assert.match(
    pageSource,
    /<time dateTime=\{productionDiagnostic\.verifiedAt\}>/gu,
  );
  assert.match(
    cssSource,
    /\[data-slot='button'\]\.bg-primary:hover[\s\S]*?var\(--primary\) 90%/gu,
  );
  assert.match(cssSource, /@media \(forced-colors: active\)/gu);
});
