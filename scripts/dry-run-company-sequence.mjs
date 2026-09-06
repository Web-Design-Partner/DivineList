import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareRequest,
  runWorker,
  writeDryRun,
  SEQUENCE_REQUEST,
} from './dry-run-company-seeds.mjs';
import { readJson } from './plan-local-work.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
export const MANIFEST_VERSION = 'divinelist.import-sequence-manifest.v1';

export function sequenceHash(value) {
  const canonical = (item) =>
    Array.isArray(item)
      ? item.map(canonical)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return (
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex')
  );
}

function exact(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...fields].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  ) {
    throw new Error('Okända eller saknade fält i paketföljden.');
  }
}

export function validateManifest(manifest) {
  exact(manifest, ['version', 'packets']);
  if (
    manifest.version !== MANIFEST_VERSION ||
    !Array.isArray(manifest.packets) ||
    manifest.packets.length < 1 ||
    manifest.packets.length > 3
  ) {
    throw new Error('Paketföljden kräver en till tre paket och känd version.');
  }
  const ids = new Set();
  for (const packet of manifest.packets) {
    exact(packet, [
      'packetId',
      'seedPath',
      'seedSha256',
      'observationsPath',
      'observationsSha256',
    ]);
    if (
      typeof packet.packetId !== 'string' ||
      !ID.test(packet.packetId) ||
      ids.has(packet.packetId) ||
      typeof packet.seedSha256 !== 'string' ||
      typeof packet.observationsSha256 !== 'string' ||
      !HASH.test(packet.seedSha256) ||
      !HASH.test(packet.observationsSha256) ||
      typeof packet.seedPath !== 'string' ||
      !packet.seedPath ||
      typeof packet.observationsPath !== 'string' ||
      !packet.observationsPath
    ) {
      throw new Error(
        'Ogiltig eller dubblerad paketidentitet, fil eller kontrollsumma.',
      );
    }
    ids.add(packet.packetId);
  }
}

export function prepareSequence(inputs, evaluatedAt) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 3) {
    throw new Error('Paketföljden kräver en till tre paket.');
  }
  const ids = new Set();
  const sourceIds = new Set();
  const hosts = new Set();
  const plans = [];
  const packets = [];
  let sourceName;
  for (const input of inputs) {
    if (
      typeof input.packetId !== 'string' ||
      !ID.test(input.packetId) ||
      ids.has(input.packetId)
    ) {
      throw new Error('Ogiltigt eller dubblerat paket-ID.');
    }
    ids.add(input.packetId);
    const prepared = prepareRequest({ ...input, evaluatedAt });
    if (!prepared.request.records.length) {
      throw new Error(
        'Paketet saknar agentklara kandidater: ' + input.packetId,
      );
    }
    sourceName ??= prepared.request.sourceName;
    if (sourceName !== prepared.request.sourceName) {
      throw new Error('Alla paket måste tillhöra samma stabila makrovåg.');
    }
    for (const record of prepared.request.records) {
      const host = new URL(record.website).hostname.replace(/^www\./, '');
      if (sourceIds.has(record.source_record_id) || hosts.has(host)) {
        throw new Error(
          'Kandidat-ID eller domän överlappar mellan valda paket.',
        );
      }
      sourceIds.add(record.source_record_id);
      hosts.add(host);
    }
    plans.push({ packetId: input.packetId, plan: prepared.plan });
    packets.push({
      packetId: input.packetId,
      seedSha256: input.seedSha256,
      planHash: prepared.plan.planHash,
      records: prepared.request.records,
    });
  }
  const seedSha256 = sequenceHash(
    packets.map(({ packetId, seedSha256 }) => ({ packetId, seedSha256 })),
  );
  const planHash = sequenceHash(
    packets.map(({ packetId, planHash }) => ({ packetId, planHash })),
  );
  return {
    plans,
    plan: {
      version: 'divinelist.import-sequence-plan.v1',
      evaluatedAt,
      seedSha256,
      planHash,
      records: plans.flatMap(({ packetId, plan }) =>
        plan.records.map((record) => ({ ...record, packetId })),
      ),
    },
    request: {
      version: SEQUENCE_REQUEST,
      evaluatedAt,
      sourceName,
      seedSha256,
      planHash,
      records: packets.flatMap((packet) => packet.records),
      packets,
    },
  };
}

