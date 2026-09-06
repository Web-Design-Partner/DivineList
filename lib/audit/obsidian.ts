import {
  CATEGORY_LABELS,
  DATASET_VERSION_V2,
  REVIEW_DECISION_VERSION,
  RESULT_LABELS,
  RULESET_VERSION,
  SEVERITY_LABELS,
  type AuditDataset,
  type CompanyAudit,
  type EvidenceItem,
  type RuleResult,
} from './types';
import { isValidIsoTimestamp, isVerifiedV2BatchContract } from './engine';
import {
  isCompletedDetectedProposal,
  isNegativeCandidateProposal,
  resultDisplayTitle,
  resultObservationText,
} from './presentation';

export type ExportReviewDecision = {
  decisionVersion: typeof REVIEW_DECISION_VERSION;
  resultKind: 'ui_preview';
  productionBatchResult: false;
  companyId: string;
  ruleId: string;
  state: 'confirmed' | 'manual_check' | 'dismissed';
  rationale: string;
  decidedAt: string;
  datasetVersion: AuditDataset['version'];
  datasetCreatedAt: string;
  exportId: string | null;
  batchId: string | null;
  datasetHashVersion: string | null;
  datasetHash: string | null;
  evaluationPolicyVersion: string | null;
  evaluationPolicyHash: string | null;
  factHash: string | null;
  ruleHash: string | null;
  datasetHashContractHash: string | null;
  batchHash: string | null;
  batchHashVersion: string | null;
  contractManifestHash: string | null;
  ruleVersion: string;
  ruleContentHash: string;
  rulesetVersion: string;
  inputHash: string;
  evaluatedAt: string;
};

export type ExportReviewMap = Record<string, ExportReviewDecision>;

export const reviewDecisionKey = (companyId: string, ruleId: string): string =>
  JSON.stringify([companyId, ruleId]);

export const buildReviewDecisionBinding = (
  dataset: AuditDataset,
  companyId: string,
  result: RuleResult,
) => ({
  decisionVersion: REVIEW_DECISION_VERSION,
  resultKind: 'ui_preview' as const,
  productionBatchResult: false as const,
  companyId,
  ruleId: result.ruleId,
  datasetVersion: dataset.version,
  datasetCreatedAt: dataset.createdAt,
  exportId: dataset.exportId ?? null,
  batchId: dataset.batchId ?? null,
  datasetHashVersion: dataset.datasetHashVersion ?? null,
  datasetHash: dataset.datasetHash ?? null,
  evaluationPolicyVersion: dataset.evaluationPolicyVersion ?? null,
  evaluationPolicyHash: dataset.evaluationPolicyHash ?? null,
  factHash: dataset.factHash ?? null,
  ruleHash: dataset.ruleHash ?? null,
  datasetHashContractHash: dataset.datasetHashContractHash ?? null,
  batchHash: dataset.batchHash ?? null,
  batchHashVersion: dataset.batchHashVersion ?? null,
  contractManifestHash: dataset.contractManifestHash ?? null,
  ruleVersion: result.ruleVersion,
  ruleContentHash: result.ruleContentHash,
  rulesetVersion: result.rulesetVersion,
  inputHash: result.inputHash,
  evaluatedAt: result.evaluatedAt,
});

