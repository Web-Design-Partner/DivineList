import {
  auditDataset,
  isValidIsoTimestamp,
  stableHash,
  unicodeCodePointCompare,
} from '../audit/engine';
import { inspectPortableJsonStructure } from '../audit/json-guard';
import {
  buildReviewDecisionBinding,
  reviewDecisionKey,
  type ExportReviewDecision,
  type ExportReviewMap,
} from '../audit/obsidian';
import { isNegativeCandidateProposal } from '../audit/presentation';
import {
  parseReviewSessionJson,
  serializeReviewSession,
  type ParsedReviewSession,
} from '../audit/review-session';
import type { AuditDataset, RuleResult } from '../audit/types';

export const WORKSPACE_STORAGE_KEY = 'divinelist.local-workspace';
export const WORKSPACE_STORAGE_VERSION = 'divinelist.local-workspace.v1';
export const WORKSPACE_WRITE_LOCK = 'divinelist-workspace-write';
export const MAX_WORKSPACE_BYTES = 2_000_000;
export const MAX_WORKSPACE_DRAFTS = 1_000;
export const MAX_WORKSPACE_RATIONALE_LENGTH = 600;

export type WorkspaceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;
export type WorkspaceReviewDraft = {
  choice: ExportReviewDecision['state'];
  rationale: string;
};
export type WorkspaceReviewDrafts = Record<string, WorkspaceReviewDraft>;
export type WorkspaceInput = {
  dataset: AuditDataset;
  evaluatedAt: string;
  decisions: ExportReviewMap;
  reviewDrafts: WorkspaceReviewDrafts;
};
export type WorkspaceSnapshot = {
  revision: string;
  savedAt: string;
  session: ParsedReviewSession;
  reviewDrafts: WorkspaceReviewDrafts;
};
export type WorkspaceStorageErrorCode =
  | 'quota'
  | 'unavailable'
  | 'corrupt'
  | 'schema_mismatch'
  | 'stale_writer'
  | 'too_large'
  | 'invalid';

export class WorkspaceStorageError extends Error {
  constructor(
    readonly code: WorkspaceStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceStorageError';
  }
}

