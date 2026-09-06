import {
  isValidIsoTimestamp,
  stableHash,
  unicodeCodePointCompare,
} from './engine';
import { inspectPortableJsonStructure } from './json-guard';

export const PRODUCTION_STATUS_VERSION =
  'foretagskarta.production-status.v1' as const;
export const MAX_PRODUCTION_STATUS_BYTES = 256_000;
export const MAX_PRODUCTION_DIAGNOSTIC_BYTES = 64_000_000;
export const MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES = 16_000_000;
export const MAX_PRODUCTION_STATUS_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PRODUCTION_VALIDATION_ISSUES = 100;
const MAX_PRODUCTION_STATUS_JSON_DEPTH = 32;
const MAX_PRODUCTION_STATUS_JSON_NODES = 250_000;
const MAX_PRODUCTION_DIAGNOSTIC_JSON_DEPTH = 64;
const MAX_PRODUCTION_DIAGNOSTIC_JSON_NODES = 250_000;

export type ProductionCheckState = 'PASS' | 'WARN' | 'FAIL';
export type ProductionOverallStatus = 'PASS' | 'FAIL';

export type ProductionCheck = {
  name: string;
  status: ProductionCheckState;
  details: unknown;
};

export type ProductionStatusReport = {
  activityClaimsVerified: boolean;
  checkedAt: string;
  checks: ProductionCheck[];
  cutoverPerformed: boolean;
  cutoverReady: boolean;
  externalCollectionPerformed: boolean;
  failures: number;
  fullReportBytes: number;
  fullReportFile: 'production-check-latest.full.json';
  fullReportSha256: string;
  outreachPerformed: boolean;
  productionCandidate: boolean;
  reportKind: 'summary';
  status: ProductionOverallStatus;
  version: typeof PRODUCTION_STATUS_VERSION;
  warnings: number;
};

export type ParsedProductionStatus = ProductionStatusReport & {
  ageMs: number;
  canonicalReportHash: string;
  isStale: boolean;
  loadedAt: string;
  passCount: number;
};

export type VerifiedProductionDiagnostic = {
  bytes: number;
  checkCount: number;
  fileName: 'production-check-latest.full.json';
  sha256: string;
  verifiedAt: string;
};

export type ProductionCheckGuidance = {
  nextAction: string;
  summary: string;
};

export class ProductionStatusValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.name = 'ProductionStatusValidationError';
    this.issues = issues;
  }
}

const ROOT_KEYS = [
  'activityClaimsVerified',
  'checkedAt',
  'checks',
  'cutoverPerformed',
  'cutoverReady',
  'externalCollectionPerformed',
  'failures',
  'fullReportBytes',
  'fullReportFile',
  'fullReportSha256',
  'outreachPerformed',
  'productionCandidate',
  'reportKind',
  'status',
  'version',
  'warnings',
] as const;

const CHECK_KEYS = ['details', 'name', 'status'] as const;

const DIAGNOSTIC_ROOT_KEYS = [
  'activityClaimsVerified',
  'checkedAt',
  'checks',
  'cutoverPerformed',
  'cutoverReady',
  'externalCollectionPerformed',
  'failures',
  'outreachPerformed',
  'productionCandidate',
  'reportKind',
  'status',
  'version',
  'warnings',
] as const;

const REQUIRED_CHECKS = [
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
] as const;
const REQUIRED_CHECK_SET = new Set<string>(REQUIRED_CHECKS);

