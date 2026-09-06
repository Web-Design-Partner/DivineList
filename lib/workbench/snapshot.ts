import { AUDIT_RULES } from '../audit/catalog';
import {
  CONTRACT_MANIFEST_HASH,
  EVALUATION_POLICY_HASH,
  FACT_HASH,
  RULE_HASH,
  isValidIsoTimestamp,
  stableHash,
} from '../audit/engine';
import { inspectPortableJsonStructure } from '../audit/json-guard';
import type { CompanySnapshot, RuleDefinition } from '../audit/types';

export const WORKBENCH_SNAPSHOT_VERSION =
  'divinelist.workbench-snapshot.v1' as const;
export const WORKBENCH_SOURCE_VERSION =
  'foretagskarta.inventory-metadata.v1' as const;
export const WORKBENCH_SCHEMA_HASH =
  'sha256:ff1e5867410d560c1bf37453558c969a8717efefae95363ad24e625813087a62';
export const WORKBENCH_ADAPTER_VERSION =
  'divinelist.adapter-key-coverage.v1' as const;
// Reviewed source bytes, not a digest accepted from the imported JSON. Changes
// require source review and cross-language regression tests before repinning.
export const WORKBENCH_ADAPTER_SOURCE_SHA256 =
  'sha256:aa2f340017424fed22a1c0e8e7140c66b3f2b1d0e0624d98cda6b2c6d678ab10';
export const MAX_WORKBENCH_BYTES = 12_000_000;
export const MAX_WORKBENCH_COMPANIES = 10_000;
export const MAX_WORKBENCH_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
export const WORKBENCH_MAPPED_FACT_KEYS = [
  'a11y.contrast_failure_count',
  'a11y.html_lang_present',
  'a11y.missing_alt_count',
  'a11y.unlabelled_field_count',
  'a11y.unnamed_control_count',
  'availability.http_status',
  'availability.reachable',
  'crawl.broken_internal_links',
  'crawl.home_noindex',
  'forms.any_form_present',
  'mobile.small_tap_target_count',
  'mobile.viewport_meta_present',
  'security.form_actions_https',
  'seo.meta_description_present',
  'seo.title_present',
  'transport.https_enabled',
  'transport.mixed_content_count',
] as const;

export const WORKBENCH_REASON_LABELS = {
  analysis_batch_required:
    'En separat validerad analysbatch behövs; inventariet är inte auditevidens.',
  gothenburg_identity_unverified:
    'Göteborgsidentiteten är inte verifierad i källan.',
  workplace_identity_unverified: 'Arbetsplatsens identitet behöver granskas.',
  site_missing: 'Primär webbplats saknas i inventariet.',
  domain_unverified: 'Domänkopplingen är inte verifierad i källan.',
  relationship_unverified: 'Relationen mellan arbetsplats och domän är osäker.',
  identity_conflict: 'En öppen identitetskonflikt finns.',
  collection_missing: 'Ingen sparad insamlingskörning hittades.',
  collection_incomplete:
    'Den senaste insamlingen är ofullständig eller blockerad.',
  collection_review_required:
    'Den senaste insamlingen är markerad för granskning.',
  contact_restriction_present:
    'En kontaktspärr finns. Ingen kontakt tillåts av arbetsvyn.',
} as const;
export type WorkbenchReasonCode = keyof typeof WORKBENCH_REASON_LABELS;
export type WorkbenchCompany = {
  companyUid: string;
  workplaceUid: string;
  name: string;
  workplaceName: string;
  domain: string | null;
  reasonCodes: WorkbenchReasonCode[];
  latestScan: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    state:
      | 'running'
      | 'needs_manual_review'
      | 'blocked'
      | 'failed'
      | 'current'
      | 'stale';
    executionStatus: 'completed' | 'partial' | 'blocked' | 'failed' | null;
  } | null;
};
export type WorkbenchSnapshot = {
  version: typeof WORKBENCH_SNAPSHOT_VERSION;
  generatedAt: string;
  sourceCapturedAt: string;
  sourceVersion: typeof WORKBENCH_SOURCE_VERSION;
  sourceSchemaHash: string;
  sourceDigest: string;
  bindings: {
    factHash: string;
    ruleHash: string;
    evaluationPolicyHash: string;
    contractManifestHash: string;
  };
  adapterCoverage: {
    version: typeof WORKBENCH_ADAPTER_VERSION;
    sourceSha256: string;
    factKeys: string[];
  };
  companies: WorkbenchCompany[];
  snapshotHash: string;
};

