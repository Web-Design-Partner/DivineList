import type { RuleResult } from './types';

type LeadingSignal = Pick<
  RuleResult,
  'executionStatus' | 'proposedState' | 'state' | 'title'
>;

export const isCompletedDetectedProposal = (
  result: Pick<RuleResult, 'executionStatus' | 'proposedState'>,
): boolean =>
  result.executionStatus === 'completed' && result.proposedState === 'detected';

export const isNegativeCandidateProposal = (
  result: Pick<RuleResult, 'executionStatus' | 'proposedState'>,
): boolean =>
  result.executionStatus === 'completed' &&
  result.proposedState === 'not_detected';

export const canPresentAsFinding = (
  result: Pick<RuleResult, 'executionStatus' | 'proposedState' | 'state'>,
): boolean =>
  result.executionStatus === 'completed' &&
  (result.state === 'detected' || result.proposedState === 'detected');

export const isBlockedOrFailed = (
  result: Pick<RuleResult, 'executionStatus'>,
): boolean => ['blocked', 'failed'].includes(result.executionStatus);

export const resultObservationText = (
  result: Pick<
    RuleResult,
    'executionStatus' | 'proposedState' | 'safeFinding' | 'state'
  >,
): string => {
  if (isBlockedOrFailed(result))
    return 'Kontrollen slutfördes inte och får därför inte beskrivas som ett fynd eller kalibreringsutfall.';
  if (isNegativeCandidateProposal(result))
    return 'Den importerade observationen matchade inte regelns felvillkor. Detta är ett negativt kalibreringsförslag, inte ett fynd.';
  if (!canPresentAsFinding(result))
    return 'Regeln gav inget verifierat fynd. Kontrollera underlag, körstatus och begränsningar innan någon slutsats dras.';
  return result.safeFinding;
};

export const resultDisplayTitle = (
  result: Pick<
    RuleResult,
    'executionStatus' | 'proposedState' | 'ruleId' | 'title'
  >,
): string =>
  result.executionStatus === 'blocked'
    ? `Kontroll ${result.ruleId}: blockerad`
    : result.executionStatus === 'failed'
      ? `Kontroll ${result.ruleId}: kunde inte köras`
      : isNegativeCandidateProposal(result)
        ? `Kalibrering ${result.ruleId}: inte observerat`
        : result.title;

/** Keep an unresolved rule from being rendered as an observed fault. */
export const leadingSignalLabel = (
  result: LeadingSignal | undefined,
  reviewCount = 1,
): string => {
  if (!result) return 'Inga verifierade fynd i underlaget';
  if (result.executionStatus === 'blocked') return 'Kontroll blockerad';
  if (result.executionStatus === 'failed') return 'Kontroll kunde inte köras';
  if (result.state === 'detected') return result.title;
  if (isCompletedDetectedProposal(result)) {
    return `Kalibreringsförslag: ${result.title}`;
  }
  if (isNegativeCandidateProposal(result))
    return 'Negativt kalibreringsförslag (inte ett fynd)';
  if (result.state === 'needs_review') {
    return reviewCount === 1
      ? '1 kontroll behöver mänsklig granskning'
      : `${reviewCount} kontroller behöver mänsklig granskning`;
  }
  return 'Inga verifierade fynd i underlaget';
};
