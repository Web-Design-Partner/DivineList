import {
  auditDataset,
  isValidIsoTimestamp,
  parseDatasetJson,
  serializeDatasetJson,
  stableHash,
  unicodeCodePointCompare,
} from './engine';
import {
  reviewDecisionKey,
  reviewDecisionMatchesResult,
  type ExportReviewDecision,
  type ExportReviewMap,
} from './obsidian';
import { isNegativeCandidateProposal } from './presentation';
import { resolveUiPreviewEvaluatedAt } from './ui-preview';
import {
  MAX_V2_BATCH_COMPANIES,
  DATASET_VERSION_V2,
  type AuditDataset,
  type RuleResult,
} from './types';
import { inspectPortableJsonStructure } from './json-guard';

export const REVIEW_SESSION_VERSION = 'divinelist.review-session.v1' as const;
export const MAX_REVIEW_SESSION_BYTES = 16_000_000;
const MAX_REVIEW_DECISIONS = MAX_V2_BATCH_COMPANIES * 120;
const MAX_REVIEW_SESSION_JSON_DEPTH = 32;
const MAX_REVIEW_SESSION_JSON_NODES = 1_000_000;

type ReviewSessionPayload = {
  version: typeof REVIEW_SESSION_VERSION;
  artifactKind: 'ui_review_session';
  productionBatchResult: false;
  createdAt: string;
  evaluatedAt: string;
  dataset: AuditDataset;
  decisions: ExportReviewDecision[];
};

export type ReviewSessionEnvelope = ReviewSessionPayload & {
  sessionHash: string;
};

export type ParsedReviewSession = {
  envelope: ReviewSessionEnvelope;
  dataset: AuditDataset;
  evaluatedAt: string;
  decisions: ExportReviewMap;
};

export class ReviewSessionValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.name = 'ReviewSessionValidationError';
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ROOT_KEYS = [
  'artifactKind',
  'createdAt',
  'dataset',
  'decisions',
  'evaluatedAt',
  'productionBatchResult',
  'sessionHash',
  'version',
] as const;

const DECISION_KEYS = [
  'batchHash',
  'batchHashVersion',
  'batchId',
  'companyId',
  'contractManifestHash',
  'datasetCreatedAt',
  'datasetHash',
  'datasetHashContractHash',
  'datasetHashVersion',
  'datasetVersion',
  'decidedAt',
  'decisionVersion',
  'evaluatedAt',
  'evaluationPolicyHash',
  'evaluationPolicyVersion',
  'exportId',
  'factHash',
  'inputHash',
  'productionBatchResult',
  'rationale',
  'resultKind',
  'ruleContentHash',
  'ruleHash',
  'ruleId',
  'rulesetVersion',
  'ruleVersion',
  'state',
] as const;

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

const isReviewableResult = (result: RuleResult): boolean =>
  result.state === 'detected' ||
  (result.state === 'needs_review' && !isNegativeCandidateProposal(result));

const validatedEvaluationTime = (
  dataset: AuditDataset,
  evaluatedAt: string,
): string => {
  const resolution = resolveUiPreviewEvaluatedAt(dataset, evaluatedAt);
  if (!resolution.ok) throw new ReviewSessionValidationError(resolution.issues);
  if (resolution.evaluatedAt !== evaluatedAt)
    throw new ReviewSessionValidationError([
      'evaluatedAt matchar inte datasetets tillåtna reproducerbara tid.',
    ]);
  return resolution.evaluatedAt;
};

const decisionsForDataset = (
  dataset: AuditDataset,
  evaluatedAt: string,
  decisions: ExportReviewMap,
): ExportReviewDecision[] => {
  const results = new Map(
    auditDataset(dataset, evaluatedAt).flatMap((audit) =>
      audit.results.map(
        (result) =>
          [reviewDecisionKey(audit.company.id, result.ruleId), result] as const,
      ),
    ),
  );
  const validated = Object.entries(decisions).map(([key, decision]) => {
    const result = results.get(key);
    if (
      key !== reviewDecisionKey(decision.companyId, decision.ruleId) ||
      !reviewDecisionMatchesResult(
        decision,
        dataset,
        decision.companyId,
        result,
      ) ||
      !result ||
      !isReviewableResult(result)
    )
      throw new ReviewSessionValidationError([
        `Beslutet för ${decision.companyId}/${decision.ruleId} matchar inte det aktuella regelresultatet.`,
      ]);
    return decision;
  });
  return validated.sort((left, right) => {
    const companyOrder = unicodeCodePointCompare(
      left.companyId,
      right.companyId,
    );
    return companyOrder || unicodeCodePointCompare(left.ruleId, right.ruleId);
  });
};

