import {
  auditDataset,
  CONTRACT_MANIFEST_HASH,
  DATASET_HASH_CONTRACT_HASH,
  EVALUATION_POLICY_HASH,
  FACT_HASH,
  isValidIsoTimestamp,
  isVerifiedV2BatchContract,
  RULE_HASH,
  stableHash,
  unicodeCodePointCompare,
} from './engine';
import { EVALUATION_POLICY } from './policy';
import {
  BATCH_HASH_VERSION,
  DATASET_HASH_VERSION,
  DATASET_VERSION_V2,
  EVALUATION_POLICY_VERSION,
  FACT_REGISTRY_VERSION,
  MAPPING_VERSION,
  RESULT_HASH_VERSION,
  RESULT_VERSION,
  RULESET_VERSION,
  type AuditDataset,
  type CompanyAudit,
} from './types';

export { RESULT_VERSION } from './types';

export const RESULT_GUARDRAILS = {
  scannedWebsites: false,
  outreachAuthorized: false,
  externalWrites: false,
} as const;

export const buildBatchResult = (
  dataset: AuditDataset,
  companies: CompanyAudit[],
  generatedAt: string,
) => {
  if (dataset.version !== DATASET_VERSION_V2)
    throw new Error('Batchresultat får bara byggas från dataset.v2.');
  if (
    dataset.rulesetVersion !== RULESET_VERSION ||
    dataset.factRegistryVersion !== FACT_REGISTRY_VERSION ||
    dataset.mappingVersion !== MAPPING_VERSION ||
    dataset.datasetHashVersion !== DATASET_HASH_VERSION ||
    dataset.evaluationPolicyVersion !== EVALUATION_POLICY_VERSION ||
    dataset.evaluationPolicyHash !== EVALUATION_POLICY_HASH ||
    dataset.factHash !== FACT_HASH ||
    dataset.ruleHash !== RULE_HASH ||
    dataset.datasetHashContractHash !== DATASET_HASH_CONTRACT_HASH ||
    dataset.contractManifestHash !== CONTRACT_MANIFEST_HASH ||
    dataset.batchHashVersion !== BATCH_HASH_VERSION ||
    !dataset.batchHash ||
    !dataset.datasetHash ||
    !dataset.exportId ||
    !dataset.batchId
  )
    throw new Error(
      'Batchresultat kräver ett fullständigt och exakt versionsbundet V2-kontrakt.',
    );
  if (!isVerifiedV2BatchContract(dataset))
    throw new Error(
      'Batchresultat kräver en oförändrad V2-batch som verifierats av parsern.',
    );
  if (!isValidIsoTimestamp(generatedAt))
    throw new Error('Batchresultat kräver en strikt giltig generatedAt.');
  if (Date.parse(generatedAt) + 300_000 < Date.parse(dataset.createdAt))
    throw new Error(
      'Batchresultatets generatedAt får inte ligga mer än fem minuter före datasetets createdAt.',
    );
  const expectedCompanies = auditDataset(dataset, generatedAt);
  if (stableHash(companies) !== stableHash(expectedCompanies))
    throw new Error(
      'Batchresultatens företag matchar inte en ny deterministisk evaluering av den verifierade batchen.',
    );

  const envelope = {
    version: RESULT_VERSION,
    resultHashVersion: RESULT_HASH_VERSION,
    exportId: dataset.exportId,
    batchId: dataset.batchId,
    batchHashVersion: dataset.batchHashVersion,
    batchHash: dataset.batchHash,
    datasetHashVersion: dataset.datasetHashVersion,
    datasetHash: dataset.datasetHash,
    evaluationPolicyVersion: dataset.evaluationPolicyVersion,
    evaluationPolicyHash: dataset.evaluationPolicyHash,
    factHash: dataset.factHash,
    ruleHash: dataset.ruleHash,
    datasetHashContractHash: dataset.datasetHashContractHash,
    contractManifestHash: dataset.contractManifestHash,
    datasetVersion: dataset.version,
    factRegistryVersion: dataset.factRegistryVersion,
    rulesetVersion: dataset.rulesetVersion,
    mappingVersion: dataset.mappingVersion,
    generatedAt,
    companies,
    guardrails: RESULT_GUARDRAILS,
  };

  return {
    ...envelope,
    resultHash: stableHash(envelope),
  };
};

export type BatchResult = ReturnType<typeof buildBatchResult>;

export class BatchResultValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? 'Batchresultatet är ogiltigt.');
    this.name = 'BatchResultValidationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const RESULT_KEYS = [
  'version',
  'resultHashVersion',
  'resultHash',
  'exportId',
  'batchId',
  'batchHashVersion',
  'batchHash',
  'datasetHashVersion',
  'datasetHash',
  'evaluationPolicyVersion',
  'evaluationPolicyHash',
  'factHash',
  'ruleHash',
  'datasetHashContractHash',
  'contractManifestHash',
  'datasetVersion',
  'factRegistryVersion',
  'rulesetVersion',
  'mappingVersion',
  'generatedAt',
  'companies',
  'guardrails',
] as const;

export const validateBatchResult = (
  input: unknown,
  dataset: AuditDataset,
): BatchResult => {
  const issues: string[] = [];
  if (!isRecord(input))
    throw new BatchResultValidationError([
      'Resultatets rot måste vara ett JSON-objekt.',
    ]);
  const allowed = new Set<string>(RESULT_KEYS);
  for (const key of Object.keys(input).sort(unicodeCodePointCompare)) {
    if (!allowed.has(key)) issues.push(`result.${key}: okänt fält.`);
  }
  for (const key of RESULT_KEYS) {
    if (!(key in input))
      issues.push(`result.${key}: obligatoriskt fält saknas.`);
  }
  if (
    typeof input.generatedAt !== 'string' ||
    !isValidIsoTimestamp(input.generatedAt)
  )
    issues.push(
      'result.generatedAt: måste vara en strikt giltig ISO-tidpunkt.',
    );
  if (!isVerifiedV2BatchContract(dataset))
    issues.push(
      'Källbatchen saknar giltig parserattestering eller har ändrats.',
    );

  if (issues.length === 0) {
    try {
      const generatedAt = input.generatedAt as string;
      const expected = buildBatchResult(
        dataset,
        auditDataset(dataset, generatedAt),
        generatedAt,
      );
      if (stableHash(input) !== stableHash(expected))
        issues.push(
          'Resultatobjektet matchar inte den exakta deterministiska, versions- och kontraktsbundna envelopen.',
        );
    } catch (error) {
      issues.push(
        error instanceof Error
          ? error.message
          : 'Resultatobjektet kunde inte verifieras.',
      );
    }
  }
  if (issues.length > 0)
    throw new BatchResultValidationError(issues.slice(0, 50));
  return input as BatchResult;
};

export const parseBatchResultJson = (
  json: string,
  dataset: AuditDataset,
): BatchResult => {
  if (
    new TextEncoder().encode(json).byteLength >
    EVALUATION_POLICY.resultLimits.utf8Bytes
  )
    throw new BatchResultValidationError([
      `Resultatfilen överskrider ${EVALUATION_POLICY.resultLimits.utf8Bytes.toLocaleString('sv-SE')} UTF-8-byte.`,
    ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new BatchResultValidationError([
      `Resultat-JSON kunde inte tolkas: ${error instanceof Error ? error.message : 'okänt fel'}`,
    ]);
  }
  return validateBatchResult(parsed, dataset);
};
