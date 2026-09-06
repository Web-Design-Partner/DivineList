import { AUDIT_RULES } from './catalog';
import { FACT_REGISTRY, validateFact } from './fact-registry';
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
  RESULT_VERSION,
  REVIEW_DECISION_VERSION,
  RULESET_VERSION,
  type AuditDataset,
  type AuditFact,
  type Clause,
  type CompanyAudit,
  type CompanySnapshot,
  type Condition,
  type DatasetHashPayload,
  type EvidenceItem,
  type FactValue,
  type Primitive,
  type ResultState,
  type RuleDefinition,
  type RuleResult,
  type RuleTrace,
  type Severity,
} from './types';
import {
  AVAILABILITY_BLOCKER_RULE_IDS,
  CATEGORY_CAPS,
  EVALUATION_POLICY,
  EVIDENCE_METHOD_CONFIDENCE_CAPS,
  EVIDENCE_STRENGTH_SCORES,
  RENDER_DEPENDENT_METHODS,
  SEVERITY_POINTS,
  SITE_COVERAGE_FACT_PREFIXES,
  V2_COLLECTOR_POLICIES,
  V2_EVIDENCE_SCOPES,
} from './policy';

export { V2_COLLECTOR_POLICIES, V2_EVIDENCE_SCOPES } from './policy';

type ConditionState = 'true' | 'false' | 'missing' | 'conflict' | 'error';

type FactResolution = {
  state: 'value' | 'missing' | 'conflict';
  value?: FactValue;
  evidenceIds: string[];
};

const stateOrder: Record<ResultState, number> = {
  detected: 0,
  needs_review: 1,
  error: 2,
  not_tested: 3,
  not_detected: 4,
  not_applicable: 5,
};

const immutableRuleHashCache = new WeakMap<RuleDefinition, string>();

const ruleContentHash = (rule: RuleDefinition): string => {
  // Catalog rules are deeply frozen and safe to cache. Custom mutable rules are
  // rehashed on every use so a mutation can never keep an obsolete content hash.
  if (!Object.isFrozen(rule)) return stableHash(rule);
  const cached = immutableRuleHashCache.get(rule);
  if (cached) return cached;
  const hash = stableHash(rule);
  immutableRuleHashCache.set(rule, hash);
  return hash;
};

const severityOrder: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Python orders Unicode strings by scalar value. JavaScript's default sort and
// localeCompare do not define that same contract (notably for surrogate pairs),
// so every hash-relevant string ordering uses this explicit comparator.
export const unicodeCodePointCompare = (
  left: string,
  right: string,
): number => {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index])
      return leftPoints[index] < rightPoints[index] ? -1 : 1;
  }
  return leftPoints.length === rightPoints.length
    ? 0
    : leftPoints.length < rightPoints.length
      ? -1
      : 1;
};

const canonicalJson = (value: unknown): string | undefined => {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry) ?? 'null').join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort(unicodeCodePointCompare)
      .flatMap((key) => {
        const serialized = canonicalJson(value[key]);
        return serialized === undefined
          ? []
          : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const stableStringify = (value: unknown): string => {
  const serialized = canonicalJson(value);
  if (serialized === undefined)
    throw new TypeError('Värdet kan inte serialiseras som kanonisk JSON.');
  return serialized;
};

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, amount: number): number =>
  (value >>> amount) | (value << (32 - amount));

const sha256 = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const digest = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const sigma0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const sigma1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = digest;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    digest[0] = (digest[0] + a) >>> 0;
    digest[1] = (digest[1] + b) >>> 0;
    digest[2] = (digest[2] + c) >>> 0;
    digest[3] = (digest[3] + d) >>> 0;
    digest[4] = (digest[4] + e) >>> 0;
    digest[5] = (digest[5] + f) >>> 0;
    digest[6] = (digest[6] + g) >>> 0;
    digest[7] = (digest[7] + h) >>> 0;
  }

  return [...digest].map((part) => part.toString(16).padStart(8, '0')).join('');
};

export const stableHash = (value: unknown): string => {
  return `sha256:${sha256(stableStringify(value))}`;
};

export const EVALUATION_POLICY_HASH = stableHash(EVALUATION_POLICY);

export const FACT_CONTRACT = {
  version: FACT_REGISTRY_VERSION,
  facts: [...FACT_REGISTRY.values()],
} as const;

export const RULE_CONTRACT = {
  version: RULESET_VERSION,
  rules: AUDIT_RULES.map((rule) => ({
    ...rule,
    contentHash: stableHash(rule),
  })),
} as const;

export const FACT_HASH = stableHash(FACT_CONTRACT);
export const RULE_HASH = stableHash(RULE_CONTRACT);

export const HASH_GOLDEN_VALUE = {
  fixedThreshold: 0.000001,
  largeExponent: 1e21,
  largeFixed: 100000000000000000000,
  negativeZero: -0,
  smallExponent: 1e-7,
  unicode: 'Göteborg åäö',
  wholeFloat: 1.0,
} as const;

export const HASH_GOLDEN_VECTOR = {
  value: HASH_GOLDEN_VALUE,
  canonicalJson: stableStringify(HASH_GOLDEN_VALUE),
  sha256: stableHash(HASH_GOLDEN_VALUE),
} as const;

export const DATASET_HASH_CONTRACT = {
  ...EVALUATION_POLICY.datasetHash,
  evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
  evaluationPolicyHash: EVALUATION_POLICY_HASH,
  goldenVector: HASH_GOLDEN_VECTOR,
} as const;

export const DATASET_HASH_CONTRACT_HASH = stableHash(DATASET_HASH_CONTRACT);

export const CONTRACT_MANIFEST = {
  version: 'divinelist.contracts.v2',
  datasetVersion: DATASET_VERSION_V2,
  resultVersion: RESULT_VERSION,
  reviewDecisionVersion: REVIEW_DECISION_VERSION,
  factRegistryVersion: FACT_REGISTRY_VERSION,
  rulesetVersion: RULESET_VERSION,
  mappingVersion: MAPPING_VERSION,
  datasetHashVersion: DATASET_HASH_VERSION,
  evaluationPolicyVersion: EVALUATION_POLICY_VERSION,
  resultHashVersion: RESULT_HASH_VERSION,
  batchHashVersion: BATCH_HASH_VERSION,
  factCount: FACT_REGISTRY.size,
  ruleCount: AUDIT_RULES.length,
  factHash: FACT_HASH,
  ruleHash: RULE_HASH,
  evaluationPolicyHash: EVALUATION_POLICY_HASH,
  datasetHashContractHash: DATASET_HASH_CONTRACT_HASH,
  hashGoldenVector: HASH_GOLDEN_VECTOR,
  guardrails: {
    externalCollection: false,
    outreach: false,
    externalWrites: false,
  },
} as const;

export const CONTRACT_MANIFEST_HASH = stableHash(CONTRACT_MANIFEST);

const verifiedV2BatchSnapshots = new WeakMap<AuditDataset, string>();
// Keep the verified transport shape separately from normalized evaluation data.
// Optional missing fields (notably reviews) must not be injected into a sealed
// batch when saving it again. Strings prevent callers mutating this source copy.
const verifiedV2BatchTransports = new WeakMap<AuditDataset, string>();

/**
 * True only for an unchanged object returned by parseDatasetJson after exact
 * V2 version, policy and batchHash validation. datasetHash is declared by the
 * full export and bound by batchHash; it is not independently verified here.
 */
export const isVerifiedV2BatchContract = (
  dataset: AuditDataset | undefined,
): boolean => {
  if (!dataset || dataset.version !== DATASET_VERSION_V2) return false;
  const snapshot = verifiedV2BatchSnapshots.get(dataset);
  return (
    snapshot !== undefined &&
    snapshot === stableHash(dataset) &&
    dataset.datasetHashVersion === DATASET_HASH_VERSION &&
    dataset.evaluationPolicyVersion === EVALUATION_POLICY_VERSION &&
    dataset.evaluationPolicyHash === EVALUATION_POLICY_HASH &&
    dataset.factHash === FACT_HASH &&
    dataset.ruleHash === RULE_HASH &&
    dataset.datasetHashContractHash === DATASET_HASH_CONTRACT_HASH &&
    dataset.contractManifestHash === CONTRACT_MANIFEST_HASH &&
    dataset.batchHashVersion === BATCH_HASH_VERSION
  );
};

export const computeDatasetHash = (payload: DatasetHashPayload): string => {
  if (
    payload.version !== DATASET_VERSION_V2 ||
    payload.datasetHashVersion !== DATASET_HASH_VERSION ||
    payload.factRegistryVersion !== FACT_REGISTRY_VERSION ||
    payload.rulesetVersion !== RULESET_VERSION ||
    payload.mappingVersion !== MAPPING_VERSION ||
    payload.evaluationPolicyVersion !== EVALUATION_POLICY_VERSION ||
    payload.evaluationPolicyHash !== EVALUATION_POLICY_HASH ||
    payload.factHash !== FACT_HASH ||
    payload.ruleHash !== RULE_HASH ||
    payload.datasetHashContractHash !== DATASET_HASH_CONTRACT_HASH ||
    payload.contractManifestHash !== CONTRACT_MANIFEST_HASH
  )
    throw new Error(
      'datasetHash-payloaden måste använda exakt aktuellt dataset-, mapping-, regel-, fakta- och policykontrakt.',
    );
  if (
    typeof payload.name !== 'string' ||
    payload.name.trim() === '' ||
    !isValidIsoTimestamp(payload.createdAt) ||
    !Array.isArray(payload.companies)
  )
    throw new Error(
      'datasetHash-payloaden kräver namn, strikt createdAt och en full companies-lista.',
    );
  for (let index = 1; index < payload.companies.length; index += 1) {
    if (
      unicodeCodePointCompare(
        payload.companies[index - 1].id,
        payload.companies[index].id,
      ) >= 0
    )
      throw new Error(
        'datasetHash-payloadens companies måste vara unik och sorterad efter id i Unicode-kodpunktsordning.',
      );
  }
  return stableHash({
    version: payload.version,
    name: payload.name,
    createdAt: payload.createdAt,
    datasetHashVersion: payload.datasetHashVersion,
    factRegistryVersion: payload.factRegistryVersion,
    rulesetVersion: payload.rulesetVersion,
    mappingVersion: payload.mappingVersion,
    evaluationPolicyVersion: payload.evaluationPolicyVersion,
    evaluationPolicyHash: payload.evaluationPolicyHash,
    factHash: payload.factHash,
    ruleHash: payload.ruleHash,
    datasetHashContractHash: payload.datasetHashContractHash,
    contractManifestHash: payload.contractManifestHash,
    companies: payload.companies,
  });
};