export const buildReviewSession = (
  dataset: AuditDataset,
  evaluatedAt: string,
  decisions: ExportReviewMap,
  createdAt = new Date().toISOString(),
): ReviewSessionEnvelope => {
  if (!isValidIsoTimestamp(createdAt))
    throw new ReviewSessionValidationError([
      'createdAt måste vara en strikt giltig ISO-tidpunkt.',
    ]);
  if (Date.parse(createdAt) > Date.now() + 300_000)
    throw new ReviewSessionValidationError([
      'createdAt ligger mer än fem minuter i framtiden.',
    ]);
  const datasetJson = serializeDatasetJson(dataset);
  const validatedDataset = parseDatasetJson(datasetJson);
  const validatedEvaluatedAt = validatedEvaluationTime(
    validatedDataset,
    evaluatedAt,
  );
  const validatedDecisions = decisionsForDataset(
    validatedDataset,
    validatedEvaluatedAt,
    decisions,
  );
  if (
    validatedDecisions.some(
      (decision) =>
        Date.parse(decision.decidedAt) > Date.parse(createdAt) + 300_000,
    )
  )
    throw new ReviewSessionValidationError([
      'Ett beslut är daterat efter granskningssessionens createdAt.',
    ]);

  const payload: ReviewSessionPayload = {
    version: REVIEW_SESSION_VERSION,
    artifactKind: 'ui_review_session',
    productionBatchResult: false,
    createdAt,
    evaluatedAt: validatedEvaluatedAt,
    // Hash the original sealed V2 shape, while decisions and evaluation above
    // still use the unchanged normalized representation. V1 behavior is intact.
    dataset:
      validatedDataset.version === DATASET_VERSION_V2
        ? (JSON.parse(datasetJson) as AuditDataset)
        : validatedDataset,
    decisions: validatedDecisions,
  };
  return { ...payload, sessionHash: stableHash(payload) };
};

export const serializeReviewSession = (
  dataset: AuditDataset,
  evaluatedAt: string,
  decisions: ExportReviewMap,
  createdAt = new Date().toISOString(),
): string =>
  `${JSON.stringify(
    buildReviewSession(dataset, evaluatedAt, decisions, createdAt),
    null,
    2,
  )}\n`;

