import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import {
  MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES,
  MAX_PRODUCTION_STATUS_AGE_MS,
  MAX_PRODUCTION_STATUS_BYTES,
  parseProductionStatusJson,
  productionCheckGuidance,
  productionCheckLabel,
  productionStatusEffectiveCutoverReady,
  verifyProductionDiagnosticBytes,
  type ParsedProductionStatus,
  type VerifiedProductionDiagnostic,
} from '../lib/audit/production-status';

const SCHEMA = 'divinelist.production-readiness.v1';
const HELP = `Användning:
  node scripts/production-readiness.mjs <summary.json> [--full <full.json>] [--json] [--obsidian <ny-not.md>]
  node scripts/production-readiness.mjs --status <summary.json>

Alternativ källa: DIVINELIST_PRODUCTION_STATUS_PATH.
Obsidian-export skapar bara en ny Markdown-fil i en befintlig katalog.
Exitkod: 0 = färsk och fullständigt verifierad, 1 = giltig men ej redo,
2 = fil-, validerings- eller exportfel. Ingen kod ger tillstånd till cutover.
`;

type Options = {
  json: boolean;
  help: boolean;
  status?: string;
  full?: string;
  obsidian?: string;
};

function parseArguments(argv: string[]): Options {
  const options: Options = { json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (
      argument === '--status' ||
      argument === '--full' ||
      argument === '--obsidian'
    ) {
      const key = argument.slice(2) as 'status' | 'full' | 'obsidian';
      const value = argv[++index];
      if (!value || value.startsWith('-'))
        throw new Error(`${argument} måste följas av en sökväg.`);
      if (options[key]) throw new Error(`${argument} får bara anges en gång.`);
      options[key] = value;
    } else {
      if (argument.startsWith('-'))
        throw new Error(`Okänt argument: ${argument}`);
      if (options.status)
        throw new Error(
          'Ange statusfilen en gång, som positionsargument eller --status.',
        );
      options.status = argument;
    }
  }
  options.status ??= process.env.DIVINELIST_PRODUCTION_STATUS_PATH || undefined;
  return options;
}

// Read only the checked file size plus a sentinel byte. Oversized files never
// get read into memory, and growth/truncation during the read is rejected.
function readBounded(path: string, limit: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile()) throw new Error('Källan måste vara en vanlig fil.');
    if (metadata.size <= 0 || metadata.size > limit)
      throw new Error(
        `Filstorleken måste vara 1–${limit} byte, mottog ${metadata.size}.`,
      );
    const buffer = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== metadata.size)
      throw new Error(
        'Filen ändrades under läsning. Välj ett stabilt snapshot.',
      );
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function buildReport(
  summary: ParsedProductionStatus,
  diagnostic: VerifiedProductionDiagnostic | null,
  validationErrors: string[],
  summaryPath: string,
  summarySha256: string,
  fullReportPath: string,
) {
  const effectiveCutoverReady = productionStatusEffectiveCutoverReady(
    summary,
    diagnostic,
    summary.loadedAt,
  );
  const blocking = summary.checks
    .filter((check) => check.status !== 'PASS')
    .sort((a, b) => Number(b.status === 'FAIL') - Number(a.status === 'FAIL'))
    .map((check) => ({
      name: check.name,
      status: check.status,
      label: productionCheckLabel(check.name),
      ...productionCheckGuidance(check),
    }));
  const reasons = [
    ...(summary.isStale
      ? [
          'Historisk rapport: äldre än 24 timmar. En ny kontroll av aktuell runtime behövs.',
        ]
      : []),
    ...(!diagnostic
      ? [
          'Fullrapporten kunde inte verifieras. Välj exakt den fil som sammanfattningen binder.',
        ]
      : []),
    ...(summary.failures
      ? [`${summary.failures} fel blockerar produktionskandidaten.`]
      : []),
    ...(summary.warnings
      ? [`${summary.warnings} varningar återstår före klarbesked.`]
      : []),
  ];
  return {
    schema: SCHEMA,
    readinessStatus: validationErrors.length
      ? 'INVALID'
      : effectiveCutoverReady
        ? 'PASS'
        : 'BLOCKED',
    status: summary.status,
    checkedAt: summary.checkedAt,
    loadedAt: summary.loadedAt,
    expiresAt: new Date(
      Date.parse(summary.checkedAt) + MAX_PRODUCTION_STATUS_AGE_MS,
    ).toISOString(),
    stale: summary.isStale,
    ageMs: summary.ageMs,
    productionCandidate: summary.productionCandidate,
    cutoverReady: summary.cutoverReady,
    cutoverPerformed: summary.cutoverPerformed,
    effectiveCutoverReady,
    failures: summary.failures,
    warnings: summary.warnings,
    pass: summary.passCount,
    fullReportVerified: Boolean(diagnostic),
    fullReportPath,
    fullReportSha256: summary.fullReportSha256,
    fullReportBytes: summary.fullReportBytes,
    summaryPath,
    summarySha256,
    canonicalReportHash: summary.canonicalReportHash,
    reasons,
    validationErrors,
    blocking,
    checks: summary.checks.map((check) => ({
      name: check.name,
      label: productionCheckLabel(check.name),
      status: check.status,
    })),
    cutoverAuthorized: false,
    outreachAuthorized: false,
  };
}

