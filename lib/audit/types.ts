export const DATASET_VERSION = 'divinelist.dataset.v1' as const;
export const DATASET_VERSION_V2 = 'divinelist.dataset.v2' as const;
export const FACT_REGISTRY_VERSION = 'divinelist.facts.v2.1.0' as const;
export const RULESET_VERSION = 'divinelist.rules.v1.2.0' as const;
export const MAPPING_VERSION = 'foretagskarta-divinelist.v2.3.0' as const;
export const DATASET_HASH_VERSION =
  'divinelist.dataset-payload.v2.2.0' as const;
export const EVALUATION_POLICY_VERSION =
  'divinelist.evaluation-policy.v2.2.0' as const;
export const BATCH_HASH_VERSION = 'divinelist.batch-envelope.v2.2.0' as const;
export const RESULT_HASH_VERSION = 'divinelist.result-envelope.v2.2.0' as const;
export const RESULT_VERSION = 'divinelist.results.v2' as const;
export const REVIEW_DECISION_VERSION =
  'divinelist.review-decision.v2.3.0' as const;
export const MAX_V2_BATCH_COMPANIES = 100;
export const DEFAULT_V2_BATCH_COMPANIES = 50;
export const MAX_V2_BATCH_BYTES = 4_500_000;

export type Primitive = string | number | boolean | null;
export type FactValue = Primitive | Primitive[];

export type EvidenceMethod =
  | 'manual'
  | 'html'
  | 'headers'
  | 'lighthouse'
  | 'monitoring'
  | 'accessibility-audit'
  | 'browser-test'
  | 'screenshot'
  | 'business-profile'
  | 'structured-data'
  | 'link-check'
  | 'form-test'
  | 'other';

export type EvidenceStrength = 'strong' | 'medium' | 'weak';

export type EvidenceActor = 'human' | 'tool' | 'ai';
export type RenderFidelity = 'full' | 'degraded' | 'unknown';
export type ExecutionStatus = 'completed' | 'partial' | 'blocked' | 'failed';

export interface EvidenceItem {
  id: string;
  method: EvidenceMethod;
  label: string;
  observedAt: string;
  strength: EvidenceStrength;
  locator?: string;
  note?: string;
  sourceUrl?: string;
  pageId?: string;
  artifactPath?: string;
  artifactSha256?: string;
  collector?: string;
  collectorVersion?: string;
  actor?: EvidenceActor;
  viewport?: string;
  locale?: string;
  pageType?: string;
  testScenario?: string;
  cookieConsentState?: string;
  scope?: string;
  limitations?: string[];
  retentionClass?: 'ephemeral' | 'audit' | 'policy';
}

export interface AuditFact {
  key: string;
  value: FactValue;
  evidenceIds: string[];
  observedAt?: string;
}

export type ReviewState = 'new' | 'confirmed' | 'manual_check' | 'dismissed';

export interface ReviewDecision {
  ruleId: string;
  state: Exclude<ReviewState, 'new'>;
  rationale: string;
  decidedAt: string;
  ruleVersion: string;
  inputHash: string;
}

export interface CompanySnapshot {
  id: string;
  name: string;
  domain: string;
  city?: string;
  industry?: string;
  capturedAt: string;
  facts: AuditFact[];
  evidence: EvidenceItem[];
  reviews?: ReviewDecision[];
  tags?: string[];
  workplaceUid?: string;
  siteUid?: string;
  municipalityCode?: string;
  gothenburgStatus?: 'verified' | 'unresolved' | 'excluded';
  verificationStatus?:
    | 'verified_current'
    | 'partial'
    | 'unresolved'
    | 'blocked';
  relationshipStatus?:
    | 'verified_primary'
    | 'shared_corporate'
    | 'probable_primary'
    | 'platform_only'
    | 'unresolved';
  relationshipConfidence?: number;
  renderFidelity?: RenderFidelity;
  pageCoverage?: {
    eligiblePages: number;
    testedPages: number;
    excludedPages: number;
  };
}

export interface AuditDataset {
  version: typeof DATASET_VERSION | typeof DATASET_VERSION_V2;
  name: string;
  createdAt: string;
  companies: CompanySnapshot[];
  exportId?: string;
  batchId?: string;
  rulesetVersion?: string;
  factRegistryVersion?: string;
  mappingVersion?: string;
  datasetHashVersion?: string;
  datasetHash?: string;
  evaluationPolicyVersion?: string;
  evaluationPolicyHash?: string;
  factHash?: string;
  ruleHash?: string;
  datasetHashContractHash?: string;
  contractManifestHash?: string;
  batchHashVersion?: string;
  batchHash?: string;
}