export const parseReviewSessionJson = (json: string): ParsedReviewSession => {
  if (new TextEncoder().encode(json).byteLength > MAX_REVIEW_SESSION_BYTES)
    throw new ReviewSessionValidationError([
      `Granskningssessionen överskrider ${MAX_REVIEW_SESSION_BYTES.toLocaleString('sv-SE')} UTF-8-byte.`,
    ]);

  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new ReviewSessionValidationError([
      'Granskningssessionen är inte giltig JSON.',
    ]);
  }
  const structureIssues = inspectPortableJsonStructure(raw, {
    maxDepth: MAX_REVIEW_SESSION_JSON_DEPTH,
    maxIssues: 100,
    maxNodes: MAX_REVIEW_SESSION_JSON_NODES,
    rootLabel: 'granskningssession',
  });
  if (structureIssues.length)
    throw new ReviewSessionValidationError(structureIssues);
  if (!isRecord(raw))
    throw new ReviewSessionValidationError([
      'Granskningssessionens rot måste vara ett objekt.',
    ]);

  const issues: string[] = [];
  if (!exactKeysMatch(raw, ROOT_KEYS))
    issues.push('Granskningssessionen har saknade eller okända rotfält.');
  if (raw.version !== REVIEW_SESSION_VERSION)
    issues.push(`version måste vara ${REVIEW_SESSION_VERSION}.`);
  if (raw.artifactKind !== 'ui_review_session')
    issues.push('artifactKind måste vara ui_review_session.');
  if (raw.productionBatchResult !== false)
    issues.push('productionBatchResult måste vara false.');
  if (typeof raw.createdAt !== 'string' || !isValidIsoTimestamp(raw.createdAt))
    issues.push('createdAt måste vara en strikt giltig ISO-tidpunkt.');
  if (
    typeof raw.createdAt === 'string' &&
    isValidIsoTimestamp(raw.createdAt) &&
    Date.parse(raw.createdAt) > Date.now() + 300_000
  )
    issues.push('createdAt ligger mer än fem minuter i framtiden.');
  if (
    typeof raw.evaluatedAt !== 'string' ||
    !isValidIsoTimestamp(raw.evaluatedAt)
  )
    issues.push('evaluatedAt måste vara en strikt giltig ISO-tidpunkt.');
  if (!isRecord(raw.dataset)) issues.push('dataset måste vara ett objekt.');
  if (!Array.isArray(raw.decisions))
    issues.push('decisions måste vara en lista.');
  if (
    typeof raw.sessionHash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(raw.sessionHash)
  )
    issues.push('sessionHash måste vara en SHA-256-hash.');
  if (issues.length) throw new ReviewSessionValidationError(issues);

  const decisionsRaw = raw.decisions as unknown[];
  if (decisionsRaw.length > MAX_REVIEW_DECISIONS)
    throw new ReviewSessionValidationError([
      `Granskningssessionen får innehålla högst ${MAX_REVIEW_DECISIONS} beslut.`,
    ]);

  const payload: ReviewSessionPayload = {
    version: REVIEW_SESSION_VERSION,
    artifactKind: 'ui_review_session',
    productionBatchResult: false,
    createdAt: raw.createdAt as string,
    evaluatedAt: raw.evaluatedAt as string,
    dataset: raw.dataset as AuditDataset,
    decisions: decisionsRaw as ExportReviewDecision[],
  };
  if (stableHash(payload) !== raw.sessionHash)
    throw new ReviewSessionValidationError([
      'sessionHash matchar inte granskningssessionens innehåll.',
    ]);

  const dataset = parseDatasetJson(JSON.stringify(payload.dataset));
  const evaluatedAt = validatedEvaluationTime(dataset, payload.evaluatedAt);
  const results = new Map(
    auditDataset(dataset, evaluatedAt).flatMap((audit) =>
      audit.results.map(
        (result) =>
          [reviewDecisionKey(audit.company.id, result.ruleId), result] as const,
      ),
    ),
  );
  const decisions: ExportReviewMap = {};
  const decisionIssues: string[] = [];

  decisionsRaw.forEach((value, index) => {
    if (!isRecord(value) || !exactKeysMatch(value, DECISION_KEYS)) {
      decisionIssues.push(`decisions[${index}] har saknade eller okända fält.`);
      return;
    }
    const decision = value as ExportReviewDecision;
    const key = reviewDecisionKey(decision.companyId, decision.ruleId);
    const result = results.get(key);
    if (decisions[key]) {
      decisionIssues.push(`decisions[${index}] duplicerar ${key}.`);
      return;
    }
    if (
      !reviewDecisionMatchesResult(
        decision,
        dataset,
        decision.companyId,
        result,
      ) ||
      !result ||
      !isReviewableResult(result)
    ) {
      decisionIssues.push(
        `decisions[${index}] matchar inte ett granskningsbart regelresultat.`,
      );
      return;
    }
    if (
      Date.parse(decision.decidedAt) >
      Date.parse(payload.createdAt) + 300_000
    ) {
      decisionIssues.push(
        `decisions[${index}].decidedAt ligger efter createdAt.`,
      );
      return;
    }
    decisions[key] = decision;
  });
  if (decisionIssues.length)
    throw new ReviewSessionValidationError(decisionIssues);

  const envelope: ReviewSessionEnvelope = {
    ...payload,
    dataset: dataset.version === DATASET_VERSION_V2 ? payload.dataset : dataset,
    decisions: Object.values(decisions).sort((left, right) => {
      const companyOrder = unicodeCodePointCompare(
        left.companyId,
        right.companyId,
      );
      return companyOrder || unicodeCodePointCompare(left.ruleId, right.ruleId);
    }),
    sessionHash: raw.sessionHash as string,
  };
  return { envelope, dataset, evaluatedAt, decisions };
};