const factIndex = (facts: AuditFact[]): Map<string, FactResolution> => {
  const grouped = new Map<string, AuditFact[]>();
  const indexed = new Map<string, FactResolution>();
  for (const fact of facts) {
    const candidates = grouped.get(fact.key);
    if (candidates) candidates.push(fact);
    else grouped.set(fact.key, [fact]);
  }

  for (const [key, candidates] of grouped) {
    const evidenceIds = [
      ...new Set(candidates.flatMap((candidate) => candidate.evidenceIds)),
    ].sort(unicodeCodePointCompare);
    const distinct = new Set(
      candidates.map((candidate) => stableStringify(candidate.value)),
    );
    if (distinct.size > 1) {
      indexed.set(key, { state: 'conflict', evidenceIds });
    } else {
      indexed.set(key, {
        state: 'value',
        value: candidates[0].value,
        evidenceIds,
      });
    }
  }
  return indexed;
};

const resolveFact = (
  facts: Map<string, FactResolution>,
  key: string,
): FactResolution => facts.get(key) ?? { state: 'missing', evidenceIds: [] };

const isEmpty = (value: FactValue): boolean =>
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const compareClause = (
  clause: Clause,
  fact: FactResolution,
): ConditionState => {
  if (fact.state === 'missing') return 'missing';
  if (fact.state === 'conflict') return 'conflict';

  const actual = fact.value;
  const expected = clause.value;
  switch (clause.operator) {
    case 'eq':
      return stableStringify(actual) === stableStringify(expected)
        ? 'true'
        : 'false';
    case 'neq':
      return stableStringify(actual) !== stableStringify(expected)
        ? 'true'
        : 'false';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (
        typeof actual !== 'number' ||
        typeof expected !== 'number' ||
        !Number.isFinite(actual)
      ) {
        return 'error';
      }
      if (clause.operator === 'gt') return actual > expected ? 'true' : 'false';
      if (clause.operator === 'gte')
        return actual >= expected ? 'true' : 'false';
      if (clause.operator === 'lt') return actual < expected ? 'true' : 'false';
      return actual <= expected ? 'true' : 'false';
    }
    case 'empty':
      return isEmpty(actual!) ? 'true' : 'false';
    case 'not_empty':
      return isEmpty(actual!) ? 'false' : 'true';
    case 'includes':
      if (Array.isArray(actual))
        return actual.includes(expected ?? null) ? 'true' : 'false';
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected) ? 'true' : 'false';
      }
      return 'error';
    case 'not_includes':
      if (Array.isArray(actual))
        return actual.includes(expected ?? null) ? 'false' : 'true';
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected) ? 'false' : 'true';
      }
      return 'error';
  }
};

const evaluateCondition = (
  condition: Condition,
  facts: Map<string, FactResolution>,
): ConditionState => {
  if ('fact' in condition)
    return compareClause(condition, resolveFact(facts, condition.fact));

  const conditions = 'all' in condition ? condition.all : condition.any;
  const values = conditions.map((entry) => evaluateCondition(entry, facts));

  if ('all' in condition) {
    // A single false branch decides an AND expression even if another branch
    // is missing, conflicting or malformed.  Non-decisive states matter only
    // when no branch has already made the expression false.
    if (values.includes('false')) return 'false';
    if (values.includes('error')) return 'error';
    if (values.includes('conflict')) return 'conflict';
    if (values.includes('missing')) return 'missing';
    return 'true';
  }

  // A single true branch decides an OR expression.  This prevents an
  // unrelated malformed or missing branch from hiding a decisive result.
  if (values.includes('true')) return 'true';
  if (values.includes('error')) return 'error';
  if (values.includes('conflict')) return 'conflict';
  if (values.includes('missing')) return 'missing';
  return 'false';
};

const describeClause = (entry: Clause): string => {
  const label: Record<Clause['operator'], string> = {
    eq: '=',
    neq: '≠',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    empty: 'är tomt',
    not_empty: 'är inte tomt',
    includes: 'innehåller',
    not_includes: 'innehåller inte',
  };
  return `${entry.fact} ${label[entry.operator]}${entry.value === undefined ? '' : ` ${String(entry.value)}`}`;
};

const buildTrace = (
  condition: Condition,
  facts: Map<string, FactResolution>,
): RuleTrace[] => {
  if ('fact' in condition) {
    const fact = resolveFact(facts, condition.fact);
    return [
      {
        fact: condition.fact,
        expected: describeClause(condition),
        actual:
          fact.state === 'missing'
            ? 'missing'
            : fact.state === 'conflict'
              ? 'conflict'
              : fact.value!,
        evidenceIds: fact.evidenceIds,
      },
    ];
  }
  return ('all' in condition ? condition.all : condition.any).flatMap((entry) =>
    buildTrace(entry, facts),
  );
};

const buildDecisionTrace = (
  condition: Condition,
  facts: Map<string, FactResolution>,
  outcome: 'true' | 'false',
): RuleTrace[] => {
  if ('fact' in condition) return buildTrace(condition, facts);
  const children = 'all' in condition ? condition.all : condition.any;
  const useSingleDecisiveBranch =
    ('all' in condition && outcome === 'false') ||
    ('any' in condition && outcome === 'true');
  if (useSingleDecisiveBranch) {
    const decisive = children.find(
      (entry) => evaluateCondition(entry, facts) === outcome,
    );
    return decisive ? buildDecisionTrace(decisive, facts, outcome) : [];
  }
  return children.flatMap((entry) => buildDecisionTrace(entry, facts, outcome));
};

const differenceInDays = (
  newerIso: string,
  olderIso: string,
): number | null => {
  const newer = Date.parse(newerIso);
  const older = Date.parse(olderIso);
  if (!Number.isFinite(newer) || !Number.isFinite(older)) return null;
  return (newer - older) / 86_400_000;
};

const evidenceQuality = (
  evidenceIds: string[],
  evidence: Map<string, EvidenceItem>,
  evaluatedAt: string,
  maxAgeDays: number,
): { confidence: number; limitations: string[] } => {
  const limitations: string[] = [];
  if (evidenceIds.length === 0) {
    return {
      confidence: 0.25,
      limitations: ['Ingen evidensreferens är bunden till observationen.'],
    };
  }

  const items = evidenceIds
    .map((id) => evidence.get(id))
    .filter(Boolean) as EvidenceItem[];
  if (items.length !== evidenceIds.length) {
    limitations.push('En eller flera evidensreferenser saknas i datasetet.');
  }
  if (items.length === 0) return { confidence: 0.25, limitations };

  let confidence = Math.min(
    ...items.map((item) =>
      Math.min(
        EVIDENCE_STRENGTH_SCORES[item.strength],
        EVIDENCE_METHOD_CONFIDENCE_CAPS[item.method],
      ),
    ),
  );
  const currentItems = items.filter((item) => {
    const age = differenceInDays(evaluatedAt, item.observedAt);
    return (
      age !== null &&
      age <= maxAgeDays &&
      age >= -EVALUATION_POLICY.evidence.maximumFutureSkewMinutes / 1440
    );
  });
  if (currentItems.length === 0) {
    confidence = Math.min(confidence, 0.45);
    limitations.push(
      `Evidensen är äldre än regelns gräns på ${maxAgeDays} dagar, framtidsdaterad eller har ogiltigt datum.`,
    );
  } else {
    confidence = Math.max(
      ...currentItems.map((item) =>
        Math.min(
          EVIDENCE_STRENGTH_SCORES[item.strength],
          EVIDENCE_METHOD_CONFIDENCE_CAPS[item.method],
        ),
      ),
    );
  }
  if (
    confidence < EVALUATION_POLICY.evidence.minimumConfidence &&
    currentItems.length > 0
  ) {
    limitations.push(
      'Evidensens verifierbara styrka understiger gränsen på 70 procent.',
    );
  }

  return { confidence, limitations };
};

