import { constants } from 'node:fs';
import { Buffer } from 'node:buffer';
import { link, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import {
  auditDataset,
  isValidIsoTimestamp,
  parseDatasetJson,
  CONTRACT_MANIFEST_HASH,
  EVALUATION_POLICY_HASH,
  stableHash,
} from '../lib/audit/engine';
import { buildBatchResult } from '../lib/audit/batch-result';
import { buildObsidianMarkdown } from '../lib/audit/obsidian';
import {
  parseReviewSessionJson,
  serializeReviewSession,
} from '../lib/audit/review-session';
import { EVALUATION_POLICY } from '../lib/audit/policy';
import { DATASET_VERSION_V2, MAX_V2_BATCH_BYTES } from '../lib/audit/types';
import { plainMetadata, readPlainDirectory } from './lib/local-filesystem.mjs';

export const LOCAL_RUN_VERSION = 'divinelist.local-audit-run.v1';
export const LOCAL_RUN_FILES = [
  'run-intent.json',
  'input.batch.json',
  'result.sealed.json',
  'review-session.json',
  'obsidian-workcopy.md',
  'run-manifest.json',
] as const;
const RUN_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const LOCK_NAME = '.run.lock';
type RunFileName = (typeof LOCAL_RUN_FILES)[number];
export type LocalAuditOptions = {
  inputPath: string;
  evaluatedAt: string;
  runName: string;
};

export class LocalAuditBlocked extends Error {
  readonly status = 'BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'LocalAuditBlocked';
  }
}

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new LocalAuditBlocked(message);
}
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const rawHash = (bytes: Uint8Array | string): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index]);
const jsonBytes = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const pathIdentity = (path: string): string =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

export const parseLocalAuditArguments = (args: string[]): LocalAuditOptions => {
  requireCondition(
    args.length === 5 && !args[0].startsWith('--'),
    'Ange batchfil --at <ISO-tid> --run <körnamn>; inga andra flaggor tillåts.',
  );
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    requireCondition(
      ['--at', '--run'].includes(flag) &&
        !values.has(flag) &&
        args[index + 1] &&
        !args[index + 1].startsWith('--'),
      'Okänt, dubblerat eller saknat argument.',
    );
    values.set(flag, args[index + 1]);
  }
  const options = {
    inputPath: args[0],
    evaluatedAt: values.get('--at')!,
    runName: values.get('--run')!,
  };
  validateOptions(options);
  return options;
};

const validateOptions = (options: LocalAuditOptions): void => {
  requireCondition(
    typeof options.inputPath === 'string' && options.inputPath.length > 0,
    'En explicit lokal batchfil krävs.',
  );
  requireCondition(
    typeof options.runName === 'string' &&
      RUN_NAME.test(options.runName) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(options.runName),
    'Körnamnet måste vara ett säkert enkelt namn, högst 80 tecken.',
  );
  requireCondition(
    isValidIsoTimestamp(options.evaluatedAt) &&
      Date.parse(options.evaluatedAt) <= Date.now() + 300_000,
    'En explicit giltig utvärderingstid krävs; framtida körningar är inte tillåtna.',
  );
};

