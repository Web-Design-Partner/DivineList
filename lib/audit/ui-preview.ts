import { AUDIT_RULES } from './catalog';
import { isValidIsoTimestamp } from './engine';
import {
  DATASET_VERSION_V2,
  RULESET_VERSION,
  type AuditDataset,
} from './types';

export const UNSEALED_RULE_PREVIEW_FILENAME = `divinelist-rules-${RULESET_VERSION.replace('divinelist.rules.', '')}-unsealed-preview.json`;

export type UiPreviewTimeResolution =
  | {
      ok: true;
      evaluatedAt: string;
      mode: 'v2_ui_preview' | 'v1_historical_demo';
    }
  | { ok: false; issues: string[] };

export const resolveUiPreviewEvaluatedAt = (
  dataset: AuditDataset,
  requestedEvaluatedAt: string,
): UiPreviewTimeResolution => {
  if (dataset.version !== DATASET_VERSION_V2) {
    return {
      ok: true,
      evaluatedAt: dataset.createdAt,
      mode: 'v1_historical_demo',
    };
  }

  const evaluatedAt = requestedEvaluatedAt.trim();
  if (!evaluatedAt) {
    return {
      ok: false,
      issues: [
        'evaluatedAt måste anges explicit för en reproducerbar V2-förhandsvisning.',
      ],
    };
  }
  if (!isValidIsoTimestamp(evaluatedAt)) {
    return {
      ok: false,
      issues: ['evaluatedAt måste vara en strikt giltig ISO-tidpunkt.'],
    };
  }
  if (Date.parse(evaluatedAt) + 300_000 < Date.parse(dataset.createdAt)) {
    return {
      ok: false,
      issues: [
        'evaluatedAt får inte ligga mer än fem minuter före datasetets createdAt.',
      ],
    };
  }

  return { ok: true, evaluatedAt, mode: 'v2_ui_preview' };
};

export const buildUnsealedRulePreview = () => ({
  artifactKind: 'unsealed_ui_preview' as const,
  sealed: false as const,
  rulesetVersion: RULESET_VERSION,
  rules: AUDIT_RULES,
});

export const serializeUnsealedRulePreview = (): string =>
  JSON.stringify(buildUnsealedRulePreview(), null, 2);