export const reviewDecisionMatchesResult = (
  decision: ExportReviewDecision | undefined,
  dataset: AuditDataset,
  companyId: string,
  result: RuleResult | undefined,
): decision is ExportReviewDecision =>
  Boolean(
    decision &&
    result &&
    decision.decisionVersion === REVIEW_DECISION_VERSION &&
    decision.resultKind === 'ui_preview' &&
    decision.productionBatchResult === false &&
    decision.companyId === companyId &&
    decision.ruleId === result.ruleId &&
    decision.datasetVersion === dataset.version &&
    decision.datasetCreatedAt === dataset.createdAt &&
    decision.exportId === (dataset.exportId ?? null) &&
    decision.batchId === (dataset.batchId ?? null) &&
    decision.datasetHashVersion === (dataset.datasetHashVersion ?? null) &&
    decision.datasetHash === (dataset.datasetHash ?? null) &&
    decision.evaluationPolicyVersion ===
      (dataset.evaluationPolicyVersion ?? null) &&
    decision.evaluationPolicyHash === (dataset.evaluationPolicyHash ?? null) &&
    decision.factHash === (dataset.factHash ?? null) &&
    decision.ruleHash === (dataset.ruleHash ?? null) &&
    decision.datasetHashContractHash ===
      (dataset.datasetHashContractHash ?? null) &&
    decision.batchHashVersion === (dataset.batchHashVersion ?? null) &&
    decision.batchHash === (dataset.batchHash ?? null) &&
    decision.contractManifestHash === (dataset.contractManifestHash ?? null) &&
    decision.ruleVersion === result.ruleVersion &&
    decision.ruleContentHash === result.ruleContentHash &&
    decision.rulesetVersion === result.rulesetVersion &&
    decision.inputHash === result.inputHash &&
    decision.evaluatedAt === result.evaluatedAt &&
    typeof decision.decidedAt === 'string' &&
    isValidIsoTimestamp(decision.decidedAt) &&
    typeof decision.rationale === 'string' &&
    decision.rationale.trim().length >= 8 &&
    decision.rationale.length <= 600 &&
    ['confirmed', 'manual_check', 'dismissed'].includes(decision.state),
  );

export type ObsidianSourceProvenance =
  | 'verified_batch_v2'
  | 'legacy_or_unverified';

export type ObsidianExportOptions = {
  datasetVersion: AuditDataset['version'];
  datasetCreatedAt: string;
  evaluatedAt: string;
  sourceProvenance: ObsidianSourceProvenance;
  sourceDataset?: AuditDataset;
  decisions?: ExportReviewMap;
};

const assertAuditEvaluationTime = (
  audits: CompanyAudit[],
  evaluatedAt: string,
): void => {
  if (!isValidIsoTimestamp(evaluatedAt))
    throw new Error('evaluatedAt måste vara en strikt giltig ISO-tidpunkt.');
  if (
    audits.some((audit) =>
      audit.results.some((result) => result.evaluatedAt !== evaluatedAt),
    )
  )
    throw new Error(
      'evaluatedAt matchar inte den explicita utvärderingstiden i auditresultaten.',
    );
};

const assertObsidianExportOptions = (
  audits: CompanyAudit[],
  options: ObsidianExportOptions,
): void => {
  if (!isValidIsoTimestamp(options.datasetCreatedAt))
    throw new Error(
      'datasetCreatedAt måste vara en strikt giltig ISO-tidpunkt.',
    );
  assertAuditEvaluationTime(audits, options.evaluatedAt);
  if (
    options.datasetVersion === DATASET_VERSION_V2 &&
    Date.parse(options.evaluatedAt) + 300_000 <
      Date.parse(options.datasetCreatedAt)
  )
    throw new Error(
      'evaluatedAt får inte ligga mer än fem minuter före datasetets createdAt.',
    );
};

const hasVerifiedV2Provenance = (
  audit: CompanyAudit,
  options: ObsidianExportOptions,
): boolean => {
  const company = audit.company;
  const sourceDataset = options.sourceDataset;
  return (
    options.datasetVersion === DATASET_VERSION_V2 &&
    options.sourceProvenance === 'verified_batch_v2' &&
    sourceDataset?.createdAt === options.datasetCreatedAt &&
    isVerifiedV2BatchContract(sourceDataset) &&
    sourceDataset.companies.includes(company) &&
    company.workplaceUid === company.id &&
    typeof company.siteUid === 'string' &&
    company.siteUid.trim().length > 0 &&
    company.municipalityCode === '1480' &&
    company.gothenburgStatus === 'verified' &&
    company.verificationStatus === 'verified_current' &&
    (company.relationshipStatus === 'verified_primary' ||
      company.relationshipStatus === 'shared_corporate') &&
    typeof company.relationshipConfidence === 'number' &&
    Number.isFinite(company.relationshipConfidence) &&
    company.relationshipConfidence >= 0.7 &&
    company.relationshipConfidence <= 1
  );
};

const singleLine = (value: string): string =>
  Array.from(value.normalize('NFC'))
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      const unsafe =
        point <= 0x1f ||
        (point >= 0x7f && point <= 0x9f) ||
        (point >= 0x2028 && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069);
      return unsafe ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();

