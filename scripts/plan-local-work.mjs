import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAutonomyPlan } from './lib/local-autonomy.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_INPUT_BYTES = 256_000;
const RUN_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const sha256 = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args[0] || args[0].startsWith('--')) {
    throw new Error('Ange ett lokalt kandidatpaket som första argument.');
  }
  const options = { seedPath: args[0] };
  const flags = new Map([
    ['--at', 'evaluatedAt'],
    ['--observations', 'observationsPath'],
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
  if (!options.evaluatedAt)
    throw new Error('En explicit ISO-tid krävs med --at.');
  if (options.runName && !RUN_NAME.test(options.runName)) {
    throw new Error(
      'Körnamnet får bara innehålla a-z, 0-9, bindestreck och understreck, högst 80 tecken.',
    );
  }
  return options;
}

export function assertLocalPath(path) {
  if (typeof path !== 'string' || !path || /^[\\/]{2}/.test(path)) {
    throw new Error('Nätverks- och enhetssökvägar är inte tillåtna.');
  }
  const absolute = resolve(path);
  if (
    process.platform === 'win32' &&
    parse(absolute).root.toLowerCase() !==
      parse(PROJECT_ROOT).root.toLowerCase()
  ) {
    throw new Error('Indata måste finnas på projektets lokala enhet.');
  }
  return absolute;
}

export async function rejectLinks(path) {
  const root = parse(path).root;
  let current = root;
  for (const component of relative(root, path).split(sep)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(
        'Indata och rapportrot får inte passera symboliska länkar.',
      );
    }
  }
}

export async function readJson(inputPath) {
  const path = assertLocalPath(inputPath);
  await rejectLinks(path);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error(
      'Indata måste vara en vanlig JSON-fil på högst 256 000 byte.',
    );
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_INPUT_BYTES)
    throw new Error('Indata är för stor.');
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Indata är inte giltig UTF-8 och JSON.');
  }
  return { data, hash: sha256(bytes), bytes: bytes.byteLength };
}

export const safeText = (value) =>
  Array.from(String(value).replace(/[\r\n\t]/g, ' '))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && !(code >= 127 && code <= 159);
    })
    .join('')
    .replace(/[&<>|`[\]\\*_]/g, (character) => `&#${character.charCodeAt(0)};`);

export function renderPlan(plan) {
  const statuses = {
    agent_ready_for_dry_run: 'Förbered provimport',
    agent_research: 'Utred vidare',
    agent_deferred: 'Parkerad',
    agent_excluded: 'Utesluten från denna arbetsvåg',
  };
  const actions = {
    prepare_import_dry_run:
      'Förbered en isolerad provimport; ändra inte runtime.',
    research_public_company:
      'Komplettera källor och kontroller utan rutinfråga.',
    research_or_replace_candidate:
      'Utred vid behov eller gå vidare med en annan kandidat.',
    skip_candidate: 'Hoppa över kandidaten och bevara skälet.',
  };
  const rows = plan.records.map(
    (record) =>
      `| ${safeText(record.companyName)} | ${safeText(statuses[record.status] ?? record.status)} | ${safeText(actions[record.nextAction] ?? record.nextAction)} |`,
  );
  const pauses = plan.records.filter((record) => record.researchPause);
  const pauseDetails = pauses.length
    ? [
        '## Parkerade utredningar',
        '',
        'Arbeta vidare med andra kandidater. Dessa utredningar återupptas först när nytt underlag kan prövas mot villkoret; en ny körtid tar inte bort pausen.',
        '',
        ...pauses.flatMap((record) => [
          `### ${safeText(record.companyName)}`,
          '',
          `Skäl: ${safeText(record.researchPause.reason)}`,
          '',
          `Återuppta när: ${safeText(record.researchPause.resumeWhen)}`,
          '',
        ]),
      ]
    : [];
  return [
    '# DivineList – agentens lokala arbetsplan',
    '',
    `Bedömningstid: ${safeText(plan.evaluatedAt)}`,
    '',
    'Agenten äger följande förberedelser. Inget rutinbeslut begärs av användaren.',
    'Planen kör inte research eller import och är inte ett identitets-, gransknings- eller kontaktgodkännande.',
    '',
    '| Företag | Lokal arbetsstatus | Agentens nästa steg |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `Totalt: ${plan.summary.total}. Förbered provimport: ${plan.summary.readyForDryRun}. Utred: ${plan.summary.research}. Parkerade: ${plan.summary.deferred}. Uteslutna: ${plan.summary.excluded}.`,
    '',
    ...pauseDetails,
    '## Kvarvarande gränser',
    '',
    '- Inga verifieringsfält, verkliga mänskliga beslut eller befintliga köer ändras.',
    '- Inga databas-, nätverks-, kontakt-, annonserings- eller publiceringsåtgärder utförs.',
    '- En parkerad kandidat stoppar inte arbete med andra kandidater.',
    '- Ett klart förberedelseunderlag innebär inte att runtimeimport är tillåten.',
    '',
    `Kandidatpaketets SHA-256: ${plan.seedSha256}`,
    '',
    `Planens SHA-256: ${plan.planHash}`,
    '',
  ].join('\n');
}

export async function ensurePlainDirectory(path) {
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      'Rapportens överordnade katalog får inte vara en fil eller symbolisk länk.',
    );
  }
}