type StoredDraft = WorkspaceReviewDraft & {
  key: string;
  bindingHash: string;
};
type WorkspacePayload = {
  version: typeof WORKSPACE_STORAGE_VERSION;
  artifactKind: 'local_ui_workspace';
  productionBatchResult: false;
  revisionNumber: number;
  writerId: string;
  savedAt: string;
  sessionJson: string;
  drafts: StoredDraft[];
};
type WorkspaceEnvelope = WorkspacePayload & { workspaceHash: string };
type ParsedWorkspace = {
  envelope: WorkspaceEnvelope;
  snapshot: WorkspaceSnapshot;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function fail(code: WorkspaceStorageErrorCode, message: string): never {
  throw new WorkspaceStorageError(code, message);
}

const storageFailure = (error: unknown): never => {
  const name = isRecord(error) ? error.name : undefined;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED')
    return fail(
      'quota',
      'Webbläsarens lagringsutrymme är fullt. Arbetet är inte autosparat; spara en separat sessionsfil.',
    );
  return fail(
    'unavailable',
    'Lokal webbläsarlagring är otillgänglig. Arbetet är inte autosparat; spara en separat sessionsfil.',
  );
};

const readRaw = (storage: WorkspaceStorage): string | null => {
  try {
    return storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch (error) {
    return storageFailure(error);
  }
};

const reviewable = (result: RuleResult): boolean =>
  result.state === 'detected' ||
  (result.state === 'needs_review' && !isNegativeCandidateProposal(result));

const draftBindings = (session: ParsedReviewSession): Map<string, string> =>
  new Map(
    auditDataset(session.dataset, session.evaluatedAt).flatMap((audit) =>
      audit.results
        .filter(reviewable)
        .map((result) => [
          reviewDecisionKey(audit.company.id, result.ruleId),
          stableHash(
            buildReviewDecisionBinding(
              session.dataset,
              audit.company.id,
              result,
            ),
          ),
        ]),
    ),
  );

const validDraft = (value: unknown): value is WorkspaceReviewDraft =>
  isRecord(value) &&
  typeof value.choice === 'string' &&
  ['confirmed', 'manual_check', 'dismissed'].includes(value.choice) &&
  typeof value.rationale === 'string' &&
  value.rationale.length <= MAX_WORKSPACE_RATIONALE_LENGTH;

const parseWorkspace = (raw: string): ParsedWorkspace => {
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES)
    fail(
      'too_large',
      'Det autosparade arbetet överskrider den lokala storleksgränsen.',
    );
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return fail(
      'corrupt',
      'Det autosparade arbetet är inte giltig JSON. Ingenting återställdes.',
    );
  }
  if (!isRecord(value))
    fail('corrupt', 'Det autosparade arbetet har ett ogiltigt format.');
  if (value.version !== WORKSPACE_STORAGE_VERSION)
    fail(
      'schema_mismatch',
      'Det autosparade arbetet använder en annan formatversion. Det har inte skrivits över.',
    );
  const structureIssues = inspectPortableJsonStructure(value, {
    maxDepth: 6,
    maxNodes: 10_000,
    maxIssues: 1,
    rootLabel: 'lokalt arbetsläge',
  });
  if (
    structureIssues.length ||
    !hasExactKeys(value, [
      'version',
      'artifactKind',
      'productionBatchResult',
      'revisionNumber',
      'writerId',
      'savedAt',
      'sessionJson',
      'drafts',
      'workspaceHash',
    ]) ||
    value.artifactKind !== 'local_ui_workspace' ||
    value.productionBatchResult !== false ||
    !Number.isSafeInteger(value.revisionNumber) ||
    (value.revisionNumber as number) < 1 ||
    typeof value.writerId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/u.test(value.writerId) ||
    typeof value.savedAt !== 'string' ||
    !isValidIsoTimestamp(value.savedAt) ||
    Date.parse(value.savedAt) > Date.now() + 300_000 ||
    typeof value.sessionJson !== 'string' ||
    !Array.isArray(value.drafts) ||
    value.drafts.length > MAX_WORKSPACE_DRAFTS ||
    typeof value.workspaceHash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.workspaceHash)
  )
    fail('corrupt', 'Det autosparade arbetet har ogiltiga eller okända fält.');

  const envelope = value as WorkspaceEnvelope;
  const { workspaceHash, ...payload } = envelope;
  if (stableHash(payload) !== workspaceHash)
    fail('corrupt', 'Kontrollsumman för det autosparade arbetet stämmer inte.');
  let session: ParsedReviewSession;
  try {
    session = parseReviewSessionJson(envelope.sessionJson);
  } catch {
    return fail(
      'corrupt',
      'Den autosparade sessionen matchar inte nuvarande underlags- och resultatkrav.',
    );
  }
  if (session.envelope.createdAt !== envelope.savedAt)
    fail('corrupt', 'Arbetslägets tid matchar inte den sparade sessionen.');
  const bindings = draftBindings(session);
  const reviewDrafts: WorkspaceReviewDrafts = {};
  for (const draft of envelope.drafts) {
    if (
      !isRecord(draft) ||
      !hasExactKeys(draft, ['key', 'bindingHash', 'choice', 'rationale']) ||
      !validDraft(draft) ||
      typeof draft.key !== 'string' ||
      Object.hasOwn(reviewDrafts, draft.key) ||
      typeof draft.bindingHash !== 'string' ||
      bindings.get(draft.key) !== draft.bindingHash
    )
      fail(
        'corrupt',
        'Ett autosparat utkast matchar inte sitt aktuella företag och regelresultat.',
      );
    reviewDrafts[draft.key] = {
      choice: draft.choice,
      rationale: draft.rationale,
    };
  }
  return {
    envelope,
    snapshot: {
      revision: `${envelope.revisionNumber}:${workspaceHash}`,
      savedAt: envelope.savedAt,
      session,
      reviewDrafts,
    },
  };
};

/** Validates the whole workspace before returning any restorable state. */
export const readWorkspace = (
  storage: WorkspaceStorage,
): WorkspaceSnapshot | null => {
  const raw = readRaw(storage);
  return raw === null ? null : parseWorkspace(raw).snapshot;
};

/**
 * Local recovery only: does not confirm a disk backup or a human/runtime review.
 * Call under navigator.locks.request(WORKSPACE_WRITE_LOCK, ...) in every tab.
 * Storage has no atomic compare-and-swap: revision/readback checks detect stale
 * writers but cannot alone guarantee cross-tab exclusion. Without Web Locks the
 * UI must disable automatic writes, not claim conflict-safe autosave. No hash
 * here authenticates a human; it detects content drift within this local copy.
 */
