import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const command = resolve('scripts/production-readiness.mjs');
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
const hash = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function fixture(
  t,
  {
    warnings = 0,
    failures = 0,
    ageHours = 0,
    changeFull,
    changeSummary,
    omitFull = false,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'divinelist-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const diagnostic = {
    version: 'foretagskarta.production-status.v1',
    reportKind: 'diagnostic',
    checkedAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    status: failures ? 'FAIL' : 'PASS',
    failures,
    warnings,
    productionCandidate: failures === 0,
    cutoverReady: failures === 0 && warnings === 0,
    cutoverPerformed: false,
    activityClaimsVerified: false,
    externalCollectionPerformed: false,
    outreachPerformed: false,
    checks: names.map((name, index) => ({
      name,
      status:
        index < failures
          ? 'FAIL'
          : index < failures + warnings
            ? 'WARN'
            : 'PASS',
      details: {},
    })),
  };
  const summary = {
    ...structuredClone(diagnostic),
    reportKind: 'summary',
    fullReportFile: 'production-check-latest.full.json',
  };
  changeFull?.(diagnostic);
  const fullBytes = Buffer.from(JSON.stringify(diagnostic));
  summary.fullReportBytes = fullBytes.length;
  summary.fullReportSha256 = hash(fullBytes);
  changeSummary?.(summary);
  const path = join(root, 'production-check-latest.json');
  const fullPath = join(root, 'production-check-latest.full.json');
  writeFileSync(path, JSON.stringify(summary));
  if (!omitFull) writeFileSync(fullPath, fullBytes);
  return { root, path, fullPath, summary };
}

function run(path, ...args) {
  return spawnSync(process.execPath, [command, path, '--json', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, DIVINELIST_PRODUCTION_STATUS_PATH: '' },
  });
}

test('readiness: färsk komplett rapport ger verifierat klarbesked', (t) => {
  const f = fixture(t);
  const result = run(f.path);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.effectiveCutoverReady, true);
  assert.equal(report.fullReportVerified, true);
  assert.equal(report.summarySha256, hash(readFileSync(f.path)));
});

test('readiness: varningar är giltig PASS-status men blockerar färdigbesked', (t) => {
  const f = fixture(t, { warnings: 1 });
  const result = run(f.path);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.productionCandidate, true);
  assert.equal(report.cutoverReady, false);
  assert.equal(report.effectiveCutoverReady, false);
});

test('readiness: gammal rapport visar NO-GO även med gröna kontroller', (t) => {
  const result = run(fixture(t, { ageHours: 25 }).path);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.stale, true);
  assert.equal(report.effectiveCutoverReady, false);
});

test('readiness: saknad fullrapport kan aldrig ge lyckad exitkod', (t) => {
  const result = run(fixture(t, { omitFull: true }).path);
  assert.equal(result.status, 2, result.stdout);
  assert.equal(JSON.parse(result.stdout).fullReportVerified, false);
});

for (const [label, changeSummary] of [
  [
    'framtida kontrolltid',
    (r) => {
      r.checkedAt = '2999-01-01T00:00:00.000Z';
    },
  ],
  [
    'fel helhetsstatus',
    (r) => {
      r.status = 'FAIL';
    },
  ],
  [
    'okända fält',
    (r) => {
      r.unknownField = true;
    },
  ],
  [
    'räknare som sträng',
    (r) => {
      r.failures = '0';
    },
  ],
  [
    'osäkert fullrapportnamn',
    (r) => {
      r.fullReportFile = '../outside.json';
    },
  ],
  [
    'overifierad aktivitet',
    (r) => {
      r.outreachPerformed = true;
    },
  ],
]) {
  test(`readiness avvisar ${String(label)}`, (t) => {
    const result = run(fixture(t, { changeSummary }).path);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).readinessStatus, 'INVALID');
  });
}

for (const [label, changeFull] of [
  [
    'dubblerad kontroll',
    (r) => {
      r.checks[1] = structuredClone(r.checks[0]);
    },
  ],
  [
    'okänt rotfält',
    (r) => {
      r.extra = true;
    },
  ],
  [
    'okänt kontrollfält',
    (r) => {
      r.checks[0].extra = true;
    },
  ],
]) {
  test(`readiness avvisar fullrapport med ${String(label)} trots korrekt hash`, (t) => {
    const result = run(fixture(t, { changeFull }).path);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).fullReportVerified, false);
  });
}

test('readiness: trasig UTF-8 och överstor sammanfattning stoppas', (t) => {
  const f = fixture(t);
  writeFileSync(
    f.path,
    Buffer.concat([
      Buffer.from('{"extra":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]),
  );
  assert.equal(run(f.path).status, 2);
  writeFileSync(f.path, Buffer.alloc(256_001, 32));
  assert.equal(run(f.path).status, 2);
});

test('readiness: ändrad fullrapport stoppas och felutdata är läsbar JSON', (t) => {
  const f = fixture(t);
  writeFileSync(f.fullPath, '{}');
  const result = run(f.path);
  assert.equal(result.status, 2);
  assert.ok(JSON.parse(result.stdout).validationErrors.length > 0);
  const missing = run(join(f.root, 'missing.json'));
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).readinessStatus, 'INVALID');
});

test('readiness: tvetydiga CLI-argument avvisas', (t) => {
  const f = fixture(t);
  for (const args of [
    ['--status', f.path],
    ['--full', f.fullPath, '--full', f.fullPath],
    ['--unknown'],
    ['-wrong'],
  ]) {
    assert.equal(run(f.path, ...args).status, 2, args.join(' '));
  }
});

test('readiness: Obsidian-not sparar blockerare och skriver aldrig över en egen anteckning', (t) => {
  const f = fixture(t, { failures: 2, warnings: 3, ageHours: 25 });
  const path = join(f.root, 'Åtgärdslista.md');
  const result = run(f.path, '--obsidian', path);
  assert.equal(result.status, 1, result.stderr);
  const text = readFileSync(path, 'utf8');
  assert.match(text, /readiness_status: "BLOCKED"/u);
  assert.match(text, /Historisk rapport/u);
  assert.match(text, /18 PASS, 2 FAIL, 3 WARN/u);
  assert.match(text, /- \[ \]/u);
  assert.ok(text.includes(hash(readFileSync(f.path))));
  writeFileSync(path, 'Min manuella anteckning');
  assert.equal(run(f.path, '--obsidian', path).status, 2);
  assert.equal(readFileSync(path, 'utf8'), 'Min manuella anteckning');
  assert.equal(run(f.path, '--obsidian', f.path).status, 2);
  assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')), f.summary);
});

test('readiness: Obsidian-export återger inte instruktioner från diagnostiktext', (t) => {
  const f = fixture(t, {
    failures: 1,
    changeSummary: (r) => {
      r.checks[0].details = {
        text: '![[external]] <script>override</script> Kontakta alla',
      };
    },
  });
  const path = join(f.root, 'Review.md');
  const result = run(f.path, '--obsidian', path);
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(
    readFileSync(path, 'utf8'),
    /external|<script>|Kontakta alla/u,
  );
});