export async function writeNewPlan(
  plan,
  runName,
  projectRoot = PROJECT_ROOT,
  write = writeFile,
) {
  if (typeof runName !== 'string' || !RUN_NAME.test(runName))
    throw new Error('Ogiltigt körnamn.');
  // Prepare both representations before creating any directories.
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  const markdown = renderPlan(plan);
  const localRoot = assertLocalPath(projectRoot);
  await rejectLinks(localRoot);
  const root = await realpath(localRoot);
  const reportsRoot = join(root, 'reports');
  await ensurePlainDirectory(reportsRoot);
  const autonomyRoot = join(reportsRoot, 'autonomy');
  await ensurePlainDirectory(autonomyRoot);
  const outputDirectory = join(autonomyRoot, runName);
  // Non-recursive creation refuses existing runs, including links. Never overwrite.
  await mkdir(outputDirectory);
  const planPath = join(outputDirectory, 'local-work-plan.json');
  const markdownPath = join(outputDirectory, 'LOCAL_WORK_PLAN.md');
  const completedFiles = [];
  try {
    await write(planPath, json, { flag: 'wx' });
    completedFiles.push(planPath);
    await write(markdownPath, markdown, { flag: 'wx' });
    completedFiles.push(markdownPath);
  } catch (error) {
    error.partialOutput = true;
    error.outputDirectory = outputDirectory;
    error.completedFiles = completedFiles;
    error.attemptedFiles = [planPath, markdownPath];
    throw error;
  }
  return { outputDirectory, files: [planPath, markdownPath] };
}

export async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write(
      'Användning: npm run plan:local-work -- <seed.json> --at <ISO-tid> [--observations <bedömningar.json>] [--output <nytt-körnamn>]\n' +
        'Utan --output skrivs endast JSON till stdout. Med --output skapas en ny katalog under reports/autonomy.\n' +
        'Ingen nätverkstrafik, databasimport, faktisk provimport eller mänskligt beslut utförs.\n',
    );
    return;
  }
  const seed = await readJson(options.seedPath);
  const observations = options.observationsPath
    ? await readJson(options.observationsPath)
    : null;
  const plan = createAutonomyPlan({
    seed: seed.data,
    seedSha256: seed.hash,
    observations: observations?.data,
    evaluatedAt: options.evaluatedAt,
  });
  const output = options.runName
    ? await writeNewPlan(plan, options.runName)
    : {};
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'PASS',
        plan,
        inputs: {
          seedBytes: seed.bytes,
          seedSha256: seed.hash,
          observationsSha256: observations?.hash ?? null,
        },
        ...output,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'FAIL',
        message:
          error.code === 'EEXIST' && !error.partialOutput
            ? 'Körnamnet finns redan. Befintliga rapporter har inte skrivits över.'
            : error.message,
        databaseWrites: false,
        networkRequests: false,
        decisionsRecorded: false,
        partialOutput: error.partialOutput === true,
        ...(error.partialOutput
          ? {
              outputDirectory: error.outputDirectory,
              completedFiles: error.completedFiles,
              attemptedFiles: error.attemptedFiles,
            }
          : {}),
      })}\n`,
    );
    process.exitCode = 2;
  }
}