const assessEvidenceForTrace = (
  trace: RuleTrace[],
  rule: RuleDefinition,
  evidence: Map<string, EvidenceItem>,
  evaluatedAt: string,
): {
  acceptedEvidenceIds: string[];
  rejectedEvidence: Array<{ evidenceId: string; reason: string }>;
  confidence: number;
  limitations: string[];
} => {
  const acceptedIds = new Set<string>();
  const rejected = new Map<string, string>();
  const confidences: number[] = [];
  const limitations: string[] = [];
  const seenFacts = new Set<string>();

  for (const item of trace) {
    if (seenFacts.has(item.fact)) continue;
    seenFacts.add(item.fact);
    const allowed = rule.evidenceMethodsByFact[item.fact] ?? [];
    const referenced = item.evidenceIds
      .map((id) => evidence.get(id))
      .filter(Boolean) as EvidenceItem[];
    for (const evidenceId of item.evidenceIds) {
      if (!evidence.has(evidenceId))
        rejected.set(evidenceId, 'missing_reference');
    }
    const methodAccepted = referenced.filter((entry) => {
      const valid = allowed.includes(entry.method);
      if (!valid) rejected.set(entry.id, `unsupported_method:${entry.method}`);
      return valid;
    });
    const accepted = methodAccepted.filter((entry) => {
      if (entry.limitations?.length) {
        rejected.set(entry.id, 'collector_limitations');
        return false;
      }
      const age = differenceInDays(evaluatedAt, entry.observedAt);
      if (age === null) {
        rejected.set(entry.id, 'invalid_timestamp');
        return false;
      }
      if (age < -EVALUATION_POLICY.evidence.maximumFutureSkewMinutes / 1440) {
        rejected.set(entry.id, 'future_timestamp');
        return false;
      }
      if (age > rule.maxEvidenceAgeDays) {
        rejected.set(entry.id, 'stale');
        return false;
      }
      return true;
    });

    if (item.evidenceIds.length === 0) {
      limitations.push(`${item.fact}: faktan saknar bunden evidens.`);
      continue;
    }
    if (referenced.length !== item.evidenceIds.length) {
      limitations.push(`${item.fact}: en bunden evidenspost saknas.`);
    }
    if (accepted.length === 0) {
      const rejectedReasons = methodAccepted.map((entry) =>
        rejected.get(entry.id),
      );
      if (rejectedReasons.includes('future_timestamp'))
        limitations.push(`${item.fact}: evidensen är framtidsdaterad.`);
      else if (rejectedReasons.includes('stale'))
        limitations.push(
          `${item.fact}: evidensen är äldre än regelns gräns på ${rule.maxEvidenceAgeDays} dagar.`,
        );
      else if (rejectedReasons.includes('invalid_timestamp'))
        limitations.push(`${item.fact}: evidensen har en ogiltig tidpunkt.`);
      else if (rejectedReasons.includes('collector_limitations'))
        limitations.push(
          `${item.fact}: insamlaren rapporterade begränsningar i evidensen.`,
        );
      else
        limitations.push(
          `${item.fact}: ingen bunden evidens använder en tillåten metod (${allowed.join(', ')}).`,
        );
      continue;
    }
    for (const entry of accepted) acceptedIds.add(entry.id);
    const quality = evidenceQuality(
      accepted.map((entry) => entry.id),
      evidence,
      evaluatedAt,
      rule.maxEvidenceAgeDays,
    );
    confidences.push(quality.confidence);
    limitations.push(
      ...quality.limitations.map((limitation) => `${item.fact}: ${limitation}`),
    );
  }

  return {
    acceptedEvidenceIds: [...acceptedIds].sort(unicodeCodePointCompare),
    rejectedEvidence: [...rejected.entries()]
      .sort(([left], [right]) => unicodeCodePointCompare(left, right))
      .map(([evidenceId, reason]) => ({ evidenceId, reason })),
    confidence: confidences.length ? Math.min(...confidences) : 0.25,
    limitations,
  };
};

const traceRequiresRenderedPage = (trace: RuleTrace[]): boolean =>
  trace.some((entry) =>
    FACT_REGISTRY.get(entry.fact)?.allowedMethods.some((method) =>
      (RENDER_DEPENDENT_METHODS as readonly EvidenceItem['method'][]).includes(
        method,
      ),
    ),
  );

const traceRequiresPageCoverage = (trace: RuleTrace[]): boolean =>
  trace.some((entry) => {
    const definition = FACT_REGISTRY.get(entry.fact);
    return (
      definition?.scope === 'page' ||
      (definition?.scope === 'site' &&
        SITE_COVERAGE_FACT_PREFIXES.some((prefix) =>
          entry.fact.startsWith(prefix),
        ))
    );
  });

const addExecutionGuardLimitations = (
  company: CompanySnapshot,
  rule: RuleDefinition,
  trace: RuleTrace[],
  limitations: string[],
): void => {
  if (traceRequiresRenderedPage(trace)) {
    const renderFidelity = company.renderFidelity ?? 'unknown';
    if (renderFidelity === 'degraded')
      limitations.push(
        'Sidan renderades med blockerade eller saknade resurser; sidbaserade slutsatser kräver full rendering.',
      );
    else if (renderFidelity === 'unknown')
      limitations.push(
        'Renderingens kvalitet är okänd; sidbaserade slutsatser får inte avgöras automatiskt.',
      );
  }

  if (traceRequiresPageCoverage(trace)) {
    if (!company.pageCoverage)
      limitations.push(
        'Sidtäckning saknas; sidbaserade slutsatser får inte avgöras automatiskt.',
      );
    else {
      const { eligiblePages, testedPages } = company.pageCoverage;
      const coverage = eligiblePages > 0 ? testedPages / eligiblePages : 0;
      if (eligiblePages === 0 || testedPages === 0)
        limitations.push(
          'Sidtäckningen saknar minst en relevant och testad sida.',
        );
      else if (coverage < rule.minimumCoverage)
        limitations.push(
          `Sidtäckningen är ${(coverage * 100).toFixed(0)} procent men regeln kräver minst ${(rule.minimumCoverage * 100).toFixed(0)} procent.`,
        );
    }
  }

  if (['human_required', 'manual_only'].includes(rule.evaluationMode))
    limitations.push(
      rule.evaluationMode === 'manual_only'
        ? 'Regeln är en manuell bedömningsrubrik och får inte ge ett automatiskt avgörande.'
        : 'Regeln kräver mänsklig bekräftelse innan utfallet får avgöras.',
    );
};

const resultBase = (
  company: CompanySnapshot,
  rule: RuleDefinition,
  inputHash: string,
  evaluatedAt: string,
): Omit<
  RuleResult,
  'state' | 'confidence' | 'evidenceIds' | 'limitations' | 'trace'
> => ({
  companyId: company.id,
  ruleId: rule.id,
  ruleVersion: rule.version,
  ruleContentHash: ruleContentHash(rule),
  ruleTier: rule.tier,
  ruleLifecycle: rule.lifecycle,
  evaluationMode: rule.evaluationMode,
  rulesetVersion: RULESET_VERSION,
  category: rule.category,
  severity: rule.severity,
  rootCause: rule.rootCause,
  title: rule.title,
  safeFinding: rule.safeFinding,
  recommendation: rule.recommendation,
  manualCheck: rule.manualCheck,
  evaluatedAt,
  inputHash,
  acceptedEvidenceIds: [],
  rejectedEvidence: [],
  executionStatus: 'completed',
  renderFidelity: company.renderFidelity ?? 'unknown',
  coverage: company.pageCoverage ?? {
    eligiblePages: 0,
    testedPages: 0,
    excludedPages: 0,
  },
});

const evaluateRule = (
  company: CompanySnapshot,
  rule: RuleDefinition,
  facts: Map<string, FactResolution>,
  evidence: Map<string, EvidenceItem>,
  inputHash: string,
  evaluatedAt: string,
): RuleResult => {
  const base = resultBase(company, rule, inputHash, evaluatedAt);
  const conditionTrace = buildTrace(rule.condition, facts);
  const applicabilityTrace = rule.appliesWhen
    ? buildTrace(rule.appliesWhen, facts)
    : [];
  let trace = [...applicabilityTrace, ...conditionTrace];

  try {
    if (
      rule.evaluationMode === 'paused' ||
      ['draft', 'paused', 'retired'].includes(rule.lifecycle)
    ) {
      return {
        ...base,
        state: 'not_tested',
        executionStatus: 'blocked',
        confidence: 0,
        evidenceIds: [],
        limitations: [
          `Regeln är inte körbar i lifecycle=${rule.lifecycle} och mode=${rule.evaluationMode}; inget automatiskt utfall tillåts.`,
        ],
        trace,
      };
    }
    if (rule.appliesWhen) {
      const applicability = evaluateCondition(rule.appliesWhen, facts);
      if (applicability === 'false') {
        trace = buildDecisionTrace(rule.appliesWhen, facts, 'false');
        const assessment = assessEvidenceForTrace(
          trace,
          rule,
          evidence,
          evaluatedAt,
        );
        addExecutionGuardLimitations(
          company,
          rule,
          trace,
          assessment.limitations,
        );
        const evidenceIsEnough = assessment.limitations.length === 0;
        return {
          ...base,
          state: evidenceIsEnough ? 'not_applicable' : 'needs_review',
          executionStatus: evidenceIsEnough ? 'completed' : 'partial',
          confidence: assessment.confidence,
          evidenceIds: assessment.acceptedEvidenceIds,
          acceptedEvidenceIds: assessment.acceptedEvidenceIds,
          rejectedEvidence: assessment.rejectedEvidence,
          limitations: assessment.limitations,
          trace,
        };
      }
      if (applicability === 'missing') {
        return {
          ...base,
          state: 'not_tested',
          confidence: 0,
          evidenceIds: [],
          executionStatus: 'partial',
          limitations: ['Indata som avgör om regeln är relevant saknas.'],
          trace,
        };
      }
      if (applicability === 'conflict') {
        return {
          ...base,
          state: 'needs_review',
          confidence: 0.2,
          evidenceIds: [],
          executionStatus: 'partial',
          limitations: ['Motstridiga fakta avgör inte om regeln är relevant.'],
          trace,
        };
      }
      if (applicability === 'error') {
        return {
          ...base,
          state: 'error',
          confidence: 0,
          evidenceIds: [],
          executionStatus: 'failed',
          limitations: [
            'Regeln kunde inte tolka indatatypen för relevansvillkoret.',
          ],
          trace,
        };
      }
    }

    const state = evaluateCondition(rule.condition, facts);
    if (state === 'missing') {
      return {
        ...base,
        state: 'not_tested',
        confidence: 0,
        evidenceIds: [],
        executionStatus: 'partial',
        limitations: ['Minst ett obligatoriskt faktavärde saknas.'],
        trace,
      };
    }
    if (state === 'conflict') {
      return {
        ...base,
        state: 'needs_review',
        confidence: 0.2,
        evidenceIds: [],
        executionStatus: 'partial',
        limitations: [
          'Underlaget innehåller motstridiga värden för samma fakta.',
        ],
        trace,
      };
    }
    if (state === 'error') {
      return {
        ...base,
        state: 'error',
        confidence: 0,
        evidenceIds: [],
        executionStatus: 'failed',
        limitations: [
          'Regeln kunde inte jämföra det importerade värdet med sin tröskel.',
        ],
        trace,
      };
    }

    trace = [
      ...(rule.appliesWhen
        ? buildDecisionTrace(rule.appliesWhen, facts, 'true')
        : []),
      ...buildDecisionTrace(rule.condition, facts, state),
    ];
    const assessment = assessEvidenceForTrace(
      trace,
      rule,
      evidence,
      evaluatedAt,
    );
    addExecutionGuardLimitations(company, rule, trace, assessment.limitations);
    const evidenceIsEnough = assessment.limitations.length === 0;
    const decisiveState =
      state === 'true' ? ('detected' as const) : ('not_detected' as const);
    const proposedState =
      evidenceIsEnough &&
      rule.evaluationMode === 'automated' &&
      ['candidate', 'shadow'].includes(rule.lifecycle)
        ? decisiveState
        : undefined;
    const resultState: ResultState = proposedState
      ? 'needs_review'
      : evidenceIsEnough
        ? decisiveState
        : 'needs_review';

    return {
      ...base,
      state: resultState,
      proposedState,
      executionStatus: evidenceIsEnough ? 'completed' : 'partial',
      confidence: assessment.confidence,
      evidenceIds: assessment.acceptedEvidenceIds,
      acceptedEvidenceIds: assessment.acceptedEvidenceIds,
      rejectedEvidence: assessment.rejectedEvidence,
      limitations: assessment.limitations,
      trace,
    };
  } catch (error) {
    return {
      ...base,
      state: 'error',
      executionStatus: 'failed',
      confidence: 0,
      evidenceIds: [],
      limitations: [error instanceof Error ? error.message : 'Okänt regelfel.'],
      trace,
    };
  }
};