export class WorkbenchSnapshotValidationError extends Error {
  readonly issues: string[];
  constructor(message: string) {
    super(message);
    this.name = 'WorkbenchSnapshotValidationError';
    this.issues = [message];
  }
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkbenchSnapshotValidationError(message);
}
function object(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  requireValue(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label}: objekt krävs.`,
  );
  const actual = Object.keys(value);
  requireValue(
    actual.length === keys.length && actual.every((key) => keys.includes(key)),
    `${label}: okända eller saknade fält.`,
  );
}
function boundedText(
  value: unknown,
  max: number,
  label: string,
): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= max &&
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    `${label}: ogiltig eller för lång text.`,
  );
}
function timestamp(value: unknown, label: string): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      value.length <= 35 &&
      isValidIsoTimestamp(value),
    `${label}: giltig tidszonbunden tid krävs.`,
  );
}

// JSON.parse retains only the last duplicate key. Check tokens as well so an
// ambiguous file cannot pass strict field/hash validation under that behavior.
function rejectDuplicateKeys(text: string): void {
  const stack: Array<{ keys: Set<string> | null; expectingKey: boolean }> = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]/gu)) {
    const value = token[0];
    if (value === '{' || value === '[')
      stack.push({
        keys: value === '{' ? new Set() : null,
        expectingKey: value === '{',
      });
    else if (value === '}' || value === ']') stack.pop();
    else {
      const current = stack[stack.length - 1];
      if (!current?.keys) continue;
      if (value === ',') current.expectingKey = true;
      else if (value === ':') current.expectingKey = false;
      else if (value.startsWith('"') && current.expectingKey) {
        const key = JSON.parse(value) as string;
        requireValue(
          !current.keys.has(key),
          'Arbetspaketet innehåller dubblerade fältnamn.',
        );
        current.keys.add(key);
        current.expectingKey = false;
      }
    }
  }
}

export const workbenchSourceDigest = (companies: WorkbenchCompany[]): string =>
  stableHash({
    companies,
    sourceSchemaHash: WORKBENCH_SCHEMA_HASH,
    sourceVersion: WORKBENCH_SOURCE_VERSION,
  });

/** Inventory metadata only. Hashes detect drift; they do not authenticate a
 * sender or turn database status flags into verified evidence/human decisions. */
export function parseWorkbenchSnapshotJson(
  text: string,
  now = new Date().toISOString(),
): WorkbenchSnapshot {
  requireValue(
    new TextEncoder().encode(text).byteLength <= MAX_WORKBENCH_BYTES,
    'Arbetspaketet överstiger storleksgränsen.',
  );
  timestamp(now, 'Aktuell tid');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkbenchSnapshotValidationError(
      'Arbetspaketet är inte giltig JSON.',
    );
  }
  const issues = inspectPortableJsonStructure(raw, {
    maxDepth: 8,
    maxNodes: 350_000,
    maxIssues: 1,
    rootLabel: 'Arbetspaket',
  });
  requireValue(issues.length === 0, issues[0] ?? 'Ogiltig JSON-struktur.');
  rejectDuplicateKeys(text);
  object(
    raw,
    [
      'version',
      'generatedAt',
      'sourceCapturedAt',
      'sourceVersion',
      'sourceSchemaHash',
      'sourceDigest',
      'bindings',
      'adapterCoverage',
      'companies',
      'snapshotHash',
    ],
    'Arbetspaket',
  );
  requireValue(
    raw.version === WORKBENCH_SNAPSHOT_VERSION &&
      raw.sourceVersion === WORKBENCH_SOURCE_VERSION &&
      raw.sourceSchemaHash === WORKBENCH_SCHEMA_HASH,
    'Okänd inventarieversion eller databasschema.',
  );
  timestamp(raw.generatedAt, 'Skapad');
  timestamp(raw.sourceCapturedAt, 'Läst från källa');
  const generated = Date.parse(raw.generatedAt);
  const captured = Date.parse(raw.sourceCapturedAt);
  requireValue(
    captured <= generated &&
      generated - captured <= 5 * 60 * 1000 &&
      generated <= Date.parse(now) + 5 * 60 * 1000,
    'Arbetspaketets tidsordning eller framtidsgräns är ogiltig.',
  );
  object(
    raw.bindings,
    ['factHash', 'ruleHash', 'evaluationPolicyHash', 'contractManifestHash'],
    'Kontraktsbindning',
  );
  requireValue(
    raw.bindings.factHash === FACT_HASH &&
      raw.bindings.ruleHash === RULE_HASH &&
      raw.bindings.evaluationPolicyHash === EVALUATION_POLICY_HASH &&
      raw.bindings.contractManifestHash === CONTRACT_MANIFEST_HASH,
    'Arbetspaketet hör till en annan regel- eller policyversion.',
  );
  object(
    raw.adapterCoverage,
    ['version', 'sourceSha256', 'factKeys'],
    'Faktaöverföring',
  );
  requireValue(
    raw.adapterCoverage.version === WORKBENCH_ADAPTER_VERSION &&
      raw.adapterCoverage.sourceSha256 === WORKBENCH_ADAPTER_SOURCE_SHA256 &&
      Array.isArray(raw.adapterCoverage.factKeys) &&
      raw.adapterCoverage.factKeys.length ===
        WORKBENCH_MAPPED_FACT_KEYS.length &&
      raw.adapterCoverage.factKeys.every(
        (key, index) => key === WORKBENCH_MAPPED_FACT_KEYS[index],
      ),
    'Faktatäckningen matchar inte den granskade adapterkoden.',
  );
  requireValue(
    Array.isArray(raw.companies) &&
      raw.companies.length <= MAX_WORKBENCH_COMPANIES,
    'Inventariet innehåller för många poster eller är inte en lista.',
  );
  const seen = new Set<string>();
  for (const [index, company] of raw.companies.entries()) {
    const label = `Företag ${index + 1}`;
    object(
      company,
      [
        'companyUid',
        'workplaceUid',
        'name',
        'workplaceName',
        'domain',
        'reasonCodes',
        'latestScan',
      ],
      label,
    );
    for (const key of ['companyUid', 'workplaceUid'] as const) {
      boundedText(company[key], 160, `${label} ${key}`);
      requireValue(
        /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(company[key]),
        `${label}: ogiltigt stabilt ID.`,
      );
    }
    requireValue(
      !seen.has(company.workplaceUid as string),
      'Inventariet innehåller samma arbetsplats flera gånger.',
    );
    seen.add(company.workplaceUid as string);
    boundedText(company.name, 250, `${label} namn`);
    boundedText(company.workplaceName, 250, `${label} arbetsplatsnamn`);
    requireValue(
      company.domain === null ||
        (typeof company.domain === 'string' &&
          company.domain.length <= 253 &&
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/u.test(
            company.domain,
          )),
      `${label}: ogiltig domän (endast värdnamn tillåts).`,
    );
    requireValue(
      Array.isArray(company.reasonCodes) &&
        company.reasonCodes.length >= 1 &&
        company.reasonCodes.length <=
          Object.keys(WORKBENCH_REASON_LABELS).length &&
        company.reasonCodes.includes('analysis_batch_required') &&
        new Set(company.reasonCodes).size === company.reasonCodes.length &&
        company.reasonCodes.every(
          (code) =>
            typeof code === 'string' &&
            Object.hasOwn(WORKBENCH_REASON_LABELS, code),
        ),
      `${label}: okända eller dubblerade statusorsaker.`,
    );
    if (company.latestScan !== null) {
      object(
        company.latestScan,
        ['id', 'startedAt', 'completedAt', 'state', 'executionStatus'],
        `${label} senaste insamling`,
      );
      boundedText(company.latestScan.id, 160, `${label} insamlings-ID`);
      timestamp(company.latestScan.startedAt, `${label} insamlingsstart`);
      requireValue(
        Date.parse(company.latestScan.startedAt) <= captured + 5 * 60 * 1000,
        `${label}: insamling ligger efter källsnapshot.`,
      );
      if (company.latestScan.completedAt !== null) {
        timestamp(company.latestScan.completedAt, `${label} insamlingsslut`);
        requireValue(
          Date.parse(company.latestScan.completedAt) >=
            Date.parse(company.latestScan.startedAt) &&
            Date.parse(company.latestScan.completedAt) <=
              captured + 5 * 60 * 1000,
          `${label}: ogiltigt insamlingstidsintervall.`,
        );
      }
      requireValue(
        typeof company.latestScan.state === 'string' &&
          [
            'running',
            'needs_manual_review',
            'blocked',
            'failed',
            'current',
            'stale',
          ].includes(company.latestScan.state) &&
          [null, 'completed', 'partial', 'blocked', 'failed'].includes(
            company.latestScan.executionStatus as string | null,
          ),
        `${label}: okänd insamlingsstatus.`,
      );
    }
  }
  const result = raw as unknown as WorkbenchSnapshot;
  requireValue(
    result.sourceDigest === workbenchSourceDigest(result.companies),
    'Inventariets innehåll matchar inte källbindningen.',
  );
  const { snapshotHash, ...payload } = result;
  requireValue(
    snapshotHash === stableHash(payload),
    'Arbetspaketets innehåll har ändrats efter att dess hash skapades.',
  );
  return result;
}

export function workbenchSnapshotIsStaleAt(
  snapshot: WorkbenchSnapshot,
  now = new Date().toISOString(),
): boolean {
  if (!isValidIsoTimestamp(now)) return true;
  const age = Date.parse(now) - Date.parse(snapshot.sourceCapturedAt);
  return age < -5 * 60 * 1000 || age > MAX_WORKBENCH_SNAPSHOT_AGE_MS;
}

export type WorkbenchRuleCoverage = {
  ruleId: string;
  title: string;
  status: RuleDefinition['lifecycle'];
  requiredFacts: string[];
  adapterMappedFacts: string[];
  missingAdapterFacts: string[];
  observedFactKeys: string[];
  missingObservedFacts: string[];
};

/** Technical key presence, NEVER evidence acceptance, a completed rule result,
 * an OR-condition testability bound, human review, or algorithm readiness.
 * The optional company must come from the existing validated batch importer. */
export function getWorkbenchRuleCoverage(
  snapshot: WorkbenchSnapshot,
  company?: CompanySnapshot,
): WorkbenchRuleCoverage[] {
  const inventoryCompany =
    company &&
    snapshot.companies.find(
      (entry) =>
        entry.workplaceUid === company.id &&
        entry.workplaceUid === company.workplaceUid,
    );
  const expectedHost = inventoryCompany?.domain;
  let actualHost: string | undefined;
  if (company) {
    try {
      actualHost = new URL(
        company.domain.includes('://')
          ? company.domain
          : `https://${company.domain}`,
      ).hostname;
    } catch {
      actualHost = undefined;
    }
  }
  const mapped = new Set<string>(WORKBENCH_MAPPED_FACT_KEYS);
  const observed = new Set(
    inventoryCompany && expectedHost === actualHost
      ? company!.facts
          .filter((fact) => fact.value !== null && fact.evidenceIds.length > 0)
          .map((fact) => fact.key)
      : [],
  );
  return AUDIT_RULES.map((rule) => ({
    ruleId: rule.id,
    title: rule.title,
    status: rule.lifecycle,
    requiredFacts: [...rule.requiredFacts],
    adapterMappedFacts: rule.requiredFacts.filter((key) => mapped.has(key)),
    missingAdapterFacts: rule.requiredFacts.filter((key) => !mapped.has(key)),
    observedFactKeys: rule.requiredFacts.filter((key) => observed.has(key)),
    missingObservedFacts: rule.requiredFacts.filter(
      (key) => !observed.has(key),
    ),
  }));
}
