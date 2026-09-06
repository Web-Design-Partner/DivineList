import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  CONTRACT_MANIFEST,
  CONTRACT_MANIFEST_HASH,
  DATASET_HASH_CONTRACT,
  DATASET_HASH_CONTRACT_HASH,
  EVALUATION_POLICY_HASH,
  FACT_CONTRACT,
  FACT_HASH,
  RULE_CONTRACT,
  RULE_HASH,
  stableHash,
} from '../lib/audit/engine';
import { EVALUATION_POLICY } from '../lib/audit/policy';

const outputRoot = resolve(process.argv[2] ?? 'dist/contracts');
await mkdir(outputRoot, { recursive: true });

const writeAtomic = async (name: string, value: unknown): Promise<string> => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const hash = stableHash(value);
  const target = resolve(outputRoot, name);
  const temporary = resolve(outputRoot, `.${name}.tmp-${hash.slice(-12)}`);
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
  return hash;
};

const factHash = await writeAtomic('divinelist-facts-v2.json', FACT_CONTRACT);
const ruleHash = await writeAtomic('divinelist-rules-v2.json', RULE_CONTRACT);
const evaluationPolicyHash = await writeAtomic(
  'divinelist-evaluation-policy-v2.json',
  EVALUATION_POLICY,
);
if (evaluationPolicyHash !== EVALUATION_POLICY_HASH)
  throw new Error(
    'Den exporterade evaluation-policyn avviker från evaluatorn.',
  );
const datasetHashContractHash = await writeAtomic(
  'divinelist-dataset-hash-v2.json',
  DATASET_HASH_CONTRACT,
);
const manifestHash = await writeAtomic(
  'divinelist-contract-manifest.json',
  CONTRACT_MANIFEST,
);
if (
  factHash !== FACT_HASH ||
  ruleHash !== RULE_HASH ||
  datasetHashContractHash !== DATASET_HASH_CONTRACT_HASH ||
  manifestHash !== CONTRACT_MANIFEST_HASH
)
  throw new Error(
    'Exporterade kontrakt avviker från evaluatorns exakta hashankare.',
  );
process.stdout.write(
  `${JSON.stringify({
    status: 'PASS',
    outputRoot,
    factCount: CONTRACT_MANIFEST.factCount,
    ruleCount: CONTRACT_MANIFEST.ruleCount,
    factHash,
    ruleHash,
    evaluationPolicyHash,
    datasetHashContractHash,
    manifestHash,
  })}\n`,
);
