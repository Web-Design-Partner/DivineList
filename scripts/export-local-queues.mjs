import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKET_VERSION = 'divinelist.local-review-queue.v1';
const ADVERTISING_VERSION = 'divinelist.local-advertising-queue.v1';
const CURRENT_RULESET = 'divinelist.rules.v1.2.0';
const DEFAULT_REVIEW_QUEUE_LIMIT = 5000;
const DEFAULT_QUEUE_MAX_BUFFER_MB = 64;
const severityOrder = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArguments(argv) {
  if (argv.length === 4 || argv.length === 5) {
    return {
      'engine-root': argv[0],
      batch: argv[1],
      result: argv[2],
      output: argv[3],
      ...(argv[4] ? { 'generated-at': argv[4] } : {}),
      'review-queue-limit': optionsFromEnv(
        'review-queue-limit',
        DEFAULT_REVIEW_QUEUE_LIMIT,
      ),
    };
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      fail(`Okänt argument: ${argument}`);
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Argumentet --${name} saknar värde.`);
    }
    options[name] = value;
    index += 1;
  }

  for (const required of ['engine-root', 'batch', 'result', 'output']) {
    if (!options[required]) {
      fail(
        `Användning: node scripts/export-local-queues.mjs ` +
          `<motorkatalog> <batch.json> <resultat.json> <målkatalog> ` +
          `[ISO-tid] [--review-queue-limit <antal>]\neller med ` +
          'namngivna argument: ' +
          `--engine-root <sökväg> --batch <batch.json> ` +
          `--result <resultat.json> --output <katalog> ` +
          `[--generated-at <ISO-tid>] [--review-queue-limit <antal>]` +
          `\nMiljövariabel: DIVINELIST_REVIEW_QUEUE_LIMIT=${DEFAULT_REVIEW_QUEUE_LIMIT}.` +
          `\nSaknat: --${required}`,
      );
    }
  }
  return options;
}

function optionsFromEnv(name, fallback) {
  const value =
    process.env[`DIVINELIST_${name.replaceAll('-', '_').toUpperCase()}`];
  if (!value) {
    return fallback;
  }
  return value;
}

function parsePositiveInteger(value, label, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    if (value === undefined) {
      return fallback;
    }
    fail(`${label} måste vara ett heltal > 0. Mottog: ${String(value)}`);
  }
  return parsed;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  return {
    bytes,
    data: JSON.parse(text),
  };
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} matchar inte: ${String(actual)} != ${String(expected)}`);
  }
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, 'sv'),
    ),
  );
}

function md(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function queueFromEngine(engineRoot, reviewQueueLimit) {
  const runner = join(engineRoot, 'run-engine.ps1');
  if (!existsSync(runner)) {
    fail(`Motorns startfil saknas: ${runner}`);
  }
  const configuredMaxBufferMb = parsePositiveInteger(
    process.env.DIVINELIST_REVIEW_QUEUE_MAX_BUFFER_MB,
    'DIVINELIST_REVIEW_QUEUE_MAX_BUFFER_MB',
    DEFAULT_QUEUE_MAX_BUFFER_MB,
  );
  const maxBuffer =
    Math.min(Math.max(configuredMaxBufferMb, 16), 512) * 1024 * 1024;
  const process = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      runner,
      'review-queue',
      '--limit',
      String(reviewQueueLimit),
    ],
    {
      cwd: engineRoot,
      encoding: 'utf8',
      maxBuffer,
      windowsHide: true,
    },
  );
  if (process.error) {
    fail(`Kunde inte läsa granskningskön: ${process.error.message}`);
  }
  if (process.status !== 0) {
    fail(
      `Kunde inte läsa granskningskön.\n${process.stderr || process.stdout}`,
    );
  }
  const output = process.stdout.replace(/^\uFEFF/, '').trim();
  const queue = JSON.parse(output);
  if (!Array.isArray(queue)) {
    fail('Motorns review-queue returnerade inte en JSON-array.');
  }
  return { queue, output };
}