const localPath = (value: string, root: string): string => {
  requireCondition(
    !/^[\\/]{2}/u.test(value) &&
      !Array.from(value).some(
        (character) => (character.codePointAt(0) ?? 0) < 32,
      ) &&
      !/^[a-zA-Z]:(?![\\/])/u.test(value),
    'Nätverks-, enhets- och tvetydiga sökvägar är inte tillåtna.',
  );
  const absolute = resolve(value);
  requireCondition(
    process.platform !== 'win32' ||
      parse(absolute).root.toLowerCase() === parse(root).root.toLowerCase(),
    'Batchen måste ligga på projektets lokala enhet.',
  );
  const components = relative(parse(absolute).root, absolute).split(sep);
  requireCondition(
    components.every(
      (part) =>
        !/[<>:"|?*]/u.test(part) &&
        !/[. ]$/u.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    ),
    'Sökvägen innehåller ett osäkert filnamn.',
  );
  return absolute;
};

/** lstat classifies OneDrive entries; realpath additionally rejects redirected ancestors. */
const assertPlainPath = async (path: string): Promise<void> => {
  const anchor = parse(path).root;
  let current = anchor;
  await plainMetadata(anchor);
  for (const component of relative(anchor, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    await plainMetadata(current);
  }
  requireCondition(
    pathIdentity(await realpath(path)) === pathIdentity(path),
    'Sökvägen passerar en omdirigering eller junction.',
  );
};

const readBounded = async (path: string, maximum: number): Promise<Buffer> => {
  await assertPlainPath(path);
  const before = await plainMetadata(path);
  requireCondition(
    before.isFile() && before.nlink === 1 && before.size <= maximum,
    'Filen måste vara vanlig, enkel-länkad och inom storleksgränsen.',
  );
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    requireCondition(
      opened.isFile() &&
        opened.nlink === 1 &&
        opened.dev === before.dev &&
        opened.ino === before.ino &&
        opened.size === before.size,
      'Filen ändrades eller ersattes före läsning.',
    );
    const buffer = Buffer.alloc(maximum + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.byteLength - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    requireCondition(
      total <= maximum &&
        total === before.size &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ino === before.ino,
      'Filen ändrades under läsning eller är för stor.',
    );
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
};

const decode = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new LocalAuditBlocked('Batchen måste vara strikt giltig UTF-8.');
  }
};

export const buildLocalAuditArtifacts = (
  inputBytes: Buffer,
  options: LocalAuditOptions,
) => {
  validateOptions(options);
  requireCondition(
    inputBytes.byteLength <= MAX_V2_BATCH_BYTES,
    'Batchen överskrider den befintliga storleksgränsen.',
  );
  const dataset = parseDatasetJson(decode(inputBytes));
  requireCondition(
    dataset.version === DATASET_VERSION_V2,
    'Arbetsflödet kräver en verifierad V2-batch, inte demo eller oförseglat utkast.',
  );
  const audits = auditDataset(dataset, options.evaluatedAt);
  const result = buildBatchResult(dataset, audits, options.evaluatedAt);
  const session = serializeReviewSession(
    dataset,
    options.evaluatedAt,
    {},
    options.evaluatedAt,
  );
  parseReviewSessionJson(session);
  const counts: Record<string, number> = {};
  const execution: Record<string, number> = {};
  let proposedDetected = 0;
  let proposedNotDetected = 0;
  for (const audit of audits)
    for (const item of audit.results) {
      counts[item.state] = (counts[item.state] ?? 0) + 1;
      execution[item.executionStatus] =
        (execution[item.executionStatus] ?? 0) + 1;
      if (item.proposedState === 'detected') proposedDetected += 1;
      if (item.proposedState === 'not_detected') proposedNotDetected += 1;
    }
  const summary = {
    companies: audits.length,
    rules: audits.reduce((sum, audit) => sum + audit.results.length, 0),
    states: counts,
    execution,
    proposedDetected,
    proposedNotDetected,
  };
  const guardrails = {
    scannedWebsites: false,
    sourceReadOnly: true,
    runtimeWrites: false,
    activeVaultWrites: false,
    humanDecisionsRecorded: false,
    outreachAuthorized: false,
    rulesActivated: false,
    productionReady: false,
    dataGateStatus: 'not_assessed',
    runtimeProductionChecksPerformed: false,
  } as const;
  const intent = {
    version: LOCAL_RUN_VERSION,
    runName: options.runName,
    inputSha256: rawHash(inputBytes),
    inputBytes: inputBytes.byteLength,
    evaluatedAt: options.evaluatedAt,
    evaluationPolicyHash: EVALUATION_POLICY_HASH,
    contractManifestHash: CONTRACT_MANIFEST_HASH,
    batchHash: dataset.batchHash,
    guardrails,
  };
  const files = new Map<RunFileName, Buffer>([
    ['run-intent.json', jsonBytes(intent)],
    ['input.batch.json', inputBytes],
    ['result.sealed.json', jsonBytes(result)],
    ['review-session.json', Buffer.from(session, 'utf8')],
    [
      'obsidian-workcopy.md',
      Buffer.from(
        buildObsidianMarkdown(audits, dataset.name, {
          datasetVersion: dataset.version,
          datasetCreatedAt: dataset.createdAt,
          evaluatedAt: options.evaluatedAt,
          sourceProvenance: 'verified_batch_v2',
          sourceDataset: dataset,
          decisions: {},
        }),
        'utf8',
      ),
    ],
  ]);
  for (const bytes of files.values())
    requireCondition(
      bytes.byteLength <= EVALUATION_POLICY.resultLimits.utf8Bytes,
      'En körartefakt överskrider den befintliga resultatgränsen.',
    );
  const payload = {
    ...intent,
    artifactKind: 'local_offline_run_package',
    workflowCompleted: true,
    summary,
    pathSafety:
      'plain-lstat-and-realpath; symbolic-links-junctions-and-hardlink-aliases-rejected; nonredirecting-cloud-attributes-not-classified',
    files: [...files].map(([name, bytes]) => ({
      name,
      bytes: bytes.byteLength,
      sha256: rawHash(bytes),
    })),
  };
  const manifest = { ...payload, manifestHash: stableHash(payload) };
  files.set('run-manifest.json', jsonBytes(manifest));
  return { files, manifest };
};

const ensureDirectory = async (path: string): Promise<void> => {
  await assertPlainPath(dirname(path));
  try {
    await mkdir(path);
  } catch (error) {
    if (codeOf(error) !== 'EEXIST') throw error;
  }
  await assertPlainPath(path);
  requireCondition(
    (await plainMetadata(path)).isDirectory(),
    'Rapportmålet måste vara en vanlig katalog.',
  );
};

const removeOwnedFile = async (
  path: string,
  identity: { dev: number; ino: number },
  expectedContent?: Buffer,
): Promise<void> => {
  const metadata = await plainMetadata(path);
  requireCondition(
    metadata.isFile() &&
      metadata.dev === identity.dev &&
      metadata.ino === identity.ino,
    'Egen temporär fil har ersatts; den lämnas orörd.',
  );
  if (expectedContent)
    requireCondition(
      sameBytes(
        await readBounded(path, expectedContent.byteLength),
        expectedContent,
      ),
      'Låsfilens innehåll ändrades; filen lämnas orörd.',
    );
  await unlink(path);
};

const publishNew = async (
  directory: string,
  name: RunFileName,
  bytes: Buffer,
): Promise<void> => {
  await assertPlainPath(directory);
  const temporary = join(directory, `.owned-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  const identity = await handle.stat();
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPlainPath(directory);
    // An atomic same-volume hardlink publishes only if the target does not exist.
    // rename is deliberately not used: it can replace an existing target.
    await link(temporary, join(directory, name));
  } finally {
    await removeOwnedFile(temporary, identity);
  }
};

/** projectRoot is supplied by the adjacent CLI wrapper, never a user output flag. */
export const runLocalAudit = async (
  options: LocalAuditOptions,
  projectRoot: string,
) => {
  validateOptions(options);
  const root = localPath(projectRoot, projectRoot);
  await assertPlainPath(root);
  const outputRoot = join(root, 'reports', 'local-runs');
  const inputPath = localPath(options.inputPath, root);
  const sourceRelative = relative(outputRoot, inputPath);
  requireCondition(
    sourceRelative.startsWith(`..${sep}`) ||
      sourceRelative === '..' ||
      parse(sourceRelative).root !== '',
    'Indata får inte komma från arbetsflödets egen utdatakatalog.',
  );
  const inputBytes = await readBounded(inputPath, MAX_V2_BATCH_BYTES);
  const { files, manifest } = buildLocalAuditArtifacts(inputBytes, options);
  await ensureDirectory(join(root, 'reports'));
  await ensureDirectory(outputRoot);
  const directory = join(outputRoot, options.runName);
  await ensureDirectory(directory);
  const lockPath = join(directory, LOCK_NAME);
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (codeOf(error) === 'EEXIST')
      throw new LocalAuditBlocked(
        'Körningen är låst av en annan eller avbruten process. Låset rensas aldrig automatiskt.',
      );
    throw error;
  }
  const lockIdentity = await lock.stat();
  const lockContent = jsonBytes({
    owner: randomUUID(),
    pid: process.pid,
    intentSha256: rawHash(files.get('run-intent.json')!),
  });
  const createdFiles: string[] = [];
  let existingCount = 0;
  try {
    await lock.writeFile(lockContent);
    await lock.sync();
    const entries = await readPlainDirectory(directory);
    const existing = new Set<string>();
    for (const entry of entries) {
      requireCondition(
        entry.kind === 'file' &&
          (entry.name === LOCK_NAME || files.has(entry.name as RunFileName)),
        'Körkatalogen innehåller en okänd fil, undermapp eller avbruten temporär fil. Ingenting ersätts.',
      );
      if (entry.name === LOCK_NAME) continue;
      const expected = files.get(entry.name as RunFileName)!;
      requireCondition(
        entry.metadata.size === expected.byteLength &&
          sameBytes(
            await readBounded(join(directory, entry.name), expected.byteLength),
            expected,
          ),
        'En befintlig körfil avviker från exakt underlag, tid eller policy. Ingenting ersätts.',
      );
      existing.add(entry.name);
    }
    existingCount = existing.size;
    requireCondition(
      existing.size === 0 || existing.has('run-intent.json'),
      'En ofullständig körning saknar sin ursprungliga bindning. Automatisk återupptagning är blockerad.',
    );
    for (const [name, bytes] of files) {
      if (existing.has(name)) continue;
      requireCondition(
        sameBytes(await readBounded(inputPath, MAX_V2_BATCH_BYTES), inputBytes),
        'Källbatchen har ändrats under körningen; det partiella paketet bevaras.',
      );
      await publishNew(directory, name, bytes);
      createdFiles.push(name);
    }
    for (const [name, bytes] of files)
      requireCondition(
        sameBytes(
          await readBounded(join(directory, name), bytes.byteLength),
          bytes,
        ),
        'Efterkontrollen av körpaketet misslyckades.',
      );
    const finalEntries = await readPlainDirectory(directory);
    requireCondition(
      finalEntries.length === files.size + 1 &&
        finalEntries.every(
          (entry) =>
            entry.kind === 'file' &&
            (entry.name === LOCK_NAME || files.has(entry.name as RunFileName)),
        ),
      'Körkatalogens filuppsättning ändrades under körningen.',
    );
    requireCondition(
      sameBytes(await readBounded(inputPath, MAX_V2_BATCH_BYTES), inputBytes),
      'Källbatchen ändrades före slutkontrollen.',
    );
    return {
      status: 'WORKFLOW_COMPLETED',
      workflowCompleted: true,
      mode:
        existingCount === files.size
          ? 'verified_existing'
          : existingCount
            ? 'resumed'
            : 'created',
      runDirectory: directory,
      createdFiles,
      manifest,
    };
  } finally {
    await lock.close();
    await removeOwnedFile(lockPath, lockIdentity, lockContent);
  }
};