type ReadinessReport = ReturnType<typeof buildReport>;
const markdownText = (value: string) =>
  value
    .replace(
      /[&<>[\]`*_#|\\]/gu,
      (character) => `&#${character.codePointAt(0)};`,
    )
    .replace(/\p{Cc}/gu, ' ');

function buildMarkdown(report: ReadinessReport): string {
  const lines = [
    '---',
    'schema_version: "divinelist.obsidian-readiness.v1"',
    `readiness_status: ${JSON.stringify(report.readinessStatus)}`,
    `checked_at: ${JSON.stringify(report.checkedAt)}`,
    `read_at: ${JSON.stringify(report.loadedAt)}`,
    `expires_at: ${JSON.stringify(report.expiresAt)}`,
    `stale_at_export: ${report.stale}`,
    `full_report_verified: ${report.fullReportVerified}`,
    `summary_sha256: ${JSON.stringify(report.summarySha256)}`,
    'generated: true',
    'cutover_authorized: false',
    'outreach_authorized: false',
    '---',
    '',
    '# DivineList – nästa steg i Obsidian',
    '',
    `Kontrollresultat: **${report.readinessStatus === 'PASS' ? 'PASS för detta snapshot' : 'NO-GO'}**. ${report.pass} PASS, ${report.failures} FAIL, ${report.warnings} WARN.`,
    '',
    `Rapportens kontrolltid: ${report.checkedAt}. Giltig längst till: ${report.expiresAt}.`,
    `Inläst: ${report.loadedAt}. Fullrapport verifierad: ${report.fullReportVerified ? 'ja' : 'nej'}.`,
    '',
    'Detta är en lokal arbetslista över ett filsnapshot. Noten uppdateras inte automatiskt när databasen ändras eller rapporten blir gammal. En bock här registrerar inget granskningsbeslut.',
    '',
    ...report.reasons.map((reason) => `- ${markdownText(reason)}`),
    '',
    '## Arbetsordning',
    '',
    '- [ ] Kontrollera att rapportparet gäller samma aktuella datageneration. Gör en ny skrivskyddad kontroll om rapporten är gammal.',
    '- [ ] Åtgärda felpunkterna nedan och dokumentera det underlag som saknas.',
    '- [ ] Låt en människa granska evidens, karantän och kalibrering i respektive beslutsflöde.',
    '- [ ] Kör kontrollen igen och spara en ny daterad arbetslista.',
    '',
    '## Fel och varningar',
    '',
  ];
  if (!report.blocking.length)
    lines.push(
      'Inga FAIL eller WARN i källrapporten. Kontrollera ändå färskhet och fullrapport ovan.',
      '',
    );
  for (const check of report.blocking)
    lines.push(
      `### ${check.status}: ${check.label}`,
      '',
      markdownText(check.summary),
      '',
      `- [ ] ${markdownText(check.nextAction)}`,
      '',
      `Kontroll-ID: \`${check.name}\`.`,
      '',
    );
  if (report.validationErrors.length)
    lines.push(
      '## Valideringsfel',
      '',
      ...report.validationErrors.map((error) => `- ${markdownText(error)}`),
      '',
    );
  lines.push(
    '## Alla kontroller',
    '',
    '| Kontroll | Status |',
    '| --- | --- |',
    ...report.checks.map((check) => `| ${check.label} | ${check.status} |`),
    '',
    '## Källbindning',
    '',
    `Sammanfattning: ${markdownText(report.summaryPath)}`,
    '',
    `SHA-256 för sammanfattningens exakta byte: \`${report.summarySha256}\``,
    '',
    `Fullrapport: ${markdownText(report.fullReportPath)}`,
    '',
    `Förväntad fullrapport: ${report.fullReportBytes} byte, \`${report.fullReportSha256}\`.`,
    '',
    'Hashar visar om filinnehåll ändras; de bevisar inte vem som skapade underlaget eller att dess observationer är sanna.',
    '',
    '## Egna anteckningar',
    '',
    'Skriv dina noteringar här. Exportören vägrar skriva över en befintlig fil. Sparade beslut görs separat i motorns granskningsflöde.',
    '',
    'Ett tekniskt klarbesked ger inget tillstånd till aktiv-vault-byte, regelaktivering eller kontakt.',
    '',
  );
  return lines.join('\n');
}

function writeNewNote(path: string, report: ReadinessReport): void {
  if (extname(path).toLowerCase() !== '.md')
    throw new Error('Obsidian-exporten kräver en ny .md-fil.');
  const fd = openSync(path, 'wx');
  try {
    writeFileSync(fd, buildMarkdown(report), 'utf8');
  } finally {
    closeSync(fd);
  }
}

async function main() {
  const json = process.argv.includes('--json');
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    if (!options.status)
      throw new Error(
        'Ange summaryfil eller DIVINELIST_PRODUCTION_STATUS_PATH.',
      );
    const summaryPath = resolve(options.status);
    const summaryBytes = readBounded(summaryPath, MAX_PRODUCTION_STATUS_BYTES);
    const summary = parseProductionStatusJson(
      new TextDecoder('utf-8', { fatal: true }).decode(summaryBytes),
    );
    const fullPath = resolve(
      options.full ?? join(dirname(summaryPath), summary.fullReportFile),
    );
    const validationErrors: string[] = [];
    let diagnostic: VerifiedProductionDiagnostic | null = null;
    try {
      diagnostic = await verifyProductionDiagnosticBytes(
        basename(fullPath),
        readBounded(fullPath, MAX_PRODUCTION_DIAGNOSTIC_UI_BYTES),
        summary,
        summary.loadedAt,
      );
    } catch (error) {
      validationErrors.push(message(error));
    }
    const report = buildReport(
      summary,
      diagnostic,
      validationErrors,
      summaryPath,
      sha256(summaryBytes),
      fullPath,
    );
    if (options.obsidian) writeNewNote(resolve(options.obsidian), report);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `Readiness: ${report.readinessStatus}. Kontroller: ${report.pass} PASS, ${report.failures} FAIL, ${report.warnings} WARN.`,
      );
      console.log(
        `Kontrollerad: ${report.checkedAt}. Fullrapport verifierad: ${report.fullReportVerified ? 'ja' : 'nej'}.`,
      );
      for (const reason of report.reasons) console.log(reason);
      for (const error of report.validationErrors)
        console.error(`Valideringsfel: ${error}`);
      for (const check of report.blocking)
        console.log(
          `\n${check.label} (${check.status})\n${check.summary}\nNästa steg: ${check.nextAction}`,
        );
      if (options.obsidian)
        console.log(`\nNy Obsidian-not: ${resolve(options.obsidian)}`);
      console.log(
        '\nDetta snapshot ger inget tillstånd till cutover eller kontakt.',
      );
    }
    process.exitCode = validationErrors.length
      ? 2
      : report.effectiveCutoverReady
        ? 0
        : 1;
  } catch (error) {
    const validationErrors = [message(error)];
    if (json)
      console.log(
        JSON.stringify(
          {
            schema: SCHEMA,
            readinessStatus: 'INVALID',
            effectiveCutoverReady: false,
            validationErrors,
          },
          null,
          2,
        ),
      );
    else
      console.error(`Kunde inte köra readiness-analys: ${validationErrors[0]}`);
    process.exitCode = 2;
  }
}

await main();