function buildMarkdown(packet, advertising) {
  const lines = [
    '# Lokal gransknings- och annonseringskö',
    '',
    `Genererad: \`${packet.generatedAt}\``,
    '',
    '> Detta är beslutsstöd, inte bekräftade webbplatsfel. Inga mänskliga ' +
      'beslut har registrerats och ingen kontakt, annonsering eller publicering ' +
      'är godkänd.',
    '',
    '## Förseglad källa',
    '',
    '| Fält | Värde |',
    '| --- | --- |',
    `| Regelsystem | \`${md(packet.source.rulesetVersion)}\` |`,
    `| Audit | \`${md(packet.source.auditRunUid)}\` |`,
    `| Export | \`${md(packet.source.exportId)}\` |`,
    `| Batch | \`${md(packet.source.batchId)}\` |`,
    `| Dataset-hash | \`${md(packet.source.datasetHash)}\` |`,
    `| Resultat-hash | \`${md(packet.source.resultHash)}\` |`,
    `| Utvärderad | \`${md(packet.source.evaluatedAt)}\` |`,
    '',
    '## Status',
    '',
    '| Kö | Status | Poster | Betydelse |',
    '| --- | --- | ---: | --- |',
    `| Mänsklig granskning | \`${packet.status}\` | ${packet.summary.total} | ` +
      'Prioriterad lokal arbetslista |',
    `| Lokal annonsering | \`${advertising.status}\` | ` +
      `${advertising.candidates.length} | Hålls tom tills alla grindar är uppfyllda |`,
    `| Granskningskö-gräns | \`--limit ${String(packet.source.reviewQueueLimit ?? '5000')}\` | ${packet.summary.total} | ` +
      'Begränsning i körd granskning för spårbar export |',
    '',
    '### Resultatbild',
    '',
    `- Totalt utvärderade regelresultat: ${packet.summary.allResults}.`,
    `- Avgörande resultat: ${packet.summary.decisiveResults}.`,
    `- \`needs_review\`: ${packet.summary.resultStates.needs_review ?? 0}.`,
    `- \`not_tested\`: ${packet.summary.resultStates.not_tested ?? 0}.`,
    `- Aktiva regler i körningen: ${packet.summary.activeRuleResults}.`,
    `- Väntande mänskliga beslut: ${packet.summary.total}.`,
    `- Köposter med minst en accepterad evidensreferens: ` +
      `${packet.summary.itemsWithAcceptedEvidence}.`,
    `- Köposter utan accepterad evidensreferens: ` +
      `${packet.summary.itemsWithoutAcceptedEvidence}.`,
    '',
    '## Kö per företag',
    '',
    '| Företag | Domän | Kritisk | Hög | Medel | Låg | Totalt |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const company of packet.companies) {
    lines.push(
      `| ${md(company.name)} | ${md(company.domain)} | ` +
        `${company.severities.critical ?? 0} | ${company.severities.high ?? 0} | ` +
        `${company.severities.medium ?? 0} | ${company.severities.low ?? 0} | ` +
        `${company.total} |`,
    );
  }

  lines.push('', '## Detaljerad mänsklig arbetslista', '');
  for (const company of packet.companies) {
    lines.push(
      `### ${md(company.name)} — ${company.total} poster`,
      '',
      `Arbetsställe: \`${md(company.workplaceUid)}\`  `,
      `Domän: \`${md(company.domain)}\``,
      '',
    );
    for (const item of company.items) {
      lines.push(
        `${item.rank}. **[${item.severity.toUpperCase()}] ` +
          `${md(item.ruleId)} — ${md(item.title)}**`,
        '',
        `   Status: \`${md(item.reviewState)} / ${md(item.resultStatus)} / ` +
          `${md(item.executionStatus)}\`. Accepterad evidens: ` +
          `${item.acceptedEvidenceCount}; avvisad evidens: ` +
          `${item.rejectedEvidenceCount}.`,
        '',
        `   Begränsning: ${md(item.limitations.join(' ')) || 'Ej angiven.'}`,
        '',
        `   Manuell kontroll: ${md(item.manualCheck)}`,
        '',
      );
    }
  }

  lines.push(
    '## Varför annonseringskön är tom',
    '',
    ...advertising.blockers.map(
      (blocker) => `- \`${blocker.code}\`: ${blocker.detail}`,
    ),
    '',
    'Nästa tillåtna steg är mänsklig granskning och bättre källbunden evidens. ' +
      'Det är inte tillåtet att översätta `needs_review`, `not_tested`, blockerad ' +
      'insamling eller regelallvarlighet till ett negativt säljpåstående.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

const options = parseArguments(process.argv.slice(2));
const engineRoot = resolve(options['engine-root']);
const batchPath = resolve(options.batch);
const resultPath = resolve(options.result);
const outputDirectory = resolve(options.output);
const generatedAt = options['generated-at'] ?? new Date().toISOString();

if (Number.isNaN(Date.parse(generatedAt))) {
  fail('--generated-at måste vara en giltig ISO-tid.');
}

const batchFile = readJson(batchPath);
const resultFile = readJson(resultPath);
const batch = batchFile.data;
const resultEnvelope = resultFile.data;
const reviewQueueLimit = parsePositiveInteger(
  options['review-queue-limit'],
  '--review-queue-limit',
  optionsFromEnv('review-queue-limit', DEFAULT_REVIEW_QUEUE_LIMIT),
);
const engineQueue = queueFromEngine(engineRoot, reviewQueueLimit);

for (const field of [
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
  'rulesetVersion',
  'mappingVersion',
]) {
  assertEqual(resultEnvelope[field], batch[field], `Bindning ${field}`);
}
assertEqual(batch.rulesetVersion, CURRENT_RULESET, 'Aktuellt regelsystem');

const companies = new Map(
  batch.companies.map((company) => [company.workplaceUid, company]),
);
const evaluatedCompanies = new Map(
  resultEnvelope.companies.map((entry) => [entry.company.workplaceUid, entry]),
);
const auditRunUids = [
  ...new Set(engineQueue.queue.map((item) => item.audit_run_uid)),
];
const evaluatedAtValues = [
  ...new Set(engineQueue.queue.map((item) => item.evaluated_at)),
];

if (auditRunUids.length !== 1 || evaluatedAtValues.length !== 1) {
  fail(
    'Kön måste vara bunden till exakt en aktuell audit och utvärderingstid.',
  );
}

let rank = 0;
const items = engineQueue.queue.map((queueItem) => {
  assertEqual(
    queueItem.ruleset_version,
    batch.rulesetVersion,
    `Regelsystem för ${queueItem.execution_uid}`,
  );
  const company = companies.get(queueItem.workplace_uid);
  const evaluatedCompany = evaluatedCompanies.get(queueItem.workplace_uid);
  if (!company || !evaluatedCompany) {
    fail(`Köposten saknas i exakt batch/resultat: ${queueItem.workplace_uid}`);
  }
  const matches = evaluatedCompany.results.filter(
    (candidate) =>
      candidate.ruleId === queueItem.rule_id &&
      candidate.ruleVersion === queueItem.rule_version &&
      candidate.ruleContentHash === queueItem.rule_content_hash &&
      candidate.inputHash === queueItem.input_hash &&
      candidate.rulesetVersion === queueItem.ruleset_version,
  );
  if (matches.length !== 1) {
    fail(
      `Köposten matchar ${matches.length} resultat: ${queueItem.execution_uid}`,
    );
  }
  const evaluated = matches[0];
  assertEqual(
    evaluated.state,
    queueItem.result_status,
    `Resultatstatus för ${queueItem.execution_uid}`,
  );
  assertEqual(
    evaluated.executionStatus,
    queueItem.execution_status,
    `Körstatus för ${queueItem.execution_uid}`,
  );
  rank += 1;
  return {
    rank,
    executionUid: queueItem.execution_uid,
    auditRunUid: queueItem.audit_run_uid,
    workplaceUid: queueItem.workplace_uid,
    websiteUid: queueItem.website_uid,
    companyName: company.name,
    domain: company.domain,
    ruleId: queueItem.rule_id,
    ruleVersion: queueItem.rule_version,
    ruleContentHash: queueItem.rule_content_hash,
    inputHash: queueItem.input_hash,
    rulesetVersion: queueItem.ruleset_version,
    category: evaluated.category,
    rootCause: evaluated.rootCause,
    title: evaluated.title,
    severity: queueItem.severity,
    ruleTier: evaluated.ruleTier,
    ruleLifecycle: evaluated.ruleLifecycle,
    evaluationMode: evaluated.evaluationMode,
    resultStatus: queueItem.result_status,
    executionStatus: queueItem.execution_status,
    reviewState: queueItem.review_state,
    confidence: queueItem.confidence,
    evaluatedAt: queueItem.evaluated_at,
    renderFidelity: evaluated.renderFidelity,
    coverage: evaluated.coverage,
    acceptedEvidenceCount: asArray(evaluated.acceptedEvidenceIds).length,
    rejectedEvidenceCount: asArray(evaluated.rejectedEvidence).length,
    rejectedEvidenceReasons: countBy(
      asArray(evaluated.rejectedEvidence),
      (entry) => entry.reason,
    ),
    limitations: asArray(evaluated.limitations),
    manualCheck: evaluated.manualCheck,
    recommendation: evaluated.recommendation,
    classification: 'unconfirmed_human_review_required',
  };
});

items.sort(
  (left, right) =>
    (severityOrder.get(left.severity) ?? 99) -
      (severityOrder.get(right.severity) ?? 99) ||
    left.companyName.localeCompare(right.companyName, 'sv') ||
    left.ruleId.localeCompare(right.ruleId, 'sv'),
);
items.forEach((item, index) => {
  item.rank = index + 1;
});

const groupedCompanies = [...companies.values()]
  .map((company) => {
    const companyItems = items.filter(
      (item) => item.workplaceUid === company.workplaceUid,
    );
    return {
      workplaceUid: company.workplaceUid,
      websiteUid: company.siteUid,
      name: company.name,
      domain: company.domain,
      total: companyItems.length,
      severities: countBy(companyItems, (item) => item.severity),
      categories: countBy(companyItems, (item) => item.category),
      items: companyItems,
    };
  })
  .filter((company) => company.total > 0)
  .sort(
    (left, right) =>
      Math.min(
        ...left.items.map((item) => severityOrder.get(item.severity) ?? 99),
      ) -
        Math.min(
          ...right.items.map((item) => severityOrder.get(item.severity) ?? 99),
        ) ||
      right.total - left.total ||
      left.name.localeCompare(right.name, 'sv'),
  );

const allResults = resultEnvelope.companies.flatMap((entry) => entry.results);
const resultStates = countBy(allResults, (item) => item.state);
const decisiveStates = new Set(['detected', 'not_detected', 'not_applicable']);
const decisiveResults = allResults.filter((item) =>
  decisiveStates.has(item.state),
).length;
const activeRuleResults = allResults.filter(
  (item) => item.ruleLifecycle === 'active',
).length;

const source = {
  rulesetVersion: batch.rulesetVersion,
  auditRunUid: auditRunUids[0],
  evaluatedAt: evaluatedAtValues[0],
  exportId: batch.exportId,
  batchId: batch.batchId,
  batchHash: batch.batchHash,
  datasetHash: batch.datasetHash,
  resultHash: resultEnvelope.resultHash,
  batchPath,
  reviewQueueLimit,
  batchFileSha256: sha256(batchFile.bytes),
  resultPath,
  resultFileSha256: sha256(resultFile.bytes),
  engineQueueSha256: sha256(Buffer.from(engineQueue.output, 'utf8')),
};
const candidateRunSummary = {
  total: allResults.length,
  decisive: decisiveResults,
  active: activeRuleResults,
};

const reviewPacket = {
  version: PACKET_VERSION,
  generatedAt,
  status: items.length > 0 ? 'human_review_required' : 'empty',
  source,
  guardrails: {
    decisionsRecorded: false,
    humanDecisionRequired: true,
    confirmedFindings: 0,
    advertisingAuthorized: false,
    outreachAuthorized: false,
    publicationAuthorized: false,
  },
  summary: {
    total: items.length,
    companies: groupedCompanies.length,
    reviewStates: countBy(items, (item) => item.reviewState),
    resultStates,
    executionStates: countBy(allResults, (item) => item.executionStatus),
    severities: countBy(items, (item) => item.severity),
    categories: countBy(items, (item) => item.category),
    evaluationModes: countBy(items, (item) => item.evaluationMode),
    allResults: allResults.length,
    decisiveResults,
    activeRuleResults,
    itemsWithAcceptedEvidence: items.filter(
      (item) => item.acceptedEvidenceCount > 0,
    ).length,
    itemsWithoutAcceptedEvidence: items.filter(
      (item) => item.acceptedEvidenceCount === 0,
    ).length,
  },
  companies: groupedCompanies,
};

const advertisingPacket = {
  version: ADVERTISING_VERSION,
  generatedAt,
  status: 'blocked_not_ready',
  source,
  guardrails: {
    failClosed: true,
    advertisingAuthorized: false,
    outreachAuthorized: false,
    humanApprovalRequired: true,
  },
  candidates: [],
  blockers: [
    {
      code: 'NO_DECISIVE_CURRENT_RESULTS',
      detail:
        `${candidateRunSummary.decisive} av ${candidateRunSummary.total} resultat ` +
        'är avgörande (detekterad, ej detekterad, ej tillämplig).',
    },
    {
      code: 'NO_ACTIVE_RULES',
      detail:
        `${candidateRunSummary.active} av ${candidateRunSummary.total} resultat ` +
        'kommer från aktiva regler.',
    },
    {
      code: 'HUMAN_REVIEW_PENDING',
      detail:
        `${items.length} aktuella resultat är av viss kvalitet men kräver mänsklig ` +
        'granskning innan beslutsstöd.',
    },
    {
      code: 'NO_CONTACT_OR_ADVERTISING_AUTHORIZATION',
      detail:
        'Den lokala auditkedjan ger varken kontakt- eller annonseringstillstånd.',
    },
  ],
  readyOnlyWhen: [
    'avgörande resultat har komplett, källbunden evidens',
    'en namngiven människa har granskat de exakta resultaten',
    'en separat policy uttryckligen tillåter urvalet',
    'kontakt eller annonsering har godkänts separat av användaren',
  ],
};

mkdirSync(outputDirectory, { recursive: true });
const reviewPath = join(outputDirectory, 'local-review-queue.json');
const advertisingPath = join(outputDirectory, 'local-advertising-queue.json');
const markdownPath = join(outputDirectory, 'LOCAL_QUEUE_REPORT.md');
writeFileSync(reviewPath, `${JSON.stringify(reviewPacket, null, 2)}\n`, 'utf8');
writeFileSync(
  advertisingPath,
  `${JSON.stringify(advertisingPacket, null, 2)}\n`,
  'utf8',
);
writeFileSync(
  markdownPath,
  buildMarkdown(reviewPacket, advertisingPacket),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      reviewItems: items.length,
      companies: groupedCompanies.length,
      reviewQueueLimit,
      reviewQueueSize: engineQueue.queue.length,
      advertisingCandidates: advertisingPacket.candidates.length,
      sourceBatch: basename(batchPath),
      outputDirectory,
      files: [reviewPath, advertisingPath, markdownPath],
    },
    null,
    2,
  ),
);
