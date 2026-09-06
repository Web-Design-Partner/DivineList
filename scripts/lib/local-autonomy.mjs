import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const LOCAL_AUTONOMY_VERSION = 'divinelist.local-autonomy.v1';

const OBSERVATIONS_VERSION = 'divinelist.identity-observations.v1';
const MAX_AGE_NS = 7n * 24n * 60n * 60n * 1000000000n;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const AGENT_ACTIONS = new Set([
  'read_local',
  'test_local',
  'research_public_company',
  'prepare_identity',
  'prepare_import_dry_run',
  'write_local_report',
  'research_or_replace_candidate',
  'skip_candidate',
]);
const USER_ACTIONS = new Set([
  'write_runtime_database',
  'send_outreach',
  'advertise',
  'publish',
  'deploy',
  'purchase',
  'login',
  'handle_secrets',
  'activate_rules',
  'record_human_review',
  'change_active_vault',
]);
const SEED_FIELDS = [
  'schema_version',
  'wave_id',
  'generated_at',
  'mode',
  'candidate_count',
  'database_import_performed',
  'algorithm_evaluation_performed',
  'human_decision_required',
  'data_policy',
  'deduplication_baseline',
  'records',
];
const SEED_RECORD_FIELDS = [
  'source_record_id',
  'company_name',
  'workplace_name',
  'street_address',
  'postal_code',
  'municipality_code',
  'gothenburg_status',
  'verification_status',
  'needs_manual_review',
  'verification_note',
  'segment',
  'website',
  'domain_status',
  'domain_confidence',
  'source_url',
  'evidence_urls',
  'observed_at',
];
const SEGMENTS = [
  'frisör/skönhet',
  'restaurang/café',
  'hälsa/friskvård',
  'hantverk/hemservice',
  'specialbutik/annan lokal konsumenttjänst',
];
const OBSERVATION_FIELDS = [
  'sourceRecordId',
  'checkedAt',
  'sources',
  'identity',
  'workplace',
  'municipality',
  'duplicate',
  'suppression',
  'segment',
  'note',
  'researchPause',
];

function invalid(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = 'INVALID_LOCAL_AUTONOMY_INPUT';
  throw error;
}