/** Exact full-export payload covered by datasetHash. A batch only carries a
 * subset of companies and therefore cannot reconstruct this payload alone. */
export interface DatasetHashPayload {
  version: typeof DATASET_VERSION_V2;
  name: string;
  createdAt: string;
  datasetHashVersion: typeof DATASET_HASH_VERSION;
  factRegistryVersion: typeof FACT_REGISTRY_VERSION;
  rulesetVersion: typeof RULESET_VERSION;
  mappingVersion: typeof MAPPING_VERSION;
  evaluationPolicyVersion: typeof EVALUATION_POLICY_VERSION;
  evaluationPolicyHash: string;
  factHash: string;
  ruleHash: string;
  datasetHashContractHash: string;
  contractManifestHash: string;
  companies: CompanySnapshot[];
}

export type RuleCategory =
  | 'availability'
  | 'crawlability'
  | 'performance'
  | 'mobile'
  | 'accessibility'
  | 'onpage-seo'
  | 'local-seo'
  | 'conversion'
  | 'content-trust'
  | 'forms-commerce'
  | 'privacy-security'
  | 'operations';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'empty'
  | 'not_empty'
  | 'includes'
  | 'not_includes';

export interface Clause {
  fact: string;
  operator: Operator;
  value?: Primitive;
}

export type Condition = Clause | { all: Condition[] } | { any: Condition[] };

export interface RuleDefinition {
  id: string;
  version: string;
  title: string;
  category: RuleCategory;
  severity: Severity;
  rootCause: string;
  description: string;
  whyItMatters: string;
  safeFinding: string;
  recommendation: string;
  manualCheck: string;
  requiredFacts: string[];
  evidenceMethodsByFact: Record<string, EvidenceMethod[]>;
  condition: Condition;
  appliesWhen?: Condition;
  maxEvidenceAgeDays: number;
  tier: 'A' | 'B' | 'C' | 'D';
  lifecycle: 'draft' | 'shadow' | 'candidate' | 'active' | 'paused' | 'retired';
  evaluationMode: 'automated' | 'human_required' | 'manual_only' | 'paused';
  sideEffectRisk: 'none' | 'read_only' | 'external_write';
  minimumCoverage: number;
}

export type ResultState =
  | 'detected'
  | 'not_detected'
  | 'not_tested'
  | 'needs_review'
  | 'not_applicable'
  | 'error';

export interface RuleTrace {
  fact: string;
  expected: string;
  actual: FactValue;
  evidenceIds: string[];
}

export interface RuleResult {
  companyId: string;
  ruleId: string;
  ruleVersion: string;
  ruleContentHash: string;
  ruleTier: RuleDefinition['tier'];
  ruleLifecycle: RuleDefinition['lifecycle'];
  evaluationMode: RuleDefinition['evaluationMode'];
  rulesetVersion: typeof RULESET_VERSION;
  category: RuleCategory;
  severity: Severity;
  rootCause: string;
  state: ResultState;
  proposedState?: 'detected' | 'not_detected';
  confidence: number;
  title: string;
  safeFinding: string;
  recommendation: string;
  manualCheck: string;
  evidenceIds: string[];
  acceptedEvidenceIds: string[];
  rejectedEvidence: Array<{ evidenceId: string; reason: string }>;
  limitations: string[];
  trace: RuleTrace[];
  evaluatedAt: string;
  inputHash: string;
  executionStatus: ExecutionStatus;
  renderFidelity: RenderFidelity;
  coverage: {
    eligiblePages: number;
    testedPages: number;
    excludedPages: number;
  };
}

export interface CompanyAudit {
  company: CompanySnapshot;
  inputHash: string;
  results: RuleResult[];
  priorityScore: number;
  detectedCount: number;
  reviewCount: number;
  unknownCount: number;
  coverage: number;
}

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  availability: 'Drift & HTTPS',
  crawlability: 'Indexering',
  performance: 'Prestanda',
  mobile: 'Mobil',
  accessibility: 'Tillgänglighet',
  'onpage-seo': 'SEO på sidan',
  'local-seo': 'Lokal synlighet',
  conversion: 'Konvertering',
  'content-trust': 'Innehåll & förtroende',
  'forms-commerce': 'Formulär & handel',
  'privacy-security': 'Integritet & säkerhetshygien',
  operations: 'Kvalitet & underhåll',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Kritisk',
  high: 'Hög',
  medium: 'Medel',
  low: 'Låg',
  info: 'Info',
};

export const RESULT_LABELS: Record<ResultState, string> = {
  detected: 'Observerat',
  not_detected: 'Inte observerat',
  not_tested: 'Okänt',
  needs_review: 'Kontrollera',
  not_applicable: 'Ej relevant',
  error: 'Regelfel',
};
