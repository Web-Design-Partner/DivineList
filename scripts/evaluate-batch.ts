import { link, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import {
  auditDataset,
  isValidIsoTimestamp,
  parseDatasetJson,
} from '../lib/audit/engine';
import {
  buildBatchResult,
  validateBatchResult,
} from '../lib/audit/batch-result';
import { DATASET_VERSION_V2, MAX_V2_BATCH_BYTES } from '../lib/audit/types';

const readBoundedUtf8 = async (path: string): Promise<string> => {
  const handle = await open(path, 'r');
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total <= MAX_V2_BATCH_BYTES) {
      const remaining = MAX_V2_BATCH_BYTES + 1 - total;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (total > MAX_V2_BATCH_BYTES)
    throw new Error(
      `Inputfilen överskrider gränsen ${MAX_V2_BATCH_BYTES.toLocaleString('sv-SE')} UTF-8-byte. Dela upp batchen.`,
    );
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, total),
    );
  } catch (error) {
    throw new Error('Inputfilen måste vara strikt giltig UTF-8.', {
      cause: error,
    });
  }
};

const [inputArgument, outputArgument, evaluatedAtArgument] =
  process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    'Användning: evaluate-batch <input.json> <result.json> <evaluatedAt>',
  );
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
if (inputPath.toLowerCase() === outputPath.toLowerCase())
  throw new Error('Input och output måste vara olika filer.');
const dataset = parseDatasetJson(await readBoundedUtf8(inputPath));
if (dataset.version !== DATASET_VERSION_V2)
  throw new Error(
    'Produktionsutvärderaren accepterar endast divinelist.dataset.v2.',
  );

if (!evaluatedAtArgument)
  throw new Error(
    'evaluatedAt måste anges explicit för en deterministisk produktionskörning.',
  );
const evaluatedAt = evaluatedAtArgument;
if (!isValidIsoTimestamp(evaluatedAt))
  throw new Error('evaluatedAt måste vara en strikt giltig ISO-tidpunkt.');
if (Date.parse(evaluatedAt) + 300_000 < Date.parse(dataset.createdAt))
  throw new Error(
    'evaluatedAt får inte ligga mer än fem minuter före datasetets createdAt.',
  );

const audits = auditDataset(dataset, evaluatedAt);
const result = buildBatchResult(dataset, audits, evaluatedAt);
validateBatchResult(result, dataset);

const content = `${JSON.stringify(result, null, 2)}\n`;
const temporary = resolve(
  dirname(outputPath),
  `.${outputPath.split(/[\\/]/u).pop()}.tmp-${process.pid}-${randomUUID()}`,
);
await mkdir(dirname(outputPath), { recursive: true });
try {
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  // Publish an immutable result without a destructive replace. A same-volume
  // hard link is atomic and fails with EEXIST for paths, symlinks and hard-link
  // aliases that already exist, leaving both the input and prior output intact.
  try {
    await link(temporary, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        'Outputfilen finns redan. Välj en ny sökväg; produktionsresultat skrivs aldrig över.',
        { cause: error },
      );
    throw error;
  }
} finally {
  await rm(temporary, { force: true });
}

process.stdout.write(
  `${JSON.stringify({
    status: 'PASS',
    input: inputPath,
    output: outputPath,
    companies: audits.length,
    rules: audits.reduce((sum, audit) => sum + audit.results.length, 0),
    evaluatedAt,
  })}\n`,
);