const CHECK_LABELS: Record<string, string> = {
  append_only_review_import_and_suppression_guards:
    'Append-only review- och importspärrar',
  audit_results_usable: 'Användbara auditresultat',
  backup_restore: 'Backup och återställning',
  backup_storage_separate_volume: 'Separat backupvolym',
  calibration_evidence_available: 'Kalibreringsunderlag',
  database_integrity: 'Databasintegritet',
  database_rule_contract_registry_exact: 'Exakt regelregister i databasen',
  decisive_results_have_bound_evidence: 'Evidensbundna avgörande resultat',
  derived_human_review_queue: 'Mänsklig granskningskö',
  end_to_end_import_exact: 'Exakt E2E-import',
  evidence_artifacts_integrity: 'Evidensartefakternas integritet',
  legacy_artifact_references_complete: 'Historiska artefaktreferenser',
  newer_protocol_invalid_audits_suppressed: 'Nyare protokollogiltiga audits',
  no_current_contact_candidates: 'Ingen aktiv kontaktkö',
  obsidian_canvas_integrity: 'Obsidian Canvas-integritet',
  open_quarantine_visible: 'Öppen karantän',
  runtime_outside_vault: 'Motor utanför aktivt valv',
  schema_migrations_exact: 'Exakta databasmigrationer',
  single_vault_configuration: 'Enkel valvkonfiguration',
  staging_projection_exact: 'Exakt stagingprojektion',
  state_outside_vault: 'Runtime-data utanför aktivt valv',
  system_versions_current: 'Aktuella systemversioner',
  versioned_rule_and_fact_contracts: 'Versionsbundna regel- och faktakontrakt',
};

export const productionCheckLabel = (name: string): string =>
  CHECK_LABELS[name] ?? name.replaceAll('_', ' ');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeysMatch = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort(unicodeCodePointCompare);
  const sortedExpected = [...expected].sort(unicodeCodePointCompare);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isState = (value: unknown): value is ProductionCheckState =>
  value === 'PASS' || value === 'WARN' || value === 'FAIL';

const isOverallStatus = (value: unknown): value is ProductionOverallStatus =>
  value === 'PASS' || value === 'FAIL';

const sha256Bytes = async (bytes: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle)
    throw new ProductionStatusValidationError([
      'Den lokala miljön saknar Web Crypto och kan inte verifiera fullrapportens SHA-256.',
    ]);
  const copy = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
};

const safeCount = (
  value: Record<string, unknown>,
  key: string,
): number | undefined =>
  typeof value[key] === 'number' &&
  Number.isSafeInteger(value[key]) &&
  value[key] >= 0
    ? value[key]
    : undefined;

const nestedRecord = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined =>
  isRecord(value[key]) ? value[key] : undefined;