const scoreResults = (results: RuleResult[]): number => {
  const confirmed = results.filter(
    (result) =>
      result.state === 'detected' &&
      result.confidence >= EVALUATION_POLICY.scoring.minimumConfidence &&
      result.ruleLifecycle === 'active' &&
      result.evaluationMode === 'automated',
  );
  const byCategoryAndRoot = new Map<string, number>();
  for (const result of confirmed) {
    const key = `${result.category}:${result.rootCause}`;
    const value = SEVERITY_POINTS[result.severity] * result.confidence;
    byCategoryAndRoot.set(
      key,
      Math.max(byCategoryAndRoot.get(key) ?? 0, value),
    );
  }

  const categoryTotals = new Map<string, number>();
  for (const [key, points] of byCategoryAndRoot) {
    const category = key.slice(
      0,
      key.indexOf(':'),
    ) as keyof typeof CATEGORY_CAPS;
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + points);
  }

  const total = [...categoryTotals].reduce(
    (sum, [category, points]) =>
      sum +
      Math.min(CATEGORY_CAPS[category as keyof typeof CATEGORY_CAPS], points),
    0,
  );
  return Math.min(100, Math.round(total));
};

const companyInputHash = (company: CompanySnapshot): string =>
  stableHash({
    id: company.id,
    name: company.name,
    workplaceUid: company.workplaceUid,
    siteUid: company.siteUid,
    domain: company.domain,
    city: company.city,
    industry: company.industry,
    capturedAt: company.capturedAt,
    tags: company.tags
      ? [...company.tags].sort(unicodeCodePointCompare)
      : undefined,
    municipalityCode: company.municipalityCode,
    gothenburgStatus: company.gothenburgStatus,
    verificationStatus: company.verificationStatus,
    relationshipStatus: company.relationshipStatus,
    relationshipConfidence: company.relationshipConfidence,
    renderFidelity: company.renderFidelity,
    pageCoverage: company.pageCoverage,
    facts: company.facts
      .map((fact) => ({
        ...fact,
        evidenceIds: [...fact.evidenceIds].sort(unicodeCodePointCompare),
      }))
      .sort(
        (left, right) =>
          unicodeCodePointCompare(left.key, right.key) ||
          unicodeCodePointCompare(
            stableStringify(left),
            stableStringify(right),
          ),
      ),
    evidence: company.evidence
      .map((item) => ({
        ...item,
        limitations: item.limitations
          ? [...item.limitations].sort(unicodeCodePointCompare)
          : undefined,
      }))
      .sort((left, right) => unicodeCodePointCompare(left.id, right.id)),
  });

export const auditCompany = (
  company: CompanySnapshot,
  rules: RuleDefinition[] = AUDIT_RULES,
  evaluatedAt = company.capturedAt,
): CompanyAudit => {
  const inputHash = companyInputHash(company);
  const facts = factIndex(company.facts);
  const evidence = new Map(company.evidence.map((item) => [item.id, item]));
  let results = rules.map((rule) =>
    evaluateRule(company, rule, facts, evidence, inputHash, evaluatedAt),
  );

  const blockingRuleIds = new Set<string>(AVAILABILITY_BLOCKER_RULE_IDS);
  const blocker = results.find(
    (result) =>
      blockingRuleIds.has(result.ruleId) &&
      result.executionStatus === 'completed' &&
      (result.state === 'detected' || result.proposedState === 'detected'),
  );
  if (blocker) {
    results = results.map((result) =>
      result.category === 'availability' || result.state === 'not_applicable'
        ? result
        : {
            ...result,
            state: 'not_tested' as const,
            proposedState: undefined,
            confidence: 0,
            evidenceIds: [],
            acceptedEvidenceIds: [],
            rejectedEvidence: result.evidenceIds.map((evidenceId) => ({
              evidenceId,
              reason: `suppressed_by:${blocker.ruleId}`,
            })),
            limitations: [
              `Undertryckt av ${blocker.ruleId}: ${blocker.title}.`,
            ],
            executionStatus: 'blocked' as const,
          },
    );
  }

  results.sort(
    (left, right) =>
      stateOrder[left.state] - stateOrder[right.state] ||
      severityOrder[left.severity] - severityOrder[right.severity] ||
      unicodeCodePointCompare(left.ruleId, right.ruleId),
  );

  const applicable = results.filter(
    (result) => result.state !== 'not_applicable',
  );
  const decisive = applicable.filter(
    (result) => result.state === 'detected' || result.state === 'not_detected',
  );

  return {
    company,
    inputHash,
    results,
    priorityScore: scoreResults(results),
    detectedCount: results.filter((result) => result.state === 'detected')
      .length,
    reviewCount: results.filter((result) => result.state === 'needs_review')
      .length,
    unknownCount: results.filter(
      (result) => result.state === 'not_tested' || result.state === 'error',
    ).length,
    coverage:
      applicable.length === 0
        ? 0
        : Math.round((decisive.length / applicable.length) * 100),
  };
};

export const auditDataset = (
  dataset: AuditDataset,
  evaluatedAt: string,
): CompanyAudit[] =>
  dataset.companies
    .map((company) => auditCompany(company, AUDIT_RULES, evaluatedAt))
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        unicodeCodePointCompare(left.company.name, right.company.name) ||
        unicodeCodePointCompare(left.company.id, right.company.id),
    );

export class DatasetValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? 'Datasetet är ogiltigt.');
    this.name = 'DatasetValidationError';
  }
}

const assertString = (
  value: unknown,
  path: string,
  issues: string[],
  maxLength = 500,
): value is string => {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${path}: måste vara en text som inte är tom.`);
    return false;
  }
  if (value.length > maxLength)
    issues.push(`${path}: överskrider ${maxLength} tecken.`);
  return true;
};

const assertStableIdentifier = (
  value: unknown,
  path: string,
  issues: string[],
  maxLength: number,
): value is string => {
  if (!assertString(value, path, issues, maxLength)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(value)) {
    issues.push(
      `${path}: måste vara ett stabilt ASCII-ID med endast bokstäver, siffror, kolon, punkt, understreck eller bindestreck.`,
    );
    return false;
  }
  return true;
};

const assertPrefixedStableIdentifier = (
  value: unknown,
  prefix: string,
  path: string,
  issues: string[],
  maxLength: number,
): value is string => {
  if (!assertStableIdentifier(value, path, issues, maxLength)) return false;
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    issues.push(
      `${path}: måste börja med ${prefix} och innehålla ett ID efter prefixet.`,
    );
    return false;
  }
  return true;
};

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const inspectJsonStructure = (value: unknown): string[] => {
  const issues: string[] = [];
  let nodeCount = 0;
  const visit = (entry: unknown, path: string, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > EVALUATION_POLICY.serialization.maximumJsonNodes) {
      if (
        !issues.some((issue) =>
          issue.startsWith('dataset: för många JSON-noder'),
        )
      )
        issues.push('dataset: för många JSON-noder.');
      return;
    }
    if (depth > EVALUATION_POLICY.serialization.maximumJsonDepth) {
      issues.push(
        `${path}: JSON-strukturen är djupare än ${EVALUATION_POLICY.serialization.maximumJsonDepth} nivåer.`,
      );
      return;
    }
    if (typeof entry === 'string') {
      if (hasUnpairedSurrogate(entry))
        issues.push(
          `${path}: innehåller ett ogiltigt ensamt UTF-16-surrogat och kan inte representeras entydigt som UTF-8.`,
        );
      return;
    }
    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index += 1)
        visit(entry[index], `${path}[${index}]`, depth + 1);
      return;
    }
    if (isRecord(entry)) {
      for (const key of Object.keys(entry)) {
        if (hasUnpairedSurrogate(key))
          issues.push(
            `${path}: innehåller ett ogiltigt UTF-16-surrogat i ett fältnamn.`,
          );
        visit(entry[key], `${path}.${key}`, depth + 1);
      }
    }
  };
  visit(value, 'dataset', 0);
  return issues;
};

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value).sort(unicodeCodePointCompare)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.${key}: okänt fält.`);
  }
};