export const writeWorkspace = (
  storage: WorkspaceStorage,
  input: WorkspaceInput,
  options: {
    expectedRevision: string | null;
    writerId: string;
    savedAt?: string;
  },
): WorkspaceSnapshot => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(options.writerId))
    fail('invalid', 'Arbetsflikens lokala skrivaridentitet är ogiltig.');
  const savedAt = options.savedAt ?? new Date().toISOString();
  let sessionJson: string;
  let session: ParsedReviewSession;
  try {
    sessionJson = serializeReviewSession(
      input.dataset,
      input.evaluatedAt,
      input.decisions,
      savedAt,
    );
    if (new TextEncoder().encode(sessionJson).byteLength > MAX_WORKSPACE_BYTES)
      fail(
        'too_large',
        'Arbetet är för stort för lokal autosparning. Spara en separat sessionsfil.',
      );
    session = parseReviewSessionJson(sessionJson);
  } catch (error) {
    if (error instanceof WorkspaceStorageError) throw error;
    return fail(
      'invalid',
      'Arbetet matchar inte giltiga underlag och regelbeslut. Ingenting autosparades.',
    );
  }
  if (
    !isRecord(input.reviewDrafts) ||
    Object.keys(input.reviewDrafts).length > MAX_WORKSPACE_DRAFTS ||
    inspectPortableJsonStructure(input.reviewDrafts, {
      maxDepth: 2,
      maxNodes: MAX_WORKSPACE_DRAFTS * 3 + 1,
      maxIssues: 1,
      rootLabel: 'granskningsutkast',
    }).length > 0
  )
    fail(
      'invalid',
      `Arbetet får innehålla högst ${MAX_WORKSPACE_DRAFTS} granskningsutkast med giltig text.`,
    );
  const bindings = draftBindings(session);
  const drafts: StoredDraft[] = Object.entries(input.reviewDrafts)
    .sort(([left], [right]) => unicodeCodePointCompare(left, right))
    .map(([key, draft]) => {
      const bindingHash = bindings.get(key);
      if (
        !validDraft(draft) ||
        !hasExactKeys(draft, ['choice', 'rationale']) ||
        !bindingHash
      )
        fail(
          'invalid',
          'Ett utkast har ogiltig text eller tillhör inte ett granskningsbart regelresultat.',
        );
      return {
        key,
        bindingHash,
        choice: draft.choice,
        rationale: draft.rationale,
      };
    });
  const previousRaw = readRaw(storage);
  const previous = previousRaw === null ? null : parseWorkspace(previousRaw);
  if ((previous?.snapshot.revision ?? null) !== options.expectedRevision)
    fail(
      'stale_writer',
      'En annan flik har ändrat det lokala arbetet. Ingenting skrevs över; återställ den senaste kopian eller spara din session separat.',
    );
  const revisionNumber = (previous?.envelope.revisionNumber ?? 0) + 1;
  if (!Number.isSafeInteger(revisionNumber))
    fail('invalid', 'Det lokala arbetets versionsräknare har nått sin gräns.');
  const payload: WorkspacePayload = {
    version: WORKSPACE_STORAGE_VERSION,
    artifactKind: 'local_ui_workspace',
    productionBatchResult: false,
    revisionNumber,
    writerId: options.writerId,
    savedAt,
    sessionJson,
    drafts,
  };
  const workspaceHash = stableHash(payload);
  const serialized = JSON.stringify({ ...payload, workspaceHash });
  if (new TextEncoder().encode(serialized).byteLength > MAX_WORKSPACE_BYTES)
    fail(
      'too_large',
      'Arbetet är för stort för lokal autosparning. Spara en separat sessionsfil.',
    );
  if (readRaw(storage) !== previousRaw)
    fail(
      'stale_writer',
      'En annan flik ändrade arbetsläget före sparningen. Ingenting skrevs över.',
    );
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
  } catch (error) {
    return storageFailure(error);
  }
  if (readRaw(storage) !== serialized)
    fail(
      'stale_writer',
      'Autosparningen kunde inte verifieras. Det lokala arbetet ändrades under skrivningen; spara din session separat.',
    );
  return {
    revision: `${revisionNumber}:${workspaceHash}`,
    savedAt,
    session,
    reviewDrafts: Object.fromEntries(
      drafts.map(({ key, choice, rationale }) => [key, { choice, rationale }]),
    ),
  };
};