export const productionCheckGuidance = (
  check: ProductionCheck,
): ProductionCheckGuidance => {
  const details = isRecord(check.details) ? check.details : {};
  if (check.name === 'audit_results_usable') {
    const total = safeCount(details, 'total');
    const decisive = safeCount(details, 'decisive');
    const notTested = safeCount(details, 'notTested');
    const proposals = safeCount(details, 'completedCandidateProposals');
    const usable = safeCount(details, 'usableAssessments');
    const states = nestedRecord(details, 'states');
    const needsReview = states ? safeCount(states, 'needs_review') : undefined;
    return {
      summary:
        total !== undefined &&
        decisive !== undefined &&
        notTested !== undefined &&
        needsReview !== undefined
          ? `${decisive} av ${total} resultat är avgörande; ${notTested} är inte testade och ${needsReview} kräver granskning.${
              proposals !== undefined && usable !== undefined
                ? ` ${proposals} slutförda kandidatförslag och ${usable} användbara bedömningar finns för kalibrering. Kandidatförslag är inte bekräftade fynd.`
                : ''
            }`
          : 'Auditresultaten saknar tillräckligt avgörande, evidensbundna utfall.',
      nextAction:
        'Samla tillåten sid-, renderings- och täckningsevidens och kör en ny förseglad batch; ändra inte poäng eller regelstatus för att dölja luckan.',
    };
  }
  if (check.name === 'newer_protocol_invalid_audits_suppressed') {
    const count = safeCount(details, 'count');
    const suppressed = Array.isArray(details.suppressed)
      ? details.suppressed
      : [];
    const first = isRecord(suppressed[0]) ? suppressed[0] : undefined;
    const eventUid =
      first &&
      typeof first.eventUid === 'string' &&
      /^AUD:[a-f0-9]{32}$/u.test(first.eventUid)
        ? first.eventUid
        : undefined;
    return {
      summary: `${count ?? 'En eller flera'} arbetsställen undertrycks av en nyare protokollogiltig audit${eventUid ? ` (${eventUid})` : ''}.`,
      nextAction:
        'Skapa en ny protokollgiltig append-only audit efter mänsklig granskning; radera eller skriv inte om historiken.',
    };
  }
  if (check.name === 'backup_storage_separate_volume') {
    return {
      summary:
        details.sameVolume === true
          ? 'Databasen och dess backup ligger på samma volym och kan förloras i samma diskfel.'
          : 'Backupens fysiska separation är inte verifierad.',
      nextAction:
        'Kopiera en verifierad V4-backup till en separat fysisk volym och kör restore-test från den kopian.',
    };
  }
  if (check.name === 'backup_restore') {
    return {
      summary:
        details.witnessValid === true && details.restoreStatus === 'PASS'
          ? 'Ett verifierat återställningsbevis finns, men dess färskhet eller bindning till aktuell datageneration måste uppfylla produktionskontrollen.'
          : 'Ett giltigt och aktuellt återställningsbevis saknas eller kunde inte verifieras.',
      nextAction:
        'Skapa en generationsbunden backup på separat fysisk disk och kör ett verkligt restore-test. Kontrollera filhashar, datainnehåll och nytt bevis; ändra inte datum i gamla rapporter.',
    };
  }
  if (check.name === 'legacy_artifact_references_complete') {
    const count = safeCount(details, 'legacyUnresolvedCount');
    return {
      summary: `${count ?? 'Några'} historiska resultatreferenser saknar återverifierbara artefaktfiler.`,
      nextAction:
        'Återställ byte-exakta filer från äldre backup eller dokumentera ett mänskligt waiver-beslut; skapa inte ersättningsdata.',
    };
  }
  if (check.name === 'open_quarantine_visible') {
    const open = safeCount(details, 'open');
    return {
      summary: `${open ?? 'En eller flera'} karantänposter väntar på mänsklig resolution.`,
      nextAction:
        'Granska en post i taget med exakt post-ID, källhash, motivering och namngiven reviewer.',
    };
  }
  if (check.name === 'calibration_evidence_available') {
    const rulesWithReviews = safeCount(details, 'rulesWithReviews');
    const suggestions = safeCount(details, 'activationSuggestions');
    const expected = safeCount(details, 'expectedCandidateAutomatedRules');
    const thresholds = nestedRecord(details, 'thresholds');
    const samples = thresholds
      ? safeCount(thresholds, 'minimumSamples')
      : undefined;
    return {
      summary: `${rulesWithReviews ?? 'Okänt antal'} regler har kalibreringsreviews och ${suggestions ?? 'okänt antal'} aktiveringsförslag finns.${
        expected !== undefined && samples !== undefined
          ? ` Kravet omfattar ${expected} kandidatregler med minst ${samples} jämförelser per regel samt policykraven för märkning och träffsäkerhet.`
          : ''
      }`,
      nextAction:
        'Genomför blind mänsklig jämförelse på ett litet evidensbundet urval innan någon regelversion aktiveras.',
    };
  }
  return {
    summary: `Kontrollen rapporterar ${check.status} och saknar en specialiserad förklaring i denna DivineList-version.`,
    nextAction:
      'Läs kontrollens källdetaljer i den maskinella statusfilen och verifiera orsaken innan state ändras.',
  };
};