export const isValidIsoTimestamp = (value: string): boolean => {
  const isoTimestamp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u;
  const match = isoTimestamp.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = Number(match?.[8] ?? 0);
  const offsetMinute = Number(match?.[9] ?? 0);
  const calendarDayIsValid =
    match !== null &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  return !(
    !calendarDayIsValid ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    !Number.isFinite(Date.parse(value))
  );
};

const assertTimestamp = (
  value: unknown,
  path: string,
  issues: string[],
): value is string => {
  if (!assertString(value, path, issues, 40)) return false;
  if (!isValidIsoTimestamp(value)) {
    issues.push(`${path}: måste vara en giltig ISO-tidpunkt.`);
    return false;
  }
  return true;
};

const assertOptionalString = (
  value: unknown,
  path: string,
  issues: string[],
  maxLength: number,
): value is string | undefined => {
  if (value === undefined) return true;
  if (typeof value !== 'string') {
    issues.push(`${path}: måste vara text när fältet anges.`);
    return false;
  }
  if (value.length > maxLength) {
    issues.push(`${path}: överskrider ${maxLength} tecken.`);
    return false;
  }
  return true;
};

const isFactValue = (value: unknown): value is FactValue => {
  const primitive =
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
  return (
    primitive ||
    (Array.isArray(value) &&
      value.length <= 100 &&
      value.every(isFactValuePrimitive))
  );
};

const isFactValuePrimitive = (value: unknown): value is Primitive =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const isValidDomain = (value: string): boolean => {
  if (value.length > 253 || value !== value.toLowerCase()) return false;
  if (!value.includes('.') || value.endsWith('.') || value.includes('..'))
    return false;
  const labels = value.split('.');
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
  );
};

const isDisallowedIpOrHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  )
    return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [first, second, third] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }

  if (host.includes(':')) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/u.test(host) ||
      host.startsWith('ff') ||
      host.startsWith('2001:db8:') ||
      host.startsWith('::ffff:')
    );
  }
  return false;
};

const isPublicHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return !isDisallowedIpOrHost(parsed.hostname);
  } catch {
    return false;
  }
};

const sourceMatchesDomain = (sourceUrl: string, domain: string): boolean => {
  try {
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
    const normalizedDomain = domain.toLowerCase();
    const withoutWww = (host: string): string =>
      host.startsWith('www.') ? host.slice(4) : host;
    return (
      withoutWww(sourceHost) === withoutWww(normalizedDomain) ||
      sourceHost.endsWith(`.${normalizedDomain}`)
    );
  } catch {
    return false;
  }
};

const isSafeRelativeArtifactPath = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 1_000 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    Array.from(value).some((character) => (character.codePointAt(0) ?? 0) < 32)
  )
    return false;
  const segments = value.replaceAll('\\', '/').split('/');
  return segments.every(
    (segment) =>
      segment !== '' &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.includes(':'),
  );
};

export const computeBatchHash = (input: Record<string, unknown>): string => {
  const { batchHash: _batchHash, ...payload } = input;
  return stableHash(payload);
};