export async function loadSequence(manifestPath, evaluatedAt) {
  const manifest = await readJson(manifestPath);
  validateManifest(manifest.data);
  const inputs = [];
  const bindings = [];
  for (const packet of manifest.data.packets) {
    // Explicit paths resolve from the invoking working directory, never from
    // untrusted instructions or a search for a similarly named input.
    const seed = await readJson(packet.seedPath);
    const observations = await readJson(packet.observationsPath);
    if (
      seed.hash !== packet.seedSha256 ||
      observations.hash !== packet.observationsSha256
    ) {
      throw new Error(
        'Indata har ändrats för ' +
          packet.packetId +
          '; skapa ett nytt granskat manifest.',
      );
    }
    inputs.push({
      packetId: packet.packetId,
      seed: seed.data,
      seedSha256: seed.hash,
      observations: observations.data,
    });
    bindings.push({
      ...packet,
      seedBytes: seed.bytes,
      observationsBytes: observations.bytes,
    });
  }
  return {
    ...prepareSequence(inputs, evaluatedAt),
    inputs: {
      manifestSha256: manifest.hash,
      manifestBytes: manifest.bytes,
      packets: bindings,
    },
  };
}

export function parseSequenceArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args[0] || args[0].startsWith('--'))
    throw new Error('Ange ett lokalt paketmanifest först.');
  const options = { manifestPath: args[0] };
  const flags = new Map([
    ['--at', 'evaluatedAt'],
    ['--engine-root', 'engineRoot'],
    ['--source-db', 'sourceDb'],
    ['--python', 'pythonPath'],
    ['--output', 'runName'],
  ]);
  for (let index = 1; index < args.length; index += 2) {
    const key = flags.get(args[index]);
    const value = args[index + 1];
    if (
      !key ||
      Object.hasOwn(options, key) ||
      !value ||
      value.startsWith('--')
    ) {
      throw new Error('Okänt, dubblerat eller ofullständigt argument.');
    }
    options[key] = value;
  }
  for (const key of ['evaluatedAt', 'engineRoot', 'sourceDb', 'pythonPath']) {
    if (!options[key]) throw new Error('Saknat obligatoriskt argument: ' + key);
  }
  if (options.runName && !ID.test(options.runName))
    throw new Error('Ogiltigt körnamn.');
  return options;
}

export async function main(args) {
  const options = parseSequenceArguments(args);
  if (options.help) {
    process.stdout.write(
      'Användning: node scripts/dry-run-company-sequence.mjs <manifest.json> --at <ISO> --engine-root <path> --source-db <SQLite> --python <executable> [--output <nytt-körnamn>]\n' +
        'En till tre paket, högst tre kandidater per paket, samma minneskopia och full återspelning. Ingen aktiv import.\n',
    );
    return;
  }
  const prepared = await loadSequence(
    options.manifestPath,
    options.evaluatedAt,
  );
  const simulation = await runWorker(prepared.request, options);
  const bundle = {
    version: 'divinelist.import-sequence-bundle.v1',
    status: simulation.status,
    plan: prepared.plan,
    plans: prepared.plans,
    inputs: prepared.inputs,
    simulation,
  };
  const output = options.runName
    ? await writeDryRun(bundle, options.runName)
    : {};
  process.stdout.write(
    JSON.stringify({ ...bundle, ...output }, null, 2) + '\n',
  );
  process.exitCode = simulation.status === 'PASS' ? 0 : 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        status: 'BLOCKED',
        message: error.message,
        partialOutput: error.partialOutput === true,
        ...(error.partialOutput
          ? {
              outputDirectory: error.outputDirectory,
              completedFiles: error.completedFiles,
              attemptedFiles: error.attemptedFiles,
            }
          : {}),
      }) + '\n',
    );
    process.exitCode = 2;
  }
}
