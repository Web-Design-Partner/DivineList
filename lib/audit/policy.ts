import {
  BATCH_HASH_VERSION,
  DATASET_HASH_VERSION,
  DATASET_VERSION_V2,
  DEFAULT_V2_BATCH_COMPANIES,
  EVALUATION_POLICY_VERSION,
  FACT_REGISTRY_VERSION,
  MAPPING_VERSION,
  MAX_V2_BATCH_BYTES,
  MAX_V2_BATCH_COMPANIES,
  RESULT_HASH_VERSION,
  RESULT_VERSION,
  REVIEW_DECISION_VERSION,
  RULESET_VERSION,
  type EvidenceActor,
  type EvidenceMethod,
  type EvidenceStrength,
  type RuleCategory,
  type Severity,
} from './types';

export const V2_EVIDENCE_SCOPES = [
  'observed-page',
  'site',
  'business',
  'run',
] as const;

export const V2_COLLECTOR_POLICIES: Readonly<
  Record<
    string,
    {
      readonly actor: EvidenceActor;
      readonly methods: readonly EvidenceMethod[];
    }
  >
> = {
  'safe-crawler': {
    actor: 'tool',
    methods: [
      'html',
      'headers',
      'lighthouse',
      'monitoring',
      'browser-test',
      'screenshot',
      'structured-data',
      'link-check',
    ],
  },
  axe: { actor: 'tool', methods: ['accessibility-audit'] },
  'manual-review': {
    actor: 'human',
    methods: ['manual', 'screenshot', 'business-profile'],
  },
};

export const EVIDENCE_STRENGTH_SCORES = {
  strong: 0.94,
  medium: 0.76,
  weak: 0.5,
} as const satisfies Record<EvidenceStrength, number>;

export const EVIDENCE_METHOD_CONFIDENCE_CAPS = {
  html: 0.94,
  headers: 0.94,
  lighthouse: 0.94,
  monitoring: 0.94,
  'accessibility-audit': 0.94,
  'browser-test': 0.9,
  'structured-data': 0.94,
  'link-check': 0.9,
  'form-test': 0.9,
  screenshot: 0.76,
  'business-profile': 0.76,
  manual: 0.76,
  other: 0.5,
} as const satisfies Record<EvidenceMethod, number>;

export const RENDER_DEPENDENT_METHODS = [
  'html',
  'lighthouse',
  'accessibility-audit',
  'browser-test',
  'screenshot',
  'structured-data',
  'form-test',
] as const satisfies readonly EvidenceMethod[];

export const SITE_COVERAGE_FACT_PREFIXES = [
  'crawl.',
  'content.',
  'operations.',
  'seo.',
] as const;

export const AVAILABILITY_BLOCKER_RULE_IDS = [
  'AVL-001',
  'AVL-002',
  'AVL-003',
  'AVL-007',
] as const;

export const SEVERITY_POINTS = {
  critical: 20,
  high: 13,
  medium: 7,
  low: 3,
  info: 0,
} as const satisfies Record<Severity, number>;

export const CATEGORY_CAPS = {
  availability: 20,
  crawlability: 10,
  performance: 10,
  mobile: 10,
  accessibility: 15,
  'onpage-seo': 8,
  'local-seo': 10,
  conversion: 20,
  'content-trust': 8,
  'forms-commerce': 20,
  'privacy-security': 10,
  operations: 8,
} as const satisfies Record<RuleCategory, number>;

/**
 * The complete, JSON-serializable policy that governs V2 evaluation. Its hash
 * is the trust anchor carried by every accepted batch and result envelope.
 * Never add a self-hash to this object: evaluationPolicyHash is SHA-256 over
 * canonical JSON of this object exactly as exported here.
 */