const validateDataset = (input: unknown): AuditDataset => {
  const issues: string[] = [];
  if (!isRecord(input))
    throw new DatasetValidationError(['Roten måste vara ett JSON-objekt.']);
  const structureIssues = inspectJsonStructure(input);
  issues.push(...structureIssues);
  if (
    input.version !== DATASET_VERSION &&
    input.version !== DATASET_VERSION_V2
  ) {
    issues.push(
      `version: förväntade ${DATASET_VERSION} eller ${DATASET_VERSION_V2}.`,
    );
  }
  const isV2 = input.version === DATASET_VERSION_V2;
  if (isV2) {
    assertKnownKeys(
      input,
      [
        'version',
        'name',
        'createdAt',
        'companies',
        'exportId',
        'batchId',
        'rulesetVersion',
        'factRegistryVersion',
        'mappingVersion',
        'datasetHashVersion',
        'datasetHash',
        'evaluationPolicyVersion',
        'evaluationPolicyHash',
        'factHash',
        'ruleHash',
        'datasetHashContractHash',
        'contractManifestHash',
        'batchHashVersion',
        'batchHash',
      ],
      'dataset',
      issues,
    );
    assertPrefixedStableIdentifier(
      input.exportId,
      EVALUATION_POLICY.identifiers.exportIdPrefix,
      'exportId',
      issues,
      120,
    );
    assertPrefixedStableIdentifier(
      input.batchId,
      EVALUATION_POLICY.identifiers.batchIdPrefix,
      'batchId',
      issues,
      120,
    );
    if (input.rulesetVersion !== RULESET_VERSION)
      issues.push(`rulesetVersion: förväntade exakt ${RULESET_VERSION}.`);
    if (input.factRegistryVersion !== FACT_REGISTRY_VERSION)
      issues.push(
        `factRegistryVersion: förväntade exakt ${FACT_REGISTRY_VERSION}.`,
      );
    if (input.mappingVersion !== MAPPING_VERSION)
      issues.push(`mappingVersion: förväntade exakt ${MAPPING_VERSION}.`);
    if (input.datasetHashVersion !== DATASET_HASH_VERSION)
      issues.push(
        `datasetHashVersion: förväntade exakt ${DATASET_HASH_VERSION}.`,
      );
    if (input.evaluationPolicyVersion !== EVALUATION_POLICY_VERSION)
      issues.push(
        `evaluationPolicyVersion: förväntade exakt ${EVALUATION_POLICY_VERSION}.`,
      );
    const evaluationPolicyHashOk =
      assertString(
        input.evaluationPolicyHash,
        'evaluationPolicyHash',
        issues,
        80,
      ) && /^sha256:[a-f0-9]{64}$/u.test(String(input.evaluationPolicyHash));
    if (!evaluationPolicyHashOk)
      issues.push('evaluationPolicyHash: måste vara ett SHA-256-värde.');
    else if (input.evaluationPolicyHash !== EVALUATION_POLICY_HASH)
      issues.push(
        `evaluationPolicyHash: matchar inte den lokala policyn (förväntade ${EVALUATION_POLICY_HASH}).`,
      );
    const exactContractHashes = [
      ['factHash', FACT_HASH],
      ['ruleHash', RULE_HASH],
      ['datasetHashContractHash', DATASET_HASH_CONTRACT_HASH],
      ['contractManifestHash', CONTRACT_MANIFEST_HASH],
    ] as const;
    for (const [field, expected] of exactContractHashes) {
      const value = input[field];
      if (
        !assertString(value, field, issues, 80) ||
        !/^sha256:[a-f0-9]{64}$/u.test(String(value))
      )
        issues.push(`${field}: måste vara ett SHA-256-värde.`);
      else if (value !== expected)
        issues.push(
          `${field}: matchar inte det lokala kontraktet (förväntade ${expected}).`,
        );
    }
    if (input.batchHashVersion !== BATCH_HASH_VERSION)
      issues.push(`batchHashVersion: förväntade exakt ${BATCH_HASH_VERSION}.`);
    if (
      !assertString(input.datasetHash, 'datasetHash', issues, 80) ||
      !/^sha256:[a-f0-9]{64}$/u.test(String(input.datasetHash))
    )
      issues.push('datasetHash: måste vara ett SHA-256-värde.');
    const batchHashOk =
      assertString(input.batchHash, 'batchHash', issues, 80) &&
      /^sha256:[a-f0-9]{64}$/u.test(String(input.batchHash));
    if (!batchHashOk) issues.push('batchHash: måste vara ett SHA-256-värde.');
    else if (structureIssues.length === 0) {
      const computedBatchHash = computeBatchHash(input);
      if (input.batchHash !== computedBatchHash)
        issues.push(
          `batchHash: matchar inte batchens kanoniska innehåll (förväntade ${computedBatchHash}).`,
        );
    }
  }
  assertString(input.name, 'name', issues, 120);
  const createdAtOk = assertTimestamp(input.createdAt, 'createdAt', issues);
  if (!Array.isArray(input.companies)) {
    issues.push('companies: måste vara en lista.');
  } else if (input.companies.length > (isV2 ? MAX_V2_BATCH_COMPANIES : 5_000)) {
    issues.push(
      `companies: högst ${isV2 ? MAX_V2_BATCH_COMPANIES : '5 000'} företag per import.`,
    );
  }

  const companies: CompanySnapshot[] = [];
  const ids = new Set<string>();
  let previousCompanyId: string | undefined;
  for (const [companyIndex, rawCompany] of (Array.isArray(input.companies)
    ? input.companies
    : []
  ).entries()) {
    const path = `companies[${companyIndex}]`;
    if (!isRecord(rawCompany)) {
      issues.push(`${path}: måste vara ett objekt.`);
      continue;
    }
    if (isV2)
      assertKnownKeys(
        rawCompany,
        [
          'id',
          'name',
          'domain',
          'city',
          'industry',
          'capturedAt',
          'facts',
          'evidence',
          'reviews',
          'tags',
          'workplaceUid',
          'siteUid',
          'municipalityCode',
          'gothenburgStatus',
          'verificationStatus',
          'relationshipStatus',
          'relationshipConfidence',
          'renderFidelity',
          'pageCoverage',
        ],
        path,
        issues,
      );
    const idOk = assertStableIdentifier(
      rawCompany.id,
      `${path}.id`,
      issues,
      100,
    );
    const nameOk = assertString(rawCompany.name, `${path}.name`, issues, 200);
    assertOptionalString(rawCompany.city, `${path}.city`, issues, 120);
    assertOptionalString(rawCompany.industry, `${path}.industry`, issues, 200);
    const domainOk = assertString(
      rawCompany.domain,
      `${path}.domain`,
      issues,
      253,
    );
    const capturedOk = assertTimestamp(
      rawCompany.capturedAt,
      `${path}.capturedAt`,
      issues,
    );
    if (
      domainOk &&
      (!isValidDomain(rawCompany.domain as string) ||
        isDisallowedIpOrHost(rawCompany.domain as string))
    )
      issues.push(
        `${path}.domain: måste vara ett normaliserat värdnamn utan protokoll eller sökväg.`,
      );
    if (isV2) {
      if (
        !assertStableIdentifier(
          rawCompany.workplaceUid,
          `${path}.workplaceUid`,
          issues,
          120,
        )
      ) {
        // assertString records the issue.
      } else if (rawCompany.workplaceUid !== rawCompany.id) {
        issues.push(
          `${path}.workplaceUid: måste vara samma stabila ID som company.id.`,
        );
      }
      assertStableIdentifier(
        rawCompany.siteUid,
        `${path}.siteUid`,
        issues,
        120,
      );
      if (
        rawCompany.municipalityCode !==
        EVALUATION_POLICY.identity.municipalityCode
      )
        issues.push(
          `${path}.municipalityCode: måste vara verifierad Göteborgskod 1480.`,
        );
      if (
        rawCompany.gothenburgStatus !==
        EVALUATION_POLICY.identity.gothenburgStatus
      )
        issues.push(`${path}.gothenburgStatus: måste vara verified.`);
      if (
        rawCompany.verificationStatus !==
        EVALUATION_POLICY.identity.verificationStatus
      )
        issues.push(`${path}.verificationStatus: måste vara verified_current.`);
      if (
        !EVALUATION_POLICY.identity.allowedRelationshipStatuses.includes(
          rawCompany.relationshipStatus as
            | 'verified_primary'
            | 'shared_corporate',
        )
      )
        issues.push(
          `${path}.relationshipStatus: verifierad primär eller delad företagsrelation krävs.`,
        );
      if (
        typeof rawCompany.relationshipConfidence !== 'number' ||
        !Number.isFinite(rawCompany.relationshipConfidence) ||
        rawCompany.relationshipConfidence <
          EVALUATION_POLICY.identity.minimumRelationshipConfidence ||
        rawCompany.relationshipConfidence > 1
      )
        issues.push(`${path}.relationshipConfidence: måste vara 0,70–1,00.`);
      if (
        !['full', 'degraded', 'unknown'].includes(
          String(rawCompany.renderFidelity),
        )
      )
        issues.push(`${path}.renderFidelity: okänt värde.`);
      if (!isRecord(rawCompany.pageCoverage)) {
        issues.push(`${path}.pageCoverage: måste anges i V2.`);
      } else {
        const coverage = rawCompany.pageCoverage;
        assertKnownKeys(
          coverage,
          ['eligiblePages', 'testedPages', 'excludedPages'],
          `${path}.pageCoverage`,
          issues,
        );
        for (const key of ['eligiblePages', 'testedPages', 'excludedPages']) {
          const value = coverage[key];
          if (!Number.isInteger(value) || Number(value) < 0)
            issues.push(
              `${path}.pageCoverage.${key}: måste vara ett icke-negativt heltal.`,
            );
        }
        if (
          Number.isInteger(coverage.eligiblePages) &&
          Number.isInteger(coverage.testedPages) &&
          Number(coverage.testedPages) > Number(coverage.eligiblePages)
        )
          issues.push(
            `${path}.pageCoverage.testedPages: kan inte överstiga eligiblePages.`,
          );
      }
    }
    if (
      capturedOk &&
      createdAtOk &&
      Date.parse(rawCompany.capturedAt as string) >
        Date.parse(input.createdAt as string) +
          EVALUATION_POLICY.evidence.maximumFutureSkewMinutes * 60_000
    )
      issues.push(`${path}.capturedAt: ligger efter datasetets createdAt.`);
    if (idOk && ids.has(rawCompany.id as string))
      issues.push(`${path}.id: dubblett-ID.`);
    if (idOk) {
      const id = rawCompany.id as string;
      if (
        isV2 &&
        previousCompanyId !== undefined &&
        unicodeCodePointCompare(previousCompanyId, id) >= 0
      )
        issues.push(
          `${path}.id: V2-företag måste vara unika och sorterade efter id i Unicode-kodpunktsordning.`,
        );
      previousCompanyId = id;
      ids.add(id);
    }

    if (
      rawCompany.tags !== undefined &&
      (!Array.isArray(rawCompany.tags) ||
        rawCompany.tags.length > 50 ||
        !rawCompany.tags.every(
          (tag) => typeof tag === 'string' && tag.length <= 100,
        ))
    )
      issues.push(
        `${path}.tags: måste vara en lista med högst 50 texter à 100 tecken.`,
      );
    if (
      rawCompany.reviews !== undefined &&
      (!Array.isArray(rawCompany.reviews) || rawCompany.reviews.length > 0)
    )
      issues.push(
        `${path}.reviews: importerade granskningsbeslut är inte tillåtna.`,
      );

    if (!Array.isArray(rawCompany.facts) || rawCompany.facts.length > 500) {
      issues.push(`${path}.facts: måste vara en lista med högst 500 fakta.`);
    }
    if (
      !Array.isArray(rawCompany.evidence) ||
      rawCompany.evidence.length > 500
    ) {
      issues.push(
        `${path}.evidence: måste vara en lista med högst 500 evidensposter.`,
      );
    }

    const evidence: EvidenceItem[] = [];
    const evidenceIds = new Set<string>();
    const sourceByPageId = new Map<string, string>();
    const pageIdBySource = new Map<string, string>();
    for (const [evidenceIndex, rawEvidence] of (Array.isArray(
      rawCompany.evidence,
    )
      ? rawCompany.evidence
      : []
    ).entries()) {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (!isRecord(rawEvidence)) {
        issues.push(`${evidencePath}: måste vara ett objekt.`);
        continue;
      }
      if (isV2)
        assertKnownKeys(
          rawEvidence,
          [
            'id',
            'method',
            'label',
            'observedAt',
            'strength',
            'locator',
            'note',
            'sourceUrl',
            'pageId',
            'artifactPath',
            'artifactSha256',
            'collector',
            'collectorVersion',
            'actor',
            'viewport',
            'locale',
            'pageType',
            'testScenario',
            'cookieConsentState',
            'scope',
            'limitations',
            'retentionClass',
          ],
          evidencePath,
          issues,
        );
      const evidenceIdOk = assertStableIdentifier(
        rawEvidence.id,
        `${evidencePath}.id`,
        issues,
        120,
      );
      const labelOk = assertString(
        rawEvidence.label,
        `${evidencePath}.label`,
        issues,
        300,
      );
      const observedOk = assertTimestamp(
        rawEvidence.observedAt,
        `${evidencePath}.observedAt`,
        issues,
      );
      const locatorOk = assertOptionalString(
        rawEvidence.locator,
        `${evidencePath}.locator`,
        issues,
        1_000,
      );
      const noteOk = assertOptionalString(
        rawEvidence.note,
        `${evidencePath}.note`,
        issues,
        2_000,
      );
      let sourceUrlOk = true;
      let pageIdOk = true;
      let collectorOk = true;
      let collectorVersionOk = true;
      let actorOk = true;
      let scopeOk = true;
      let artifactOk = true;
      let optionalProvenanceOk = true;
      if (isV2) {
        sourceUrlOk = assertString(
          rawEvidence.sourceUrl,
          `${evidencePath}.sourceUrl`,
          issues,
          2_000,
        );
        if (sourceUrlOk && !isPublicHttpUrl(rawEvidence.sourceUrl as string)) {
          issues.push(
            `${evidencePath}.sourceUrl: måste vara en publik HTTP(S)-URL utan inloggningsuppgifter.`,
          );
          sourceUrlOk = false;
        }
        if (
          sourceUrlOk &&
          domainOk &&
          !sourceMatchesDomain(
            rawEvidence.sourceUrl as string,
            rawCompany.domain as string,
          )
        ) {
          issues.push(
            `${evidencePath}.sourceUrl: värdnamnet måste tillhöra företagets verifierade domän.`,
          );
          sourceUrlOk = false;
        }
        pageIdOk = assertString(
          rawEvidence.pageId,
          `${evidencePath}.pageId`,
          issues,
          160,
        );
        if (
          pageIdOk &&
          !/^PAGE:[A-Za-z0-9][A-Za-z0-9:._-]{2,154}$/u.test(
            rawEvidence.pageId as string,
          )
        ) {
          issues.push(
            `${evidencePath}.pageId: måste vara ett stabilt PAGE:-ID.`,
          );
          pageIdOk = false;
        }
        collectorOk = assertString(
          rawEvidence.collector,
          `${evidencePath}.collector`,
          issues,
          120,
        );
        collectorVersionOk = assertString(
          rawEvidence.collectorVersion,
          `${evidencePath}.collectorVersion`,
          issues,
          80,
        );
        actorOk = ['human', 'tool'].includes(String(rawEvidence.actor));
        if (!actorOk)
          issues.push(
            `${evidencePath}.actor: V2 tillåter endast human eller tool; AI-genererad evidens är inte verifierbar observation.`,
          );
        scopeOk = assertString(
          rawEvidence.scope,
          `${evidencePath}.scope`,
          issues,
          300,
        );
        if (
          scopeOk &&
          !V2_EVIDENCE_SCOPES.includes(
            rawEvidence.scope as (typeof V2_EVIDENCE_SCOPES)[number],
          )
        ) {
          issues.push(`${evidencePath}.scope: okänt evidensscope.`);
          scopeOk = false;
        }
        if (rawEvidence.artifactPath !== undefined) {
          artifactOk = isSafeRelativeArtifactPath(rawEvidence.artifactPath);
          if (!artifactOk)
            issues.push(
              `${evidencePath}.artifactPath: måste vara en säker relativ artefaktsökväg utan traversal.`,
            );
          if (
            !/^sha256:[a-f0-9]{64}$/u.test(String(rawEvidence.artifactSha256))
          ) {
            issues.push(
              `${evidencePath}.artifactSha256: krävs och måste vara SHA-256 när artifactPath anges.`,
            );
            artifactOk = false;
          }
        } else if (rawEvidence.artifactSha256 !== undefined) {
          issues.push(
            `${evidencePath}.artifactPath: krävs när artifactSha256 anges.`,
          );
          artifactOk = false;
        }
        for (const [key, maxLength] of [
          ['viewport', 120],
          ['locale', 40],
          ['pageType', 120],
          ['testScenario', 200],
          ['cookieConsentState', 120],
        ] as const) {
          if (
            !assertOptionalString(
              rawEvidence[key],
              `${evidencePath}.${key}`,
              issues,
              maxLength,
            )
          )
            optionalProvenanceOk = false;
        }
        if (
          rawEvidence.retentionClass !== undefined &&
          (typeof rawEvidence.retentionClass !== 'string' ||
            !['ephemeral', 'audit', 'policy'].includes(
              rawEvidence.retentionClass,
            ))
        ) {
          issues.push(`${evidencePath}.retentionClass: okänt värde.`);
          optionalProvenanceOk = false;
        }
        if (
          rawEvidence.limitations !== undefined &&
          (!Array.isArray(rawEvidence.limitations) ||
            rawEvidence.limitations.length > 50 ||
            !rawEvidence.limitations.every(
              (entry) =>
                typeof entry === 'string' &&
                entry.trim() !== '' &&
                entry.length <= 500,
            ))
        )
          issues.push(
            `${evidencePath}.limitations: måste vara högst 50 icke-tomma texter à 500 tecken.`,
          );
      }
      if (
        observedOk &&
        createdAtOk &&
        Date.parse(rawEvidence.observedAt as string) >
          Date.parse(input.createdAt as string) +
            EVALUATION_POLICY.evidence.maximumFutureSkewMinutes * 60_000
      )
        issues.push(
          `${evidencePath}.observedAt: ligger efter datasetets createdAt.`,
        );
      const methods = [
        'manual',
        'html',
        'headers',
        'lighthouse',
        'monitoring',
        'accessibility-audit',
        'browser-test',
        'screenshot',
        'business-profile',
        'structured-data',
        'link-check',
        'form-test',
        'other',
      ];
      const strengths = ['strong', 'medium', 'weak'];
      const methodOk = methods.includes(String(rawEvidence.method));
      const strengthOk = strengths.includes(String(rawEvidence.strength));
      if (!methodOk) issues.push(`${evidencePath}.method: okänd metod.`);
      if (!strengthOk) issues.push(`${evidencePath}.strength: okänd styrka.`);
      let collectorPolicyOk = true;
      if (isV2 && collectorOk && actorOk && methodOk) {
        const policy = V2_COLLECTOR_POLICIES[String(rawEvidence.collector)];
        collectorPolicyOk =
          policy !== undefined &&
          policy.actor === rawEvidence.actor &&
          policy.methods.includes(rawEvidence.method as EvidenceItem['method']);
        if (!collectorPolicyOk)
          issues.push(
            `${evidencePath}.collector: okänd eller otillåten kombination av collector, actor och method.`,
          );
      }
      if (isV2 && pageIdOk && sourceUrlOk) {
        const pageId = rawEvidence.pageId as string;
        const sourceUrl = new URL(rawEvidence.sourceUrl as string).href;
        const previousSource = sourceByPageId.get(pageId);
        const previousPageId = pageIdBySource.get(sourceUrl);
        if (previousSource && previousSource !== sourceUrl) {
          issues.push(
            `${evidencePath}.pageId: samma pageId får inte peka på flera URL:er.`,
          );
          pageIdOk = false;
        } else if (previousPageId && previousPageId !== pageId) {
          issues.push(
            `${evidencePath}.sourceUrl: samma normaliserade URL får inte ha flera pageId.`,
          );
          sourceUrlOk = false;
        } else {
          sourceByPageId.set(pageId, sourceUrl);
          pageIdBySource.set(sourceUrl, pageId);
        }
      }
      if (evidenceIdOk && evidenceIds.has(rawEvidence.id as string))
        issues.push(`${evidencePath}.id: dubblett-ID.`);
      if (evidenceIdOk) evidenceIds.add(rawEvidence.id as string);
      if (
        evidenceIdOk &&
        labelOk &&
        observedOk &&
        locatorOk &&
        noteOk &&
        sourceUrlOk &&
        pageIdOk &&
        collectorOk &&
        collectorVersionOk &&
        actorOk &&
        scopeOk &&
        artifactOk &&
        optionalProvenanceOk &&
        collectorPolicyOk &&
        methodOk &&
        strengthOk
      )
        evidence.push({
          id: rawEvidence.id as string,
          method: rawEvidence.method as EvidenceItem['method'],
          label: rawEvidence.label as string,
          observedAt: rawEvidence.observedAt as string,
          strength: rawEvidence.strength as EvidenceItem['strength'],
          locator:
            typeof rawEvidence.locator === 'string'
              ? rawEvidence.locator
              : undefined,
          note:
            typeof rawEvidence.note === 'string' ? rawEvidence.note : undefined,
          sourceUrl:
            typeof rawEvidence.sourceUrl === 'string'
              ? rawEvidence.sourceUrl
              : undefined,
          pageId:
            typeof rawEvidence.pageId === 'string'
              ? rawEvidence.pageId
              : undefined,
          artifactPath:
            typeof rawEvidence.artifactPath === 'string'
              ? rawEvidence.artifactPath
              : undefined,
          artifactSha256:
            typeof rawEvidence.artifactSha256 === 'string'
              ? rawEvidence.artifactSha256
              : undefined,
          collector:
            typeof rawEvidence.collector === 'string'
              ? rawEvidence.collector
              : undefined,
          collectorVersion:
            typeof rawEvidence.collectorVersion === 'string'
              ? rawEvidence.collectorVersion
              : undefined,
          actor: ['human', 'tool', 'ai'].includes(String(rawEvidence.actor))
            ? (rawEvidence.actor as EvidenceItem['actor'])
            : undefined,
          viewport:
            typeof rawEvidence.viewport === 'string'
              ? rawEvidence.viewport
              : undefined,
          locale:
            typeof rawEvidence.locale === 'string'
              ? rawEvidence.locale
              : undefined,
          pageType:
            typeof rawEvidence.pageType === 'string'
              ? rawEvidence.pageType
              : undefined,
          testScenario:
            typeof rawEvidence.testScenario === 'string'
              ? rawEvidence.testScenario
              : undefined,
          cookieConsentState:
            typeof rawEvidence.cookieConsentState === 'string'
              ? rawEvidence.cookieConsentState
              : undefined,
          scope:
            typeof rawEvidence.scope === 'string'
              ? rawEvidence.scope
              : undefined,
          limitations: Array.isArray(rawEvidence.limitations)
            ? rawEvidence.limitations.filter(
                (entry): entry is string => typeof entry === 'string',
              )
            : undefined,
          retentionClass: ['ephemeral', 'audit', 'policy'].includes(
            String(rawEvidence.retentionClass),
          )
            ? (rawEvidence.retentionClass as EvidenceItem['retentionClass'])
            : undefined,
        });
    }

    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const facts: AuditFact[] = [];
    for (const [factIndexValue, rawFact] of (Array.isArray(rawCompany.facts)
      ? rawCompany.facts
      : []
    ).entries()) {
      const factPath = `${path}.facts[${factIndexValue}]`;
      if (!isRecord(rawFact)) {
        issues.push(`${factPath}: måste vara ett objekt.`);
        continue;
      }
      if (isV2)
        assertKnownKeys(
          rawFact,
          ['key', 'value', 'evidenceIds', 'observedAt'],
          factPath,
          issues,
        );
      const keyOk = assertString(rawFact.key, `${factPath}.key`, issues, 160);
      let registryDefinition = keyOk
        ? FACT_REGISTRY.get(rawFact.key as string)
        : undefined;
      if (!isFactValue(rawFact.value))
        issues.push(`${factPath}.value: otillåten typ eller för stor lista.`);
      if (keyOk && isFactValue(rawFact.value)) {
        const registryIssue = validateFact({
          key: rawFact.key as string,
          value: rawFact.value,
          evidenceIds: [],
        });
        if (registryIssue) issues.push(`${factPath}.value: ${registryIssue}`);
        if (registryIssue) registryDefinition = undefined;
      }
      if (
        !Array.isArray(rawFact.evidenceIds) ||
        !rawFact.evidenceIds.every((id) => typeof id === 'string')
      ) {
        issues.push(
          `${factPath}.evidenceIds: måste vara en lista med text-ID:n.`,
        );
      } else {
        if (new Set(rawFact.evidenceIds).size !== rawFact.evidenceIds.length)
          issues.push(
            `${factPath}.evidenceIds: får inte innehålla dubbletter.`,
          );
        if (
          isV2 &&
          registryDefinition &&
          rawFact.evidenceIds.length < registryDefinition.minimumEvidence
        )
          issues.push(
            `${factPath}.evidenceIds: kräver minst ${registryDefinition.minimumEvidence} evidenspost.`,
          );
        for (const evidenceId of rawFact.evidenceIds) {
          if (!evidenceIds.has(evidenceId))
            issues.push(`${factPath}.evidenceIds: ${evidenceId} saknas.`);
          if (isV2 && registryDefinition) {
            const referencedEvidence = evidenceById.get(evidenceId);
            if (!referencedEvidence) continue;
            const scopesByFactScope: Record<
              typeof registryDefinition.scope,
              string[]
            > = {
              page: ['observed-page'],
              site: ['observed-page', 'site'],
              business: ['business'],
              run: ['run', 'site'],
            };
            if (
              !scopesByFactScope[registryDefinition.scope].includes(
                referencedEvidence.scope ?? '',
              )
            )
              issues.push(
                `${factPath}.evidenceIds: ${evidenceId} har scope ${referencedEvidence.scope ?? 'missing'} men ${registryDefinition.scope} krävs.`,
              );
            if (
              !registryDefinition.allowedMethods.includes(
                referencedEvidence.method,
              )
            )
              issues.push(
                `${factPath}.evidenceIds: ${evidenceId} använder metoden ${referencedEvidence.method}, som inte är tillåten för faktan.`,
              );
            if (
              referencedEvidence.actor &&
              (referencedEvidence.actor === 'ai' ||
                !registryDefinition.allowedActors.includes(
                  referencedEvidence.actor,
                ))
            )
              issues.push(
                `${factPath}.evidenceIds: ${evidenceId} använder en otillåten aktör.`,
              );
          }
        }
      }
      const factObservedAtOk =
        rawFact.observedAt === undefined ||
        assertTimestamp(rawFact.observedAt, `${factPath}.observedAt`, issues);
      if (
        factObservedAtOk &&
        typeof rawFact.observedAt === 'string' &&
        createdAtOk &&
        Date.parse(rawFact.observedAt) >
          Date.parse(input.createdAt as string) +
            EVALUATION_POLICY.evidence.maximumFutureSkewMinutes * 60_000
      )
        issues.push(
          `${factPath}.observedAt: ligger efter datasetets createdAt.`,
        );
      if (
        keyOk &&
        isFactValue(rawFact.value) &&
        Array.isArray(rawFact.evidenceIds) &&
        factObservedAtOk
      ) {
        facts.push({
          key: rawFact.key as string,
          value: rawFact.value as FactValue,
          evidenceIds: rawFact.evidenceIds as string[],
          observedAt:
            typeof rawFact.observedAt === 'string'
              ? rawFact.observedAt
              : undefined,
        });
      }
    }

    if (isV2) {
      const uniqueValue = (key: string): FactValue | undefined => {
        const values = facts
          .filter((fact) => fact.key === key)
          .map((fact) => fact.value);
        return new Set(values.map(stableStringify)).size === 1
          ? values[0]
          : undefined;
      };
      const contradictions: Array<{
        when: boolean;
        message: string;
      }> = [
        {
          when:
            uniqueValue('seo.title_present') === false &&
            Number(uniqueValue('seo.title_length') ?? 0) > 0,
          message:
            'seo.title_present=false motsäger ett positivt seo.title_length.',
        },
        {
          when:
            uniqueValue('seo.meta_description_present') === false &&
            Number(uniqueValue('seo.meta_description_length') ?? 0) > 0,
          message:
            'seo.meta_description_present=false motsäger ett positivt seo.meta_description_length.',
        },
        {
          when:
            uniqueValue('conversion.primary_cta_present') === false &&
            uniqueValue('conversion.primary_cta_above_fold') === true,
          message:
            'conversion.primary_cta_present=false motsäger primary_cta_above_fold=true.',
        },
        {
          when:
            uniqueValue('conversion.primary_cta_present') === false &&
            uniqueValue('conversion.cta_copy_clear') === true,
          message:
            'conversion.primary_cta_present=false motsäger cta_copy_clear=true.',
        },
        {
          when:
            uniqueValue('conversion.primary_cta_present') === false &&
            Number(uniqueValue('conversion.primary_cta_variant_count') ?? 0) >
              0,
          message:
            'conversion.primary_cta_present=false motsäger ett positivt primary_cta_variant_count.',
        },
        {
          when:
            uniqueValue('crawl.sitemap_present') === false &&
            uniqueValue('crawl.sitemap_valid') === true,
          message: 'crawl.sitemap_present=false motsäger sitemap_valid=true.',
        },
        {
          when:
            uniqueValue('crawl.home_canonical_present') === false &&
            Number(uniqueValue('crawl.home_canonical_count') ?? 0) > 0,
          message:
            'crawl.home_canonical_present=false motsäger ett positivt home_canonical_count.',
        },
        {
          when:
            uniqueValue('availability.reachable') === false &&
            uniqueValue('availability.http_status') !== undefined,
          message:
            'availability.reachable=false motsäger ett observerat HTTP-statusvärde.',
        },
      ];
      for (const contradiction of contradictions) {
        if (contradiction.when)
          issues.push(`${path}.facts: ${contradiction.message}`);
      }
    }

    if (idOk && nameOk && domainOk && capturedOk) {
      companies.push({
        id: rawCompany.id as string,
        name: rawCompany.name as string,
        domain: rawCompany.domain as string,
        city: typeof rawCompany.city === 'string' ? rawCompany.city : undefined,
        industry:
          typeof rawCompany.industry === 'string'
            ? rawCompany.industry
            : undefined,
        capturedAt: rawCompany.capturedAt as string,
        facts,
        evidence,
        tags: Array.isArray(rawCompany.tags)
          ? rawCompany.tags.filter(
              (tag): tag is string => typeof tag === 'string',
            )
          : undefined,
        workplaceUid:
          typeof rawCompany.workplaceUid === 'string'
            ? rawCompany.workplaceUid
            : undefined,
        siteUid:
          typeof rawCompany.siteUid === 'string'
            ? rawCompany.siteUid
            : undefined,
        municipalityCode:
          typeof rawCompany.municipalityCode === 'string'
            ? rawCompany.municipalityCode
            : undefined,
        gothenburgStatus: ['verified', 'unresolved', 'excluded'].includes(
          String(rawCompany.gothenburgStatus),
        )
          ? (rawCompany.gothenburgStatus as CompanySnapshot['gothenburgStatus'])
          : undefined,
        verificationStatus: [
          'verified_current',
          'partial',
          'unresolved',
          'blocked',
        ].includes(String(rawCompany.verificationStatus))
          ? (rawCompany.verificationStatus as CompanySnapshot['verificationStatus'])
          : undefined,
        relationshipStatus: [
          'verified_primary',
          'shared_corporate',
          'probable_primary',
          'platform_only',
          'unresolved',
        ].includes(String(rawCompany.relationshipStatus))
          ? (rawCompany.relationshipStatus as CompanySnapshot['relationshipStatus'])
          : undefined,
        relationshipConfidence:
          typeof rawCompany.relationshipConfidence === 'number'
            ? rawCompany.relationshipConfidence
            : undefined,
        renderFidelity: ['full', 'degraded', 'unknown'].includes(
          String(rawCompany.renderFidelity),
        )
          ? (rawCompany.renderFidelity as CompanySnapshot['renderFidelity'])
          : undefined,
        pageCoverage: isRecord(rawCompany.pageCoverage)
          ? {
              eligiblePages: Number(rawCompany.pageCoverage.eligiblePages),
              testedPages: Number(rawCompany.pageCoverage.testedPages),
              excludedPages: Number(rawCompany.pageCoverage.excludedPages),
            }
          : undefined,
        reviews: [],
      });
    }
  }

  if (issues.length > 0) throw new DatasetValidationError(issues.slice(0, 50));
  const dataset: AuditDataset = {
    version: input.version as AuditDataset['version'],
    name: input.name as string,
    createdAt: input.createdAt as string,
    companies,
    exportId: typeof input.exportId === 'string' ? input.exportId : undefined,
    batchId: typeof input.batchId === 'string' ? input.batchId : undefined,
    rulesetVersion:
      typeof input.rulesetVersion === 'string'
        ? input.rulesetVersion
        : undefined,
    factRegistryVersion:
      typeof input.factRegistryVersion === 'string'
        ? input.factRegistryVersion
        : undefined,
    mappingVersion:
      typeof input.mappingVersion === 'string'
        ? input.mappingVersion
        : undefined,
    datasetHashVersion:
      typeof input.datasetHashVersion === 'string'
        ? input.datasetHashVersion
        : undefined,
    datasetHash:
      typeof input.datasetHash === 'string' ? input.datasetHash : undefined,
    evaluationPolicyVersion:
      typeof input.evaluationPolicyVersion === 'string'
        ? input.evaluationPolicyVersion
        : undefined,
    evaluationPolicyHash:
      typeof input.evaluationPolicyHash === 'string'
        ? input.evaluationPolicyHash
        : undefined,
    factHash: typeof input.factHash === 'string' ? input.factHash : undefined,
    ruleHash: typeof input.ruleHash === 'string' ? input.ruleHash : undefined,
    datasetHashContractHash:
      typeof input.datasetHashContractHash === 'string'
        ? input.datasetHashContractHash
        : undefined,
    contractManifestHash:
      typeof input.contractManifestHash === 'string'
        ? input.contractManifestHash
        : undefined,
    batchHashVersion:
      typeof input.batchHashVersion === 'string'
        ? input.batchHashVersion
        : undefined,
    batchHash:
      typeof input.batchHash === 'string' ? input.batchHash : undefined,
  };
  if (isV2) {
    verifiedV2BatchSnapshots.set(dataset, stableHash(dataset));
    verifiedV2BatchTransports.set(dataset, JSON.stringify(input));
  }
  return dataset;
};

