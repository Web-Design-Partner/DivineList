import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAutonomyPlan } from './lib/local-autonomy.mjs';
import {
  assertLocalPath,
  ensurePlainDirectory,
  readJson,
  rejectLinks,
  safeText,
} from './plan-local-work.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(PROJECT_ROOT, 'scripts', 'lib', 'import-dry-run.py');
const RUN_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const DRY_RUN_VERSION = 'divinelist.import-dry-run.v1';
export const SEQUENCE_REQUEST = 'divinelist.import-dry-run-sequence-request.v1';
export const SEQUENCE_VERSION = 'divinelist.import-dry-run-sequence.v1';

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args[0] || args[0].startsWith('--')) {
    throw new Error('Ange ett lokalt kandidatpaket som första argument.');
  }
  const options = { seedPath: args[0] };
  const flags = new Map([
    ['--at', 'evaluatedAt'],
    ['--observations', 'observationsPath'],
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
  for (const key of [
    'evaluatedAt',
    'observationsPath',
    'engineRoot',
    'sourceDb',
    'pythonPath',
  ]) {
    if (!options[key]) throw new Error('Saknat obligatoriskt argument: ' + key);
  }
  if (options.runName && !RUN_NAME.test(options.runName)) {
    throw new Error(
      'Ogiltigt körnamn; använd högst 80 tecken: a-z, 0-9, - och _.',
    );
  }
  return options;
}

export function prepareRequest({
  seed,
  seedSha256,
  observations,
  evaluatedAt,
}) {
  const plan = createAutonomyPlan({
    seed,
    seedSha256,
    observations,
    evaluatedAt,
  });
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(seed.wave_id)) {
    throw new Error(
      'Paketets wave_id kan inte användas som stabil importkälla.',
    );
  }
  const ready = new Set(
    plan.records
      .filter((record) => record.status === 'agent_ready_for_dry_run')
      .map((record) => record.sourceRecordId),
  );
  return {
    plan,
    request: {
      version: 'divinelist.import-dry-run-request.v1',
      seedSha256,
      planHash: plan.planHash,
      evaluatedAt,
      // Do not include the run name or time: unresolved IDs depend on this name.
      sourceName: 'divinelist-seeds:' + seed.wave_id,
      records: seed.records.filter((record) =>
        ready.has(record.source_record_id),
      ),
    },
  };
}

async function localEntry(path, directory = false) {
  const absolute = assertLocalPath(path);
  await rejectLinks(absolute);
  const metadata = await stat(absolute);
  if (directory ? !metadata.isDirectory() : !metadata.isFile()) {
    throw new Error(
      'Förväntad lokal ' + (directory ? 'katalog' : 'fil') + ' saknas.',
    );
  }
  return absolute;
}