const safeText = (value: string): string =>
  singleLine(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '&bsol;')
    .replaceAll('`', '&grave;')
    .replaceAll('|', '&vert;')
    .replaceAll('[', '&lbrack;')
    .replaceAll(']', '&rbrack;')
    .replaceAll('!', '&excl;')
    .replaceAll('#', '&num;')
    .replaceAll('*', '&ast;')
    .replaceAll('_', '&lowbar;')
    .replaceAll('~', '&tilde;');

const yamlString = (value: string): string =>
  JSON.stringify(singleLine(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('`', '\\u0060')
    .replaceAll('!', '\\u0021')
    .replaceAll('[', '\\u005b')
    .replaceAll(']', '\\u005d');

const markdownBodyWithoutFrontmatter = (markdown: string): string => {
  const closingMarker = markdown.indexOf('\n---\n', 4);
  return closingMarker >= 0
    ? markdown.slice(closingMarker + '\n---\n'.length).trim()
    : markdown.trim();
};

const formatConfidence = (confidence: number): string =>
  `${Math.round(confidence * 100)} %`;

const findingMarkdown = (
  finding: RuleResult,
  evidenceById: Map<string, EvidenceItem>,
): string => {
  const limitations = finding.limitations.length
    ? finding.limitations.map((item) => `  - ${safeText(item)}`).join('\n')
    : '  - Inga registrerade begränsningar i det importerade underlaget.';
  const evidence = finding.acceptedEvidenceIds.length
    ? finding.acceptedEvidenceIds
        .map((id) => {
          const item = evidenceById.get(id);
          if (!item)
            return `  - ID \`${safeText(id)}\`: saknas i företagsposten.`;
          const locator = item.locator
            ? `; plats: ${safeText(item.locator)}`
            : '';
          const note = item.note ? `; notering: ${safeText(item.note)}` : '';
          const source = item.sourceUrl
            ? `; källa: ${safeText(item.sourceUrl)}`
            : '';
          const page = item.pageId ? `; sida: ${safeText(item.pageId)}` : '';
          const collector = item.collector
            ? `; insamlare: ${safeText(item.collector)}${item.collectorVersion ? `@${safeText(item.collectorVersion)}` : ''}`
            : '';
          const provenance = item.actor
            ? `; aktör: ${safeText(item.actor)}; scope: ${safeText(item.scope ?? 'saknas')}`
            : '';
          const artifact = item.artifactPath
            ? `; artefakt: ${safeText(item.artifactPath)} (${safeText(item.artifactSha256 ?? 'hash saknas')})`
            : '';
          return `  - ID \`${safeText(id)}\`; metod: ${safeText(item.method)}; observerad: ${safeText(item.observedAt)}; etikett: ${safeText(item.label)}${source}${page}${collector}${provenance}${artifact}${locator}${note}`;
        })
        .join('\n')
    : '  - Saknas.';
  const rejectedEvidence = finding.rejectedEvidence.length
    ? finding.rejectedEvidence
        .map(
          ({ evidenceId, reason }) =>
            `  - ID \`${safeText(evidenceId)}\`: ${safeText(reason)}`,
        )
        .join('\n')
    : '  - Ingen avvisad evidens registrerad.';
  const trace = finding.trace
    .map(
      (item) =>
        `  - \`${safeText(item.fact)}\`: förväntat ${safeText(item.expected)}, observerat \`${safeText(
          typeof item.actual === 'string'
            ? item.actual
            : JSON.stringify(item.actual),
        )}\``,
    )
    .join('\n');
  const proposedState = finding.proposedState
    ? `\n- Kalibreringsförslag (inte publikt utfall): **${RESULT_LABELS[finding.proposedState]}**`
    : '';

  return `### ${safeText(finding.title)}

- Regel: \`${finding.ruleId}@${finding.ruleVersion}\`
- Regelhash: \`${safeText(finding.ruleContentHash)}\`
- Policyläge: nivå ${finding.ruleTier}; ${finding.ruleLifecycle}; ${finding.evaluationMode}
- Status: **${RESULT_LABELS[finding.state]}**${proposedState}
- Område: ${CATEGORY_LABELS[finding.category]}
- Allvar om observationen stämmer: ${SEVERITY_LABELS[finding.severity]}
- Evidenssäkerhet: ${formatConfidence(finding.confidence)}
- Godkänd evidens:
${evidence}
- Avvisad evidens, räknas inte:
${rejectedEvidence}
- Körning: ${finding.executionStatus}; rendering ${finding.renderFidelity}; sidor ${finding.coverage.testedPages}/${finding.coverage.eligiblePages} testade och ${finding.coverage.excludedPages} exkluderade
- Observationsformulering: ${safeText(resultObservationText(finding))}
- Föreslagen åtgärd: ${safeText(finding.recommendation)}
- Kontrollera manuellt: ${safeText(finding.manualCheck)}

**Regelspår**

${trace || '  - Inget regelspår tillgängligt.'}

**Begränsningar**

${limitations}`;
};

export const buildCompanyMarkdown = (
  audit: CompanyAudit,
  options: ObsidianExportOptions,
): string => {
  assertObsidianExportOptions([audit], options);
  const decisions = options.decisions ?? {};
  const currentFindings = audit.results.filter(
    (result) =>
      result.executionStatus === 'completed' && result.state === 'detected',
  );
  const positiveProposals = audit.results.filter(isCompletedDetectedProposal);
  const negativeProposals = audit.results.filter(isNegativeCandidateProposal);
  const manualChecks = audit.results.filter(
    (result) =>
      result.state === 'needs_review' && result.proposedState === undefined,
  );
  const unknown = audit.results.filter(
    (result) => result.state === 'not_tested' || result.state === 'error',
  );
  const proposedDetected = audit.results.filter(
    isCompletedDetectedProposal,
  ).length;
  const companyDecisions = audit.results
    .flatMap((result) => {
      const decision =
        decisions[reviewDecisionKey(audit.company.id, result.ruleId)];
      return decision ? [{ ruleId: result.ruleId, decision, result }] : [];
    })
    .sort((left, right) =>
      left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0,
    );
  const evidenceById = new Map(
    audit.company.evidence.map((item) => [item.id, item]),
  );
  const isVerifiedV2 = hasVerifiedV2Provenance(audit, options);
  const sourceDataset = options.sourceDataset;
  const provenanceClass = isVerifiedV2
    ? 'verified_v2_batch_dataset_declared_ui_preview'
    : 'legacy_or_unverified_ui_preview';

  return `---
schema_version: "divinelist.obsidian.v2"
record_type: "website_audit"
dataset_version: ${yamlString(options.datasetVersion)}
dataset_created_at: ${yamlString(options.datasetCreatedAt)}
dataset_hash_version: ${yamlString(sourceDataset?.datasetHashVersion ?? '')}
dataset_hash: ${yamlString(sourceDataset?.datasetHash ?? '')}
evaluation_policy_version: ${yamlString(sourceDataset?.evaluationPolicyVersion ?? '')}
evaluation_policy_hash: ${yamlString(sourceDataset?.evaluationPolicyHash ?? '')}
fact_hash: ${yamlString(sourceDataset?.factHash ?? '')}
rule_hash: ${yamlString(sourceDataset?.ruleHash ?? '')}
dataset_hash_contract_hash: ${yamlString(sourceDataset?.datasetHashContractHash ?? '')}
contract_manifest_hash: ${yamlString(sourceDataset?.contractManifestHash ?? '')}
batch_hash_version: ${yamlString(sourceDataset?.batchHashVersion ?? '')}
batch_hash: ${yamlString(sourceDataset?.batchHash ?? '')}
evaluated_at: ${yamlString(options.evaluatedAt)}
result_kind: "ui_preview"
production_batch_result: false
company_id: ${yamlString(audit.company.id)}
workplace_uid: ${yamlString(audit.company.workplaceUid ?? '')}
site_uid: ${yamlString(audit.company.siteUid ?? '')}
display_name: ${yamlString(audit.company.name)}
domain: ${yamlString(audit.company.domain)}
city: ${yamlString(audit.company.city ?? '')}
industry: ${yamlString(audit.company.industry ?? '')}
municipality_code: ${yamlString(audit.company.municipalityCode ?? '')}
gothenburg_status: ${yamlString(audit.company.gothenburgStatus ?? 'legacy')}
identity_status: ${yamlString(audit.company.verificationStatus ?? 'legacy')}
domain_relationship: ${yamlString(audit.company.relationshipStatus ?? 'legacy')}
domain_relationship_confidence: ${audit.company.relationshipConfidence ?? 0}
render_fidelity: ${yamlString(audit.company.renderFidelity ?? 'unknown')}
captured_at: ${yamlString(audit.company.capturedAt)}
ruleset_version: ${yamlString(RULESET_VERSION)}
input_hash: ${yamlString(audit.inputHash)}
priority_support: ${audit.priorityScore}
coverage_percent: ${audit.coverage}
detected_findings: ${audit.detectedCount}
proposed_findings: ${proposedDetected}
manual_checks: ${audit.reviewCount}
unknown_checks: ${audit.unknownCount}
review_state: "needs_human_review"
outreach_state: "not_authorized"
data_provenance: ${yamlString(provenanceClass)}
tags:
  - "kundradar/company"
  - "audit/human-review"
---

# ${safeText(audit.company.name)}

> ${
    isVerifiedV2
      ? 'V2-batchens batchHash och exakta versions-/policykontrakt verifierades. datasetHash är deklarerad och kryptografiskt bunden av batchHash, men kan inte verifieras självständigt från en enskild delbatch. Detta är inte ett förseglat produktionsresultat; sådana skapas endast av batch-CLI. DivineList har inte själv öppnat eller skannat domänen. Kontrollera alltid ledande evidens manuellt före eventuell kontakt.'
      : 'Syntetiskt, äldre V1 eller ofullständigt V2-underlag — inte produktionsunderlag och inte en verifierad företagsobservation. Ingen kontakt får baseras på detta.'
  }

## Status

- Domän (endast text): \`${safeText(audit.company.domain)}\`
- Identitet: ${safeText(audit.company.workplaceUid ?? 'legacy utan stabilt arbetsställe-ID')} · Göteborg ${safeText(audit.company.gothenburgStatus ?? 'legacy')} · kommun ${safeText(audit.company.municipalityCode ?? 'saknas')}
- Domänrelation: ${safeText(audit.company.relationshipStatus ?? 'legacy')} · ${formatConfidence(audit.company.relationshipConfidence ?? 0)} säkerhet
- Sidtäckning: ${audit.company.pageCoverage?.testedPages ?? 0}/${audit.company.pageCoverage?.eligiblePages ?? 0} testade; ${audit.company.pageCoverage?.excludedPages ?? 0} exkluderade; rendering ${safeText(audit.company.renderFidelity ?? 'unknown')}
- Prioriteringsstöd: **${audit.priorityScore}/100** — endast aktiva automatiska regler med verifierad, färsk evidens får bidra; korrelerade rotorsaker räknas en gång. Nuvarande regler är kandidater/skuggläge och kräver mänsklig kalibrering samt en versionerad release före aktivering.
- Avgörbar täckning: **${audit.coverage} %**
- Observerade fynd: **${audit.detectedCount}**
- Kalibreringsförslag "observerat" (inte publika fynd): **${proposedDetected}**
- Behöver kontroll: **${audit.reviewCount}**
- Okända eller ej körbara kontroller: **${audit.unknownCount}**
- Kontakt: **Inte godkänd**

## Observerade fynd

${
  currentFindings.length
    ? currentFindings
        .map((finding) => findingMarkdown(finding, evidenceById))
        .join('\n\n')
    : 'Inga verifierade fynd finns i det importerade underlaget. Det betyder inte att webbplatsen saknar fel.'
}

## Positiva kalibreringsförslag (inte publika fynd)

${
  positiveProposals.length
    ? positiveProposals
        .map((finding) => findingMarkdown(finding, evidenceById))
        .join('\n\n')
    : '- Inga positiva kalibreringsförslag.'
}

## Negativa kalibreringsförslag (inte fynd)

${
  negativeProposals.length
    ? negativeProposals
        .map(
          (result) =>
            `- \`${safeText(result.ruleId)}\` — inte observerat i den genomförda kalibreringen; ingen problemformulering eller åtgärd föreslås.`,
        )
        .join('\n')
    : '- Inga negativa kalibreringsförslag.'
}

## Behöver kontroll (inte verifierade fynd)

${
  manualChecks.length
    ? manualChecks
        .map(
          (result) =>
            `- \`${safeText(result.ruleId)}\` — ${RESULT_LABELS[result.state]}; ${safeText(result.limitations.join(' ') || 'orsak saknas')}`,
        )
        .join('\n')
    : '- Inga ytterligare manuella kontroller.'
}

## Okänt eller inte testat

${
  unknown.length
    ? unknown
        .slice(0, 30)
        .map(
          (result) =>
            `- \`${result.ruleId}\` ${safeText(resultDisplayTitle(result))}: ${RESULT_LABELS[result.state]}`,
        )
        .join('\n') +
      (unknown.length > 30
        ? `\n- … samt ${unknown.length - 30} ytterligare kontroller.`
        : '')
    : '- Inga okända kontroller i det importerade omfånget.'
}

## Mänsklig granskning

- [ ] Rätt företag och rätt domän har verifierats.
- [ ] Ledande evidens har öppnats och kontrollerats manuellt.
- [ ] Fyndets försiktiga formulering motsvarar exakt observationen.
- [ ] Ingen privat persondata används.
- [ ] Eventuell kontakt har godkänts separat av en människa.

## Sparade manuella beslut

${
  companyDecisions.length
    ? companyDecisions
        .map(({ ruleId, decision, result }) => {
          const labels = {
            confirmed: 'Bekräftat manuellt',
            manual_check: 'Kontrollera igen',
            dismissed: 'Avfärdat',
          } as const;
          const isCurrent = Boolean(
            sourceDataset &&
            reviewDecisionMatchesResult(
              decision,
              sourceDataset,
              audit.company.id,
              result,
            ),
          );
          const binding = `; beslut ${safeText(decision.decisionVersion)}; källa ${safeText(decision.resultKind)}; företag ${safeText(decision.companyId)}; regel-ID ${safeText(decision.ruleId)}; dataset ${safeText(decision.datasetVersion)} @ ${safeText(decision.datasetCreatedAt)}; export ${safeText(decision.exportId ?? 'saknas')}; batch ${safeText(decision.batchId ?? 'saknas')}; datasetHashVersion ${safeText(decision.datasetHashVersion ?? 'saknas')}; datasetHash \`${safeText(decision.datasetHash ?? 'saknas')}\`; policy ${safeText(decision.evaluationPolicyVersion ?? 'saknas')}; policyHash \`${safeText(decision.evaluationPolicyHash ?? 'saknas')}\`; factHash \`${safeText(decision.factHash ?? 'saknas')}\`; ruleHash \`${safeText(decision.ruleHash ?? 'saknas')}\`; datasetHashContractHash \`${safeText(decision.datasetHashContractHash ?? 'saknas')}\`; batchHashVersion ${safeText(decision.batchHashVersion ?? 'saknas')}; batchHash \`${safeText(decision.batchHash ?? 'saknas')}\`; manifestHash \`${safeText(decision.contractManifestHash ?? 'saknas')}\`; ruleset ${safeText(decision.rulesetVersion)}; regel ${safeText(decision.ruleVersion)}; regelhash \`${safeText(decision.ruleContentHash)}\`; input \`${safeText(decision.inputHash)}\`; evaluatedAt ${safeText(decision.evaluatedAt)}`;
          const status = isCurrent
            ? labels[decision.state]
            : `Inaktuellt tidigare beslut (${labels[decision.state]})`;
          return `- \`${safeText(ruleId)}\` — **${status}** (${safeText(decision.decidedAt)}${binding}): ${safeText(decision.rationale)}`;
        })
        .join('\n')
    : '- Inga manuella beslut exporterades.'
}

## Egna anteckningar

Skriv manuella anteckningar här. En ny export ersätter inte automatiskt denna fil.
`;
};

export const buildObsidianMarkdown = (
  audits: CompanyAudit[],
  datasetName: string,
  options: ObsidianExportOptions,
): string => {
  assertObsidianExportOptions(audits, options);
  const provenanceClass =
    audits.length > 0 &&
    audits.every((audit) => hasVerifiedV2Provenance(audit, options))
      ? 'verified_v2_batch_dataset_declared_ui_preview'
      : 'legacy_or_unverified_ui_preview';
  const sourceDataset = options.sourceDataset;
  const index = `---
schema_version: "divinelist.obsidian-index.v2"
dataset_version: ${yamlString(options.datasetVersion)}
dataset_name: ${yamlString(datasetName)}
dataset_created_at: ${yamlString(options.datasetCreatedAt)}
dataset_hash_version: ${yamlString(sourceDataset?.datasetHashVersion ?? '')}
dataset_hash: ${yamlString(sourceDataset?.datasetHash ?? '')}
evaluation_policy_version: ${yamlString(sourceDataset?.evaluationPolicyVersion ?? '')}
evaluation_policy_hash: ${yamlString(sourceDataset?.evaluationPolicyHash ?? '')}
fact_hash: ${yamlString(sourceDataset?.factHash ?? '')}
rule_hash: ${yamlString(sourceDataset?.ruleHash ?? '')}
dataset_hash_contract_hash: ${yamlString(sourceDataset?.datasetHashContractHash ?? '')}
contract_manifest_hash: ${yamlString(sourceDataset?.contractManifestHash ?? '')}
batch_hash_version: ${yamlString(sourceDataset?.batchHashVersion ?? '')}
batch_hash: ${yamlString(sourceDataset?.batchHash ?? '')}
evaluated_at: ${yamlString(options.evaluatedAt)}
result_kind: "ui_preview"
production_batch_result: false
ruleset_version: ${yamlString(RULESET_VERSION)}
company_count: ${audits.length}
outreach_state: "not_authorized"
data_provenance: ${yamlString(provenanceClass)}
---

# DivineList – ${safeText(datasetName)}

> Reproducerbar UI-förhandsvisning, inte ett förseglat produktionsresultat. Produktionsresultat skapas endast av batch-CLI. Inga webbplatser har öppnats av DivineList och ingen kontakt är godkänd eller utförd.

| Företag | Domän | Prioriteringsstöd | Fynd | Kontrollera | Täckning |
|---|---|---:|---:|---:|---:|
${audits
  .map(
    (audit) =>
      `| ${safeText(audit.company.name)} | \`${safeText(audit.company.domain)}\` | ${audit.priorityScore} | ${audit.detectedCount} | ${audit.reviewCount} | ${audit.coverage} % |`,
  )
  .join('\n')}
`;

  return [
    index.trim(),
    ...audits.map((audit) =>
      markdownBodyWithoutFrontmatter(buildCompanyMarkdown(audit, options)),
    ),
  ].join('\n\n---\n\n');
};

export const buildResultJson = (
  audits: CompanyAudit[],
  datasetName: string,
  dataset: AuditDataset | undefined,
  evaluatedAt: string,
): string => {
  if (!evaluatedAt)
    throw new Error(
      'evaluatedAt måste anges explicit för UI-förhandsvisningen.',
    );
  assertAuditEvaluationTime(audits, evaluatedAt);
  return JSON.stringify(
    {
      version: 'divinelist.results.ui-preview.v2',
      resultKind: 'ui_preview',
      productionBatchResult: false,
      datasetName,
      rulesetVersion: RULESET_VERSION,
      sourceDataset: dataset
        ? {
            version: dataset.version,
            createdAt: dataset.createdAt,
            exportId: dataset.exportId ?? null,
            batchId: dataset.batchId ?? null,
            datasetHashVersion: dataset.datasetHashVersion ?? null,
            datasetHash: dataset.datasetHash ?? null,
            evaluationPolicyVersion: dataset.evaluationPolicyVersion ?? null,
            evaluationPolicyHash: dataset.evaluationPolicyHash ?? null,
            factHash: dataset.factHash ?? null,
            ruleHash: dataset.ruleHash ?? null,
            datasetHashContractHash: dataset.datasetHashContractHash ?? null,
            contractManifestHash: dataset.contractManifestHash ?? null,
            batchHashVersion: dataset.batchHashVersion ?? null,
            batchHash: dataset.batchHash ?? null,
            batchContractVerified: isVerifiedV2BatchContract(dataset),
            datasetHashVerification: isVerifiedV2BatchContract(dataset)
              ? 'declared_bound_not_independently_verified_from_batch'
              : 'unverified',
          }
        : null,
      evaluatedAt,
      generatedAt: evaluatedAt,
      companies: audits,
      guardrails: {
        scannedWebsites: false,
        outreachAuthorized: false,
        importedScoresTrusted: false,
        productionBatchResult: false,
      },
    },
    null,
    2,
  );
};