export const parseDatasetJson = (json: string): AuditDataset => {
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > MAX_V2_BATCH_BYTES) {
    throw new DatasetValidationError([
      `Filen är ${byteLength.toLocaleString('sv-SE')} UTF-8-byte och överskrider gränsen ${MAX_V2_BATCH_BYTES.toLocaleString('sv-SE')}. Dela upp importen.`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DatasetValidationError([
      `JSON kunde inte tolkas: ${error instanceof Error ? error.message : 'okänt fel'}`,
    ]);
  }
  return validateDataset(parsed);
};

/**
 * Serialize a dataset without rewriting the sealed V2 transport representation.
 * Evaluation normalization and its historical input/result hashes stay intact.
 * An altered parser-returned object cannot silently recover its old source bytes.
 * Unattested objects must independently pass the existing parser; missing fields
 * are never guessed and a batchHash is never recomputed here.
 */
export const serializeDatasetJson = (dataset: AuditDataset): string => {
  const transport = verifiedV2BatchTransports.get(dataset);
  if (transport !== undefined) {
    if (!isVerifiedV2BatchContract(dataset))
      throw new DatasetValidationError([
        'Det parserverifierade datasetet har ändrats och får inte serialiseras som sin tidigare förseglade batch.',
      ]);
    return transport;
  }
  const json = JSON.stringify(dataset);
  parseDatasetJson(json);
  return json;
};