export function validateWorkerResult(result, request) {
  const sequence = request.version === SEQUENCE_REQUEST;
  if (result.error || result.signal || ![0, 2].includes(result.status)) {
    throw new Error(
      'Provimporten avbröts eller misslyckades; inget PASS kan bekräftas.',
    );
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('Provimporten lämnade ingen giltig JSON-rapport.');
  }
  if (
    report.version !== (sequence ? SEQUENCE_VERSION : DRY_RUN_VERSION) ||
    !['PASS', 'BLOCKED', 'FAIL'].includes(report.status)
  ) {
    throw new Error('Provimportens rapportversion eller status är ogiltig.');
  }
  for (const key of ['seedSha256', 'planHash', 'evaluatedAt', 'sourceName']) {
    if (report[key] !== request[key]) {
      throw new Error(
        'Provimportens rapport är inte bunden till rätt underlag: ' + key,
      );
    }
  }
  const selectedIds = request.records.map((record) => record.source_record_id);
  if (
    JSON.stringify(report.selectedSourceRecordIds) !==
    JSON.stringify(selectedIds)
  ) {
    throw new Error(
      'Provimportens kandidaturval stämmer inte med arbetsplanen.',
    );
  }
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    }
    return value;
  };
  const { reportHash, ...payload } = report;
  const expectedHash =
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify(canonical(payload)))
      .digest('hex');
  if (reportHash !== expectedHash) {
    throw new Error('Provimportens kontrollsumma stämmer inte med rapporten.');
  }
  if ((report.status === 'PASS') !== (result.status === 0)) {
    throw new Error('Provimportens status och exitkod motsäger varandra.');
  }
  // The worker performs and reports the independent database safety checks.
  // A successful process alone must never be treated as sufficient evidence.
  if (report.status === 'PASS') {
    if (
      report.guardrails?.sourceReadOnly !== true ||
      report.guardrails?.simulationDatabase !== ':memory:' ||
      report.guardrails?.runtimeWrites !== false ||
      report.guardrails?.networkRequests !== false ||
      report.guardrails?.queueWrites !== false ||
      report.guardrails?.humanDecisionsRecorded !== false ||
      report.guardrails?.identityEligibilityChanged !== false ||
      report.guardrails?.outreachAuthorized !== false ||
      report.guardrails?.advertisingAuthorized !== false ||
      report.guardrails?.activeVaultWrites !== false ||
      report.source?.unchanged !== true ||
      report.source?.familyUnchanged !== true ||
      !/^sha256:[a-f0-9]{64}$/.test(report.source?.logicalBefore ?? '') ||
      report.source?.logicalBefore !== report.source?.logicalAfter ||
      JSON.stringify(canonical(report.source?.familyBefore)) !==
        JSON.stringify(canonical(report.source?.familyAfter)) ||
      report.idempotence?.structural !== true ||
      report.idempotence?.sourceObservations !== true ||
      report.idempotence?.timestampOnly !== true ||
      report.integrity?.integrityCheck !== 'PASS' ||
      report.integrity?.foreignKeys !== 'PASS'
    ) {
      throw new Error(
        'Provimportens skrivskydd eller köspärr kunde inte bekräftas.',
      );
    }
    for (const [index, imported] of [
      report.firstImport,
      report.secondImport,
    ].entries()) {
      if (
        imported?.read !== selectedIds.length ||
        imported?.queued !== 0 ||
        imported?.skipped !== 0 ||
        imported?.conflicts !== 0 ||
        imported?.imported !== (index === 0 ? selectedIds.length : 0) ||
        imported?.duplicates !== (index === 0 ? 0 : selectedIds.length)
      )
        throw new Error(
          'Provimportens räknare motsäger ett komplett, dubblettfritt test.',
        );
    }
    if (
      !Array.isArray(report.candidates) ||
      report.candidates.length !== selectedIds.length ||
      report.candidates.some(
        (record, index) =>
          record.sourceRecordId !== selectedIds[index] ||
          record.verificationStatus !== 'unresolved' ||
          record.gothenburgStatus !== 'unresolved' ||
          record.needsManualReview !== true ||
          record.domainConfidence !== 0 ||
          record.manualDecision !== 'pending' ||
          record.qualifiedForContact !== false,
      )
    )
      throw new Error(
        'Provimporten har inte bevarat kandidatens granskningsspärrar.',
      );
    if (sequence) {
      const packets = request.packets;
      const steps = report.sequence?.steps;
      if (
        report.sequence?.sameMemoryDatabase !== true ||
        JSON.stringify(report.sequence.packetOrder) !==
          JSON.stringify(packets.map((packet) => packet.packetId)) ||
        !Array.isArray(steps) ||
        steps.length !== packets.length * 2
      )
        throw new Error(
          'Hela paketföljden i samma minneskopia är inte bekräftad.',
        );
      let previous = report.source.logicalBefore;
      for (const [index, step] of steps.entries()) {
        const packet = packets[index % packets.length];
        const replay = index >= packets.length;
        const count = packet.records.length;
        if (
          step.packetId !== packet.packetId ||
          step.pass !== (replay ? 2 : 1) ||
          step.seedSha256 !== packet.seedSha256 ||
          step.planHash !== packet.planHash ||
          JSON.stringify(step.selectedSourceRecordIds) !==
            JSON.stringify(
              packet.records.map((record) => record.source_record_id),
            ) ||
          step.beforeLogicalHash !== previous ||
          !/^sha256:[a-f0-9]{64}$/.test(step.afterLogicalHash ?? '') ||
          step.import?.read !== count ||
          step.import?.imported !== (replay ? 0 : count) ||
          step.import?.duplicates !== (replay ? count : 0) ||
          step.import?.queued !== 0 ||
          step.import?.conflicts !== 0 ||
          step.import?.skipped !== 0 ||
          Date.parse(step.import?.simulatedAt) !==
            Date.parse(request.evaluatedAt) + index * 1000 ||
          !Array.isArray(step.diff)
        )
          throw new Error(
            'Paketsteg, ordning eller kontrollsumma saknas eller motsäger provimporten.',
          );
        const ordinary = step.diff.filter(
          (change) => change.table !== 'sqlite_sequence',
        );
        if (
          replay
            ? ordinary.some(
                (change) =>
                  change.created !== 0 ||
                  change.deleted !== 0 ||
                  !['companies', 'workplaces', 'workplace_sites'].includes(
                    change.table,
                  ) ||
                  JSON.stringify(change.changedColumns) !== '["updated_at"]',
              )
            : ordinary.some(
                (change) =>
                  change.updated !== 0 ||
                  change.deleted !== 0 ||
                  ![
                    'companies',
                    'workplaces',
                    'websites',
                    'workplace_sites',
                    'workplace_company_history',
                    'manual_fields',
                    'source_observations',
                    'source_evidence_urls',
                  ].includes(change.table),
              ) ||
              [
                'companies',
                'workplaces',
                'websites',
                'source_observations',
              ].some(
                (table) =>
                  ordinary.filter((change) => change.table === table).length !==
                    1 ||
                  ordinary.find((change) => change.table === table)?.created !==
                    count,
              )
        ) {
          throw new Error(
            'Paketstegets radändringar motsäger en säker provimport.',
          );
        }
        previous = step.afterLogicalHash;
      }
    }
  }
  return report;
}