function object(value, fields, path, optional = []) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    invalid(path, 'must be a plain object');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!fields.includes(key)) invalid(path, `unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(path, 'must contain only enumerable data fields');
    }
  }
  for (const key of fields) {
    if (!optional.includes(key) && !Object.hasOwn(value, key)) {
      invalid(path, `missing field ${key}`);
    }
  }
}

function string(value, path, { allowEmpty = false, max = 4000 } = {}) {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > max
  ) {
    invalid(path, 'must be a string of permitted length');
  }
}

function exact(value, expected, path) {
  if (value !== expected)
    invalid(path, `must equal ${JSON.stringify(expected)}`);
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) invalid(path, 'unknown value');
}

function array(value, path, min, max) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max
  ) {
    invalid(path, `must be an array with ${min} to ${max} items`);
  }
  if (
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Object.keys(value).length !== value.length ||
    !Object.keys(value).every((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return key === String(index) && Object.hasOwn(descriptor, 'value');
    })
  ) {
    invalid(path, 'must be a dense array without extra fields');
  }
}

function hash(value, path) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    invalid(path, 'must be a lowercase sha256 digest with prefix');
  }
}

function timestamp(value, path, latest = null) {
  string(value, path, { max: 64 });
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match)
    invalid(path, 'must be an ISO timestamp with an explicit timezone');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    Number(match[10] ?? 0) > 23 ||
    Number(match[11] ?? 0) > 59
  ) {
    invalid(path, 'invalid calendar timestamp');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid(path, 'invalid timestamp');
  // Date.parse truncates sub-millisecond digits. Preserve them for strict
  // freshness/future checks, including the seven-digit timestamps in staging.
  const fractionalNs = BigInt((match[7] ?? '').padEnd(9, '0'));
  const parsedNs = BigInt(parsed) * 1000000n + (fractionalNs % 1000000n);
  if (latest !== null && parsedNs > latest)
    invalid(path, 'timestamp is in the future');
  return parsedNs;
}

// This is a syntax gate only. It never resolves hosts or fetches a source.
function publicHost(value, path) {
  string(value, path, { max: 4096 });
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(path, 'invalid URL');
  }
  const hostname = url.hostname.toLowerCase();
  const ipHost = hostname.replace(/^\[|\]$/g, '');
  const labels = hostname.split('.');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(ipHost) !== 0 ||
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ) ||
    hostname.length > 253 ||
    /(?:^|\.)(?:localhost|local|internal|example|test|invalid|lan|home|onion)$/.test(
      hostname,
    )
  ) {
    invalid(
      path,
      'must be an HTTPS public hostname without credentials or custom port',
    );
  }
  return hostname.replace(/^www\./, '');
}

function validateSeed(seed, evaluatedNs) {
  object(seed, SEED_FIELDS, 'seed');
  exact(
    seed.schema_version,
    'foretagskarta.company-seeds.v1',
    'seed.schema_version',
  );
  exact(seed.mode, 'local_candidate_staging', 'seed.mode');
  string(seed.wave_id, 'seed.wave_id');
  timestamp(seed.generated_at, 'seed.generated_at', evaluatedNs);
  exact(
    seed.database_import_performed,
    false,
    'seed.database_import_performed',
  );
  exact(
    seed.algorithm_evaluation_performed,
    false,
    'seed.algorithm_evaluation_performed',
  );
  exact(seed.human_decision_required, true, 'seed.human_decision_required');
  object(
    seed.data_policy,
    [
      'company_level_public_data_only',
      'personal_contacts_included',
      'outreach_authorized',
      'advertising_authorized',
    ],
    'seed.data_policy',
  );
  exact(
    seed.data_policy.company_level_public_data_only,
    true,
    'seed.data_policy.company_level_public_data_only',
  );
  for (const field of [
    'personal_contacts_included',
    'outreach_authorized',
    'advertising_authorized',
  ]) {
    exact(seed.data_policy[field], false, `seed.data_policy.${field}`);
  }
  const baseline = seed.deduplication_baseline;
  object(
    baseline,
    ['runtime_id', 'checked_at', 'inventory_count', 'result', 'limitations'],
    'seed.deduplication_baseline',
  );
  string(baseline.runtime_id, 'seed.deduplication_baseline.runtime_id');
  timestamp(
    baseline.checked_at,
    'seed.deduplication_baseline.checked_at',
    evaluatedNs,
  );
  if (
    !Number.isSafeInteger(baseline.inventory_count) ||
    baseline.inventory_count < 0
  ) {
    invalid(
      'seed.deduplication_baseline.inventory_count',
      'must be a nonnegative safe integer',
    );
  }
  string(baseline.result, 'seed.deduplication_baseline.result');
  array(
    baseline.limitations,
    'seed.deduplication_baseline.limitations',
    0,
    100,
  );
  baseline.limitations.forEach((value, index) =>
    string(value, `seed.deduplication_baseline.limitations[${index}]`),
  );
  array(seed.records, 'seed.records', 1, 3);
  exact(seed.candidate_count, seed.records.length, 'seed.candidate_count');
  const records = new Map();
  seed.records.forEach((record, index) => {
    const path = `seed.records[${index}]`;
    object(record, SEED_RECORD_FIELDS, path);
    for (const field of SEED_RECORD_FIELDS.filter(
      (field) =>
        !['needs_manual_review', 'domain_confidence', 'evidence_urls'].includes(
          field,
        ),
    )) {
      string(record[field], `${path}.${field}`);
    }
    if (records.has(record.source_record_id))
      invalid(path, 'duplicate source_record_id');
    exact(record.municipality_code, '1480', `${path}.municipality_code`);
    exact(record.gothenburg_status, 'unresolved', `${path}.gothenburg_status`);
    exact(
      record.verification_status,
      'unresolved',
      `${path}.verification_status`,
    );
    exact(record.needs_manual_review, true, `${path}.needs_manual_review`);
    exact(record.domain_status, 'unresolved', `${path}.domain_status`);
    exact(record.domain_confidence, 0, `${path}.domain_confidence`);
    oneOf(record.segment, SEGMENTS, `${path}.segment`);
    const host = publicHost(record.website, `${path}.website`);
    publicHost(record.source_url, `${path}.source_url`);
    array(record.evidence_urls, `${path}.evidence_urls`, 1, 100);
    record.evidence_urls.forEach((url, evidenceIndex) => {
      const evidencePath = `${path}.evidence_urls[${evidenceIndex}]`;
      if (publicHost(url, evidencePath) !== host)
        invalid(evidencePath, 'seed evidence host mismatch');
    });
    timestamp(record.observed_at, `${path}.observed_at`, evaluatedNs);
    records.set(record.source_record_id, { record, host });
  });
  return records;
}

function validateObservations(
  observations,
  seedSha256,
  seedRecords,
  evaluatedNs,
) {
  const result = new Map();
  if (observations === undefined) return result;
  object(observations, ['version', 'seedSha256', 'records'], 'observations');
  exact(observations.version, OBSERVATIONS_VERSION, 'observations.version');
  exact(observations.seedSha256, seedSha256, 'observations.seedSha256');
  array(observations.records, 'observations.records', 0, seedRecords.size);
  observations.records.forEach((record, index) => {
    const path = `observations.records[${index}]`;
    object(record, OBSERVATION_FIELDS, path, ['researchPause']);
    string(record.sourceRecordId, `${path}.sourceRecordId`);
    if (!seedRecords.has(record.sourceRecordId))
      invalid(path, 'sourceRecordId is not in seed');
    if (result.has(record.sourceRecordId))
      invalid(path, 'duplicate sourceRecordId');
    const checkedNs = timestamp(
      record.checkedAt,
      `${path}.checkedAt`,
      evaluatedNs,
    );
    oneOf(
      record.identity,
      ['supported', 'unresolved', 'conflict'],
      `${path}.identity`,
    );
    oneOf(
      record.workplace,
      ['scoped', 'unresolved', 'conflict'],
      `${path}.workplace`,
    );
    oneOf(
      record.municipality,
      ['supported', 'unresolved', 'outside_scope'],
      `${path}.municipality`,
    );
    oneOf(
      record.duplicate,
      ['clear', 'possible', 'exact', 'not_checked'],
      `${path}.duplicate`,
    );
    oneOf(
      record.suppression,
      ['clear', 'blocked', 'not_checked'],
      `${path}.suppression`,
    );
    oneOf(
      record.segment,
      ['in_scope', 'out_of_scope', 'uncertain'],
      `${path}.segment`,
    );
    string(record.note, `${path}.note`, { allowEmpty: true });
    if (Object.hasOwn(record, 'researchPause')) {
      const pausePath = `${path}.researchPause`;
      object(record.researchPause, ['reason', 'resumeWhen'], pausePath);
      string(record.researchPause.reason, `${pausePath}.reason`);
      string(record.researchPause.resumeWhen, `${pausePath}.resumeWhen`);
    }
    array(record.sources, `${path}.sources`, 0, 20);
    const sources = record.sources.map((source, sourceIndex) => {
      const sourcePath = `${path}.sources[${sourceIndex}]`;
      object(source, ['url', 'role', 'retrievedAt'], sourcePath);
      const host = publicHost(source.url, `${sourcePath}.url`);
      oneOf(
        source.role,
        ['first_party', 'business_directory'],
        `${sourcePath}.role`,
      );
      const retrievedNs = timestamp(
        source.retrievedAt,
        `${sourcePath}.retrievedAt`,
        checkedNs,
      );
      return { host, role: source.role, retrievedNs };
    });
    result.set(record.sourceRecordId, { record, sources, checkedNs });
  });
  return result;
}

function independentHost(left, right) {
  return (
    left !== right && !left.endsWith(`.${right}`) && !right.endsWith(`.${left}`)
  );
}

function assessRecord(seedRecord, observation, evaluatedNs) {
  const base = {
    sourceRecordId: seedRecord.record.source_record_id,
    companyName: seedRecord.record.company_name,
    owner: 'agent',
    requiresUserInput: false,
    identityVerified: false,
    reviewDecisionRecorded: false,
  };
  const finish = (status, reasonCodes, nextAction) => ({
    ...base,
    status,
    reasonCodes,
    nextAction,
  });
  if (!observation) {
    return finish(
      'agent_research',
      ['observations_missing'],
      'research_public_company',
    );
  }
  const { record, sources, checkedNs } = observation;
  const exclusions = [];
  if (record.duplicate === 'exact') exclusions.push('exact_duplicate');
  if (record.suppression === 'blocked') exclusions.push('suppression_blocked');
  if (record.municipality === 'outside_scope')
    exclusions.push('municipality_outside_scope');
  if (exclusions.length > 0)
    return finish('agent_excluded', exclusions, 'skip_candidate');
  const deferred = [];
  if (record.identity === 'conflict') deferred.push('identity_conflict');
  if (record.workplace === 'conflict') deferred.push('workplace_conflict');
  if (record.duplicate === 'possible') deferred.push('possible_duplicate');
  if (record.segment === 'out_of_scope') deferred.push('segment_out_of_scope');
  if (record.segment === 'uncertain') deferred.push('segment_uncertain');
  if (record.researchPause) deferred.push('research_paused');
  if (deferred.length > 0) {
    return {
      ...finish('agent_deferred', deferred, 'research_or_replace_candidate'),
      ...(record.researchPause
        ? { researchPause: { ...record.researchPause } }
        : {}),
    };
  }
  const missing = [];
  if (evaluatedNs - checkedNs > MAX_AGE_NS) missing.push('observations_stale');
  if (sources.some((source) => evaluatedNs - source.retrievedNs > MAX_AGE_NS))
    missing.push('sources_stale');
  if (record.identity !== 'supported') missing.push('identity_unresolved');
  if (record.workplace !== 'scoped') missing.push('workplace_unresolved');
  if (record.municipality !== 'supported')
    missing.push('municipality_unresolved');
  if (record.duplicate !== 'clear') missing.push('duplicate_not_checked');
  if (record.suppression !== 'clear') missing.push('suppression_not_checked');
  if (
    !sources.some(
      (source) =>
        source.role === 'first_party' && source.host === seedRecord.host,
    )
  ) {
    missing.push('matching_first_party_source_missing');
  }
  if (
    !sources.some(
      (source) =>
        source.role === 'business_directory' &&
        independentHost(source.host, seedRecord.host),
    )
  ) {
    missing.push('independent_business_directory_missing');
  }
  if (missing.length > 0)
    return finish('agent_research', missing, 'research_public_company');
  return finish(
    'agent_ready_for_dry_run',
    ['local_preparation_supported'],
    'prepare_import_dry_run',
  );
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

/** Routes a proposed action; this function never authorizes or executes it. */
export function assessAction(action) {
  const decision =
    typeof action === 'string' && AGENT_ACTIONS.has(action)
      ? 'agent'
      : typeof action === 'string' && USER_ACTIONS.has(action)
        ? 'user_required'
        : 'blocked';
  return {
    action: typeof action === 'string' ? action : null,
    decision,
    reasonCode:
      decision === 'agent'
        ? 'local_preparation_in_scope'
        : decision === 'user_required'
          ? 'separate_authorization_required'
          : 'unknown_action',
    planningOnly: true,
    executionAuthorized: false,
  };
}

/**
 * Builds an offline work plan from supplied claims, not verified identities.
 * seedSha256 identifies the caller's raw seed bytes; this pure module cannot
 * attest those bytes. The CLI must calculate that digest from its exact input.
 */
export function createAutonomyPlan(input) {
  object(
    input,
    ['seed', 'seedSha256', 'observations', 'evaluatedAt'],
    'input',
    ['observations'],
  );
  const { seed, seedSha256, observations, evaluatedAt } = input;
  hash(seedSha256, 'seedSha256');
  const evaluatedNs = timestamp(evaluatedAt, 'evaluatedAt');
  const seedRecords = validateSeed(seed, evaluatedNs);
  const observationRecords = validateObservations(
    observations,
    seedSha256,
    seedRecords,
    evaluatedNs,
  );
  const records = [...seedRecords.values()]
    .sort((a, b) =>
      a.record.source_record_id < b.record.source_record_id
        ? -1
        : a.record.source_record_id > b.record.source_record_id
          ? 1
          : 0,
    )
    .map((record) =>
      assessRecord(
        record,
        observationRecords.get(record.record.source_record_id),
        evaluatedNs,
      ),
    );
  const count = (status) =>
    records.filter((record) => record.status === status).length;
  const plan = {
    version: LOCAL_AUTONOMY_VERSION,
    status: 'agent_work_planned',
    evaluatedAt,
    seedSha256,
    observationsHash: observations === undefined ? null : sha256(observations),
    records,
    summary: {
      total: records.length,
      readyForDryRun: count('agent_ready_for_dry_run'),
      research: count('agent_research'),
      deferred: count('agent_deferred'),
      excluded: count('agent_excluded'),
      userDecisionsRequired: 0,
    },
    guardrails: {
      planningOnly: true,
      executionAuthorized: false,
      databaseReads: false,
      databaseWrites: false,
      runtimeWrites: false,
      queueWrites: false,
      networkRequests: false,
      approvalMutations: false,
      identityEligibilityChanged: false,
      humanReviewDecisionsRecorded: false,
      auditRulesChanged: false,
      activeVaultWrites: false,
      outreachAuthorized: false,
      advertisingAuthorized: false,
      publicationAuthorized: false,
      sourceClaimsVerifiedByModule: false,
    },
  };
  return { ...plan, planHash: sha256(plan) };
}