export const parseProductionStatusJson = (
  json: string,
  loadedAt = new Date().toISOString(),
): ParsedProductionStatus => {
  if (!isValidIsoTimestamp(loadedAt))
    throw new ProductionStatusValidationError([
      'Den lokala inläsningstiden måste vara en strikt giltig ISO-tidpunkt.',
    ]);
  const loadedAtMs = Date.parse(loadedAt);
  if (new TextEncoder().encode(json).byteLength > MAX_PRODUCTION_STATUS_BYTES)
    throw new ProductionStatusValidationError([
      `Statusfilen överskrider ${MAX_PRODUCTION_STATUS_BYTES.toLocaleString('sv-SE')} UTF-8-byte.`,
    ]);

  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new ProductionStatusValidationError([
      'Statusfilen är inte giltig JSON.',
    ]);
  }
  const structureIssues = inspectPortableJsonStructure(raw, {
    maxDepth: MAX_PRODUCTION_STATUS_JSON_DEPTH,
    maxIssues: MAX_PRODUCTION_VALIDATION_ISSUES,
    maxNodes: MAX_PRODUCTION_STATUS_JSON_NODES,
    rootLabel: 'statusfil',
  });
  if (structureIssues.length)
    throw new ProductionStatusValidationError(structureIssues);
  if (!isRecord(raw))
    throw new ProductionStatusValidationError([
      'Statusfilens rot måste vara ett objekt.',
    ]);

  const issues: string[] = [];
  if (!exactKeysMatch(raw, ROOT_KEYS))
    issues.push('Statusfilen har saknade eller okända rotfält.');
  if (raw.version !== PRODUCTION_STATUS_VERSION)
    issues.push(
      `version måste vara ${PRODUCTION_STATUS_VERSION}. Kör om motorns production-check och välj den nya sammanfattningsfilen.`,
    );
  if (raw.reportKind !== 'summary')
    issues.push(
      'reportKind måste vara summary. Välj production-check-latest.json, inte den fulla diagnostikfilen.',
    );
  if (raw.fullReportFile !== 'production-check-latest.full.json')
    issues.push('fullReportFile måste vara production-check-latest.full.json.');
  if (
    typeof raw.fullReportSha256 !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(raw.fullReportSha256)
  )
    issues.push('fullReportSha256 måste vara ett giltigt SHA-256-värde.');
  if (
    !Number.isSafeInteger(raw.fullReportBytes) ||
    Number(raw.fullReportBytes) <= 0 ||
    Number(raw.fullReportBytes) > MAX_PRODUCTION_DIAGNOSTIC_BYTES
  )
    issues.push(
      `fullReportBytes måste vara ett positivt heltal på högst ${MAX_PRODUCTION_DIAGNOSTIC_BYTES.toLocaleString('sv-SE')} byte.`,
    );
  if (typeof raw.checkedAt !== 'string' || !isValidIsoTimestamp(raw.checkedAt))
    issues.push('checkedAt måste vara en strikt giltig ISO-tidpunkt.');
  if (
    typeof raw.checkedAt === 'string' &&
    isValidIsoTimestamp(raw.checkedAt) &&
    Date.parse(raw.checkedAt) > loadedAtMs + 300_000
  )
    issues.push('checkedAt ligger mer än fem minuter i framtiden.');
  for (const field of [
    'activityClaimsVerified',
    'cutoverPerformed',
    'cutoverReady',
    'externalCollectionPerformed',
    'outreachPerformed',
    'productionCandidate',
  ] as const) {
    if (typeof raw[field] !== 'boolean')
      issues.push(`${field} måste vara boolean.`);
  }
  if (!Number.isInteger(raw.failures) || Number(raw.failures) < 0)
    issues.push('failures måste vara ett heltal större än eller lika med 0.');
  if (!Number.isInteger(raw.warnings) || Number(raw.warnings) < 0)
    issues.push('warnings måste vara ett heltal större än eller lika med 0.');
  if (!isOverallStatus(raw.status))
    issues.push('status måste vara PASS eller FAIL.');
  if (!Array.isArray(raw.checks) || raw.checks.length === 0)
    issues.push('checks måste vara en icke-tom lista.');
  if (issues.length) throw new ProductionStatusValidationError(issues);

  const checks: ProductionCheck[] = [];
  const names = new Set<string>();
  if ((raw.checks as unknown[]).length !== REQUIRED_CHECKS.length)
    issues.push(
      `checks måste innehålla exakt ${REQUIRED_CHECKS.length} obligatoriska kontroller.`,
    );
  (raw.checks as unknown[]).forEach((value, index) => {
    if (!isRecord(value) || !exactKeysMatch(value, CHECK_KEYS)) {
      issues.push(`checks[${index}] har saknade eller okända fält.`);
      return;
    }
    if (
      typeof value.name !== 'string' ||
      !/^[a-z][a-z0-9_]{2,79}$/u.test(value.name)
    ) {
      issues.push(`checks[${index}].name är ogiltigt.`);
      return;
    }
    if (!REQUIRED_CHECK_SET.has(value.name)) {
      issues.push(`Okänd kontroll tillåts inte: ${value.name}.`);
      return;
    }
    if (names.has(value.name)) {
      issues.push(`checks[${index}].name duplicerar ${value.name}.`);
      return;
    }
    if (!isState(value.status)) {
      issues.push(`checks[${index}].status är ogiltigt.`);
      return;
    }
    names.add(value.name);
    checks.push({
      name: value.name,
      status: value.status,
      details: value.details,
    });
  });
  for (const name of REQUIRED_CHECKS) {
    if (!names.has(name)) issues.push(`Obligatorisk kontroll saknas: ${name}.`);
  }

  const failures = checks.filter((check) => check.status === 'FAIL').length;
  const warnings = checks.filter((check) => check.status === 'WARN').length;
  const expectedStatus: ProductionOverallStatus = failures ? 'FAIL' : 'PASS';
  if (raw.failures !== failures)
    issues.push(
      `failures är ${String(raw.failures)} men checks innehåller ${failures} FAIL.`,
    );
  if (raw.warnings !== warnings)
    issues.push(
      `warnings är ${String(raw.warnings)} men checks innehåller ${warnings} WARN.`,
    );
  if (raw.status !== expectedStatus)
    issues.push(`status måste vara ${expectedStatus} utifrån checks.`);
  if (raw.cutoverPerformed === true && raw.cutoverReady !== true)
    issues.push('cutoverPerformed kräver cutoverReady=true.');
  if (raw.cutoverPerformed === true && raw.productionCandidate !== true)
    issues.push('cutoverPerformed kräver productionCandidate=true.');
  if (raw.cutoverReady === true && raw.productionCandidate !== true)
    issues.push('cutoverReady kräver productionCandidate=true.');
  if (raw.productionCandidate !== (failures === 0))
    issues.push(
      `productionCandidate måste vara ${failures === 0 ? 'true' : 'false'} utifrån FAIL-räknaren.`,
    );
  if (raw.cutoverReady !== (failures === 0 && warnings === 0))
    issues.push(
      `cutoverReady måste vara ${failures === 0 && warnings === 0 ? 'true' : 'false'} utifrån FAIL- och WARN-räknarna.`,
    );
  if (
    (raw.cutoverPerformed === true ||
      raw.externalCollectionPerformed === true ||
      raw.outreachPerformed === true) &&
    raw.activityClaimsVerified !== true
  )
    issues.push(
      'Utförd cutover, extern insamling eller kontakt kräver activityClaimsVerified=true.',
    );
  if (issues.length) throw new ProductionStatusValidationError(issues);

  const report: ProductionStatusReport = {
    activityClaimsVerified: raw.activityClaimsVerified as boolean,
    checkedAt: raw.checkedAt as string,
    checks: checks.sort((left, right) =>
      unicodeCodePointCompare(left.name, right.name),
    ),
    cutoverPerformed: raw.cutoverPerformed as boolean,
    cutoverReady: raw.cutoverReady as boolean,
    externalCollectionPerformed: raw.externalCollectionPerformed as boolean,
    failures,
    fullReportBytes: raw.fullReportBytes as number,
    fullReportFile: raw.fullReportFile as 'production-check-latest.full.json',
    fullReportSha256: raw.fullReportSha256 as string,
    outreachPerformed: raw.outreachPerformed as boolean,
    productionCandidate: raw.productionCandidate as boolean,
    reportKind: raw.reportKind as 'summary',
    status: expectedStatus,
    version: raw.version as typeof PRODUCTION_STATUS_VERSION,
    warnings,
  };
  return {
    ...report,
    ageMs: Math.max(0, loadedAtMs - Date.parse(report.checkedAt)),
    canonicalReportHash: stableHash(raw),
    isStale:
      loadedAtMs - Date.parse(report.checkedAt) > MAX_PRODUCTION_STATUS_AGE_MS,
    loadedAt,
    passCount: checks.filter((check) => check.status === 'PASS').length,
  };
};