export const EVALUATION_POLICY = {
  version: EVALUATION_POLICY_VERSION,
  exactVersions: {
    datasetVersion: DATASET_VERSION_V2,
    datasetHashVersion: DATASET_HASH_VERSION,
    factRegistryVersion: FACT_REGISTRY_VERSION,
    rulesetVersion: RULESET_VERSION,
    mappingVersion: MAPPING_VERSION,
    batchHashVersion: BATCH_HASH_VERSION,
    resultHashVersion: RESULT_HASH_VERSION,
    resultVersion: RESULT_VERSION,
    reviewDecisionVersion: REVIEW_DECISION_VERSION,
  },
  batchLimits: {
    recommendedCompanies: DEFAULT_V2_BATCH_COMPANIES,
    companies: MAX_V2_BATCH_COMPANIES,
    utf8Bytes: MAX_V2_BATCH_BYTES,
  },
  resultLimits: {
    utf8Bytes: 64_000_000,
  },
  serialization: {
    encoding: 'strict-utf-8',
    unicode: 'unicode-scalars-only-no-unpaired-surrogates',
    maximumJsonDepth: 32,
    maximumJsonNodes: 1_000_000,
    objectKeyOrdering: 'unicode-code-point-order',
  },
  identifiers: {
    stableAsciiPattern: '^[A-Za-z0-9][A-Za-z0-9:._-]*$',
    exportIdPrefix: 'EXP:',
    batchIdPrefix: 'BAT:',
    companyAndEvidencePrefixes: 'preserve-exporter-assigned-prefixes',
  },
  contractBindings: {
    requiredBatchFields: [
      'factHash',
      'ruleHash',
      'datasetHashContractHash',
      'contractManifestHash',
    ],
    exactLocalMatchRequired: true,
  },
  datasetHash: {
    version: DATASET_HASH_VERSION,
    algorithm: 'sha256',
    canonicalization: 'recursive-key-sort-json',
    payload: {
      orderedFields: [
        'version',
        'name',
        'createdAt',
        'datasetHashVersion',
        'factRegistryVersion',
        'rulesetVersion',
        'mappingVersion',
        'evaluationPolicyVersion',
        'evaluationPolicyHash',
        'factHash',
        'ruleHash',
        'datasetHashContractHash',
        'contractManifestHash',
        'companies',
      ],
      companies: 'complete-export-sorted-by-id-code-point-order',
      excludes: [
        'exportId',
        'datasetHash',
        'batchId',
        'batchHashVersion',
        'batchHash',
      ],
    },
    independentlyVerifiableFromSingleBatch: false,
  },
  batchHash: {
    version: BATCH_HASH_VERSION,
    algorithm: 'sha256',
    canonicalization: 'recursive-key-sort-json',
    excludes: ['batchHash'],
    binds: [
      'datasetHashVersion',
      'datasetHash',
      'evaluationPolicyVersion',
      'evaluationPolicyHash',
      'factHash',
      'ruleHash',
      'datasetHashContractHash',
      'contractManifestHash',
    ],
  },
  resultHash: {
    version: RESULT_HASH_VERSION,
    algorithm: 'sha256',
    canonicalization: 'recursive-key-sort-json',
    excludes: ['resultHash'],
    binds: [
      'datasetHashVersion',
      'datasetHash',
      'evaluationPolicyVersion',
      'evaluationPolicyHash',
      'batchHashVersion',
      'batchHash',
      'factHash',
      'ruleHash',
      'datasetHashContractHash',
      'contractManifestHash',
    ],
  },
  inputHash: {
    algorithm: 'sha256',
    canonicalization: 'recursive-key-sort-json',
    payload: {
      companySnapshot: 'complete-normalized-company-snapshot',
      fields: [
        'id',
        'name',
        'domain',
        'city',
        'industry',
        'capturedAt',
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
        'facts',
        'evidence',
      ],
      excludes: ['reviews'],
      ordering: {
        tags: 'unicode-code-point-order',
        facts: 'fact-key-then-canonical-json-code-point-order',
        factEvidenceIds: 'unicode-code-point-order',
        evidence: 'evidence-id-code-point-order',
        evidenceLimitations: 'unicode-code-point-order',
      },
    },
  },
  evidence: {
    scopes: V2_EVIDENCE_SCOPES,
    collectors: V2_COLLECTOR_POLICIES,
    aiActorAllowed: false,
    sourceMustMatchCompanyDomain: true,
    safeRelativeArtifactPathsOnly: true,
    strengthScores: EVIDENCE_STRENGTH_SCORES,
    methodConfidenceCaps: EVIDENCE_METHOD_CONFIDENCE_CAPS,
    minimumConfidence: 0.7,
    maximumFutureSkewMinutes: 5,
  },
  identity: {
    municipalityCode: '1480',
    gothenburgStatus: 'verified',
    verificationStatus: 'verified_current',
    allowedRelationshipStatuses: ['verified_primary', 'shared_corporate'],
    minimumRelationshipConfidence: 0.7,
  },
  execution: {
    renderDependentMethods: RENDER_DEPENDENT_METHODS,
    siteCoverageFactPrefixes: SITE_COVERAGE_FACT_PREFIXES,
    availabilityBlockerRuleIds: AVAILABILITY_BLOCKER_RULE_IDS,
    blockedOrFailedMayPropose: false,
  },
  scoring: {
    severityPoints: SEVERITY_POINTS,
    categoryCaps: CATEGORY_CAPS,
    minimumConfidence: 0.7,
    onlyActiveAutomatedDetected: true,
    correlateByCategoryAndRootCause: true,
  },
  decisions: {
    version: REVIEW_DECISION_VERSION,
    resultKind: 'ui_preview',
    productionBatchResult: false,
    bindingFields: [
      'companyId',
      'ruleId',
      'datasetVersion',
      'datasetCreatedAt',
      'exportId',
      'batchId',
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
      'rulesetVersion',
      'ruleVersion',
      'ruleContentHash',
      'inputHash',
      'evaluatedAt',
    ],
    paused: 'blocked',
    humanRequired: 'needs_review',
    manualOnly: 'needs_review',
    minimumCoverageEnforced: true,
    renderFidelityEnforced: true,
    candidatePublicState: 'needs_review',
    candidateCalibrationField: 'proposedState',
    candidateScoringEnabled: false,
    negativeCandidateIsFinding: false,
  },
} as const;