export async function runWorker(request, options, execute = spawnSync) {
  const sequence = request.version === SEQUENCE_REQUEST;
  if (
    request.records.length < 1 ||
    request.records.length > (sequence ? 9 : 3)
  ) {
    throw new Error('Provimporten kräver en till tre klara kandidater.');
  }
  if (
    sequence &&
    (!Array.isArray(request.packets) ||
      request.packets.length < 1 ||
      request.packets.length > 3 ||
      request.packets.some(
        (packet) =>
          !Array.isArray(packet.records) ||
          packet.records.length < 1 ||
          packet.records.length > 3,
      ))
  ) {
    throw new Error('Paketföljden kräver en till tre små kandidatpaket.');
  }
  const python = await localEntry(options.pythonPath);
  const engineRoot = await localEntry(options.engineRoot, true);
  const sourceDb = await localEntry(options.sourceDb);
  const worker = await localEntry(WORKER);
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const result = execute(
    python,
    ['-B', '-I', worker, '--engine-root', engineRoot, '--source-db', sourceDb],
    {
      input: JSON.stringify(request),
      encoding: 'utf8',
      env,
      cwd: PROJECT_ROOT,
      shell: false,
      windowsHide: true,
      timeout: 40_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return validateWorkerResult(result, request);
}

export function renderDryRun(bundle) {
  const { plan, simulation } = bundle;
  const selected = new Set(simulation.selectedSourceRecordIds ?? []);
  const labels = {
    agent_ready_for_dry_run: 'Klar för lokal provimport',
    agent_research: 'Utred vidare',
    agent_deferred: 'Parkerad',
    agent_excluded: 'Utesluten från urvalet',
  };
  const candidates = plan.records.map(
    (record) =>
      '| ' +
      safeText(record.companyName) +
      ' | ' +
      (selected.has(record.sourceRecordId)
        ? simulation.status === 'PASS'
          ? 'Provad endast i minnet'
          : 'Vald – simuleringen inte godkänd'
        : 'Inte provimporterad') +
      ' | ' +
      safeText(labels[record.status] ?? record.status) +
      ' |',
  );
  const importSummary = (result) =>
    result
      ? [
          safeText(result.read) + ' kandidatposter lästa',
          safeText(result.imported) + ' nya källposter',
          safeText(result.duplicates) + ' redan kända källposter',
          safeText(result.conflicts) + ' konflikter',
          safeText(result.queued) + ' insamlingsjobb',
        ].join(', ') + '.'
      : 'Ingen fullständig provimport bekräftad.';
  const tableLabels = {
    companies: 'Företag',
    workplaces: 'Arbetsställen',
    websites: 'Webbplatser',
    workplace_sites: 'Koppling arbetsställe–webbplats',
    workplace_company_history: 'Bolagskopplingens historik',
    manual_fields: 'Väntande granskningsstatus',
    source_observations: 'Källobservationer',
    source_evidence_urls: 'Källänkar',
    sqlite_sequence: 'Databasens interna nummerföljd',
  };
  return [
    '# DivineList – isolerad provimport',
    '',
    'Status: ' +
      safeText(simulation.status) +
      '. Bedömningstid: ' +
      safeText(plan.evaluatedAt),
    '',
    'Detta är en simulering, inte en import till den aktiva databasen.',
    ...(simulation.version === SEQUENCE_VERSION
      ? [
          'Paketen körs i angiven ordning i samma minneskopia och hela följden upprepas.',
          'Paketordning: ' +
            (simulation.sequence?.packetOrder ?? []).map(safeText).join(' → '),
          'Sammanhängande paketföljd bekräftad: ' +
            (simulation.status === 'PASS' ? 'ja' : 'nej') +
            '.',
        ]
      : []),
    'Agenten valde själv endast kandidater med komplett lokalt förberedelseunderlag.',
    '',
    '| Företag | Provimport | Lokal förberedelsestatus |',
    '| --- | --- | --- |',
    ...candidates,
    '',
    '## Resultat',
    '',
    ...(simulation.reason ? ['Orsak: ' + safeText(simulation.reason), ''] : []),
    'Första importen i minnet: ' + importSummary(simulation.firstImport),
    '',
    'Upprepad import i samma minnesdatabas: ' +
      importSummary(simulation.secondImport),
    '',
    simulation.idempotence?.structural === true &&
    simulation.idempotence?.sourceObservations === true
      ? 'Upprepningen skapade inga nya företag eller källobservationer.'
      : 'Dubblettfri upprepning är inte bekräftad.',
    simulation.idempotence?.exactRows === false &&
    simulation.idempotence?.timestampOnly === true
      ? 'Tidsstämplar ändrades vid upprepningen. Databasens interna nummerföljd kan också ändras; helt identiska rader utlovas därför inte.'
      : 'Exakta radförändringar framgår av JSON-rapporten.',
    '',
    'Fullständiga tabellskillnader, kontrollsummor och begränsningar finns i import-dry-run.json.',
    '',
    '| Tabell | Nya poster i minneskopian | Uppdaterade | Borttagna |',
    '| --- | --- | --- | --- |',
    ...(simulation.diff?.first ?? []).map(
      (change) =>
        '| ' +
        safeText(tableLabels[change.table] ?? change.table) +
        ' | ' +
        safeText(change.created) +
        ' | ' +
        safeText(change.updated) +
        ' | ' +
        safeText(change.deleted) +
        ' |',
    ),
    '',
    'Aktiv databas logiskt oförändrad före/efter: ' +
      (simulation.source?.unchanged === true
        ? 'verifierat'
        : 'inte bekräftat') +
      '.',
    'Databasfil och befintliga sidfiler oförändrade vid kontrollpunkterna: ' +
      (simulation.source?.familyUnchanged === true
        ? 'verifierat'
        : 'inte bekräftat') +
      '.',
    '',
    'Ingen verifieringsflagga har höjts för att göra kandidaten algoritm- eller kontaktklar.',
    '',
    '## Gränser',
    '',
    '- Endast motorns granskade importfunktion körs mot en kopia i arbetsminnet.',
    '- Den aktiva databasen öppnas skrivskyddat. Inga insamlingsjobb, utskick eller annonser startas.',
    '- Inga riktiga mänskliga reviews, runtimegodkännanden eller aktiva valvfiler skapas.',
    '- En godkänd simulering är inte tillstånd för en verklig runtimeimport.',
    '- Kontaktspärrkontrollen gäller endast den angivna databasen, inte andra CRM eller register.',
    '',
    'Kandidatpaket: ' + safeText(plan.seedSha256),
    '',
    'Arbetsplan: ' + safeText(plan.planHash),
    '',
  ].join('\n');
}

export async function writeDryRun(
  bundle,
  runName,
  projectRoot = PROJECT_ROOT,
  write = writeFile,
) {
  if (typeof runName !== 'string' || !RUN_NAME.test(runName)) {
    throw new Error('Ogiltigt körnamn.');
  }
  const json = JSON.stringify(bundle, null, 2) + '\n';
  const markdown = renderDryRun(bundle);
  const localRoot = assertLocalPath(projectRoot);
  await rejectLinks(localRoot);
  const root = await realpath(localRoot);
  const reportsRoot = join(root, 'reports');
  await ensurePlainDirectory(reportsRoot);
  const runsRoot = join(reportsRoot, 'import-dry-run');
  await ensurePlainDirectory(runsRoot);
  const outputDirectory = join(runsRoot, runName);
  await mkdir(outputDirectory);
  const files = [
    join(outputDirectory, 'import-dry-run.json'),
    join(outputDirectory, 'IMPORT_DRY_RUN.md'),
  ];
  const completedFiles = [];
  try {
    await write(files[0], json, { flag: 'wx' });
    completedFiles.push(files[0]);
    await write(files[1], markdown, { flag: 'wx' });
    completedFiles.push(files[1]);
  } catch (error) {
    Object.assign(error, {
      partialOutput: true,
      outputDirectory,
      completedFiles,
      attemptedFiles: files,
    });
    throw error;
  }
  return { outputDirectory, files };
}

export async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write(
      'Användning: npm run dry-run:company-seeds -- <seed.json> --observations <file> --at <ISO> --engine-root <path> --source-db <SQLite> --python <executable> [--output <nytt-körnamn>]\n' +
        'Endast en till tre agentklara kandidater provas i en minneskopia. Aktiv DB öppnas skrivskyddat; köer och nätverk används inte.\n' +
        'Utan --output skrivs bara JSON. Rapporter sparas annars i en NY katalog under reports/import-dry-run.\n',
    );
    return;
  }
  const seed = await readJson(options.seedPath);
  const observations = await readJson(options.observationsPath);
  const { plan, request } = prepareRequest({
    seed: seed.data,
    seedSha256: seed.hash,
    observations: observations.data,
    evaluatedAt: options.evaluatedAt,
  });
  if (request.records.length === 0) {
    process.stdout.write(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: 'Ingen kandidat har komplett lokalt underlag för provimport.',
          plan,
          workerStarted: false,
          databaseReads: false,
          runtimeWrites: false,
          networkRequests: false,
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 2;
    return;
  }
  const simulation = await runWorker(request, options);
  const bundle = {
    version: 'divinelist.import-dry-run-bundle.v1',
    status: simulation.status,
    plan,
    simulation,
    inputs: {
      seedBytes: seed.bytes,
      seedSha256: seed.hash,
      observationsSha256: observations.hash,
    },
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
        status: 'FAIL',
        message:
          error.code === 'EEXIST' && !error.partialOutput
            ? 'Körnamnet finns redan. Befintliga rapporter har inte skrivits över.'
            : error.message,
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