export const productionStatusAgeAt = (
  summary: ParsedProductionStatus,
  now = new Date().toISOString(),
): number => {
  if (!isValidIsoTimestamp(now))
    throw new ProductionStatusValidationError([
      'Tiden för färskhetskontrollen måste vara en strikt giltig ISO-tidpunkt.',
    ]);
  return Math.max(0, Date.parse(now) - Date.parse(summary.checkedAt));
};

export const productionStatusIsStaleAt = (
  summary: ParsedProductionStatus,
  now = new Date().toISOString(),
): boolean =>
  productionStatusAgeAt(summary, now) > MAX_PRODUCTION_STATUS_AGE_MS;

export const productionStatusEffectiveCutoverReady = (
  summary: ParsedProductionStatus,
  diagnostic: VerifiedProductionDiagnostic | null,
  now = new Date().toISOString(),
): boolean =>
  summary.cutoverReady &&
  !productionStatusIsStaleAt(summary, now) &&
  diagnostic?.fileName === summary.fullReportFile &&
  diagnostic.bytes === summary.fullReportBytes &&
  diagnostic.sha256 === summary.fullReportSha256;

export const verifyProductionDiagnosticBytes = async (
  fileName: string,
  bytes: Uint8Array,
  summary: ParsedProductionStatus,
  verifiedAt = new Date().toISOString(),
): Promise<VerifiedProductionDiagnostic> => {
  const issues: string[] = [];
  if (!isValidIsoTimestamp(verifiedAt))
    issues.push(
      'Verifieringstiden för fullrapporten måste vara en strikt giltig ISO-tidpunkt.',
    );
  if (fileName !== summary.fullReportFile)
    issues.push(`Fullrapportens filnamn måste vara ${summary.fullReportFile}.`);
  if (bytes.byteLength <= 0) issues.push('Fullrapporten får inte vara tom.');
  if (bytes.byteLength > MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES)
    issues.push(
      `Fullrapporten överskrider webbläsargränsen ${MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES.toLocaleString('sv-SE')} byte. Verifiera en större rapport med motorns lokala CLI.`,
    );
  if (bytes.byteLength !== summary.fullReportBytes)
    issues.push(
      `Fullrapporten är ${bytes.byteLength.toLocaleString('sv-SE')} byte men sammanfattningen kräver ${summary.fullReportBytes.toLocaleString('sv-SE')} byte.`,
    );
  if (issues.length) throw new ProductionStatusValidationError(issues);

  const sha256 = await sha256Bytes(bytes);
  if (sha256 !== summary.fullReportSha256)
    throw new ProductionStatusValidationError([
      'Fullrapportens råa SHA-256 matchar inte den importerade sammanfattningen.',
    ]);

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProductionStatusValidationError([
      'Fullrapporten är inte strikt giltig UTF-8.',
    ]);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new ProductionStatusValidationError([
      'Fullrapporten är inte giltig JSON.',
    ]);
  }
  const structureIssues = inspectPortableJsonStructure(raw, {
    maxDepth: MAX_PRODUCTION_DIAGNOSTIC_JSON_DEPTH,
    maxIssues: MAX_PRODUCTION_VALIDATION_ISSUES,
    maxNodes: MAX_PRODUCTION_DIAGNOSTIC_JSON_NODES,
    rootLabel: 'fullrapport',
  });
  if (structureIssues.length)
    throw new ProductionStatusValidationError(structureIssues);
  if (!isRecord(raw))
    throw new ProductionStatusValidationError([
      'Fullrapportens rot måste vara ett objekt.',
    ]);

  if (!exactKeysMatch(raw, DIAGNOSTIC_ROOT_KEYS))
    issues.push('Fullrapporten har saknade eller okända rotfält.');
  if (raw.version !== summary.version)
    issues.push('Fullrapportens version matchar inte sammanfattningen.');
  if (raw.reportKind !== 'diagnostic')
    issues.push('Fullrapportens reportKind måste vara diagnostic.');
  if (raw.checkedAt !== summary.checkedAt)
    issues.push('Fullrapportens checkedAt matchar inte sammanfattningen.');
  if (raw.status !== summary.status)
    issues.push('Fullrapportens status matchar inte sammanfattningen.');
  if (raw.failures !== summary.failures)
    issues.push('Fullrapportens FAIL-räknare matchar inte sammanfattningen.');
  if (raw.warnings !== summary.warnings)
    issues.push('Fullrapportens WARN-räknare matchar inte sammanfattningen.');
  for (const field of [
    'activityClaimsVerified',
    'cutoverPerformed',
    'cutoverReady',
    'externalCollectionPerformed',
    'outreachPerformed',
    'productionCandidate',
  ] as const) {
    if (raw[field] !== summary[field])
      issues.push(`Fullrapportens ${field} matchar inte sammanfattningen.`);
  }
  if (!Array.isArray(raw.checks)) {
    issues.push('Fullrapportens checks måste vara en lista.');
  } else {
    if (raw.checks.length !== summary.checks.length)
      throw new ProductionStatusValidationError([
        `Fullrapporten innehåller ${raw.checks.length} kontroller men sammanfattningen innehåller ${summary.checks.length}.`,
      ]);
    const expectedChecks = new Map(
      summary.checks.map((check) => [check.name, check.status]),
    );
    const actualNames = new Set<string>();
    raw.checks.forEach((value, index) => {
      if (issues.length >= MAX_PRODUCTION_VALIDATION_ISSUES) return;
      if (!isRecord(value) || !exactKeysMatch(value, CHECK_KEYS)) {
        issues.push(
          `Fullrapportens checks[${index}] har saknade eller okända fält.`,
        );
        return;
      }
      if (
        typeof value.name !== 'string' ||
        !/^[a-z][a-z0-9_]{2,79}$/u.test(value.name) ||
        !isState(value.status)
      ) {
        issues.push(`Fullrapportens checks[${index}] är ogiltig.`);
        return;
      }
      if (actualNames.has(value.name)) {
        issues.push(`Fullrapporten duplicerar kontrollen ${value.name}.`);
        return;
      }
      actualNames.add(value.name);
      if (expectedChecks.get(value.name) !== value.status)
        issues.push(
          `Fullrapportens kontroll ${value.name} matchar inte sammanfattningen.`,
        );
    });
    for (const name of expectedChecks.keys()) {
      if (issues.length >= MAX_PRODUCTION_VALIDATION_ISSUES) break;
      if (!actualNames.has(name))
        issues.push(`Fullrapporten saknar kontrollen ${name}.`);
    }
  }
  if (issues.length) throw new ProductionStatusValidationError(issues);

  return {
    bytes: bytes.byteLength,
    checkCount: summary.checks.length,
    fileName: summary.fullReportFile,
    sha256,
    verifiedAt,
  };
};
