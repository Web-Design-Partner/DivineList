import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_VERSION = 'foretagskarta.company-seeds.v1';
const MAX_RECORDS = 3;

const allowedRecordFields = new Set([
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
]);

const requiredStringFields = [
  'source_record_id',
  'company_name',
  'workplace_name',
  'street_address',
  'postal_code',
  'municipality_code',
  'verification_note',
  'segment',
  'website',
  'source_url',
  'observed_at',
];

const allowedSegments = new Set([
  'frisör/skönhet',
  'restaurang/café',
  'hälsa/friskvård',
  'hantverk/hemservice',
  'specialbutik/annan lokal konsumenttjänst',
]);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function samePublicHost(left, right) {
  const normalize = (value) =>
    new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  return normalize(left) === normalize(right);
}

function addError(errors, row, code, details = {}) {
  errors.push({ row, code, ...details });
}

function validateRecord(record, index, errors, sourceIds) {
  const row = index + 1;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    addError(errors, row, 'record_must_be_object');
    return;
  }

  const unknownFields = Object.keys(record)
    .filter((field) => !allowedRecordFields.has(field))
    .sort();
  if (unknownFields.length > 0) {
    addError(errors, row, 'unknown_record_fields', { fields: unknownFields });
  }

  for (const field of requiredStringFields) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      addError(errors, row, 'missing_required_string', { field });
    }
  }

  if (typeof record.source_record_id === 'string') {
    if (sourceIds.has(record.source_record_id)) {
      addError(errors, row, 'duplicate_source_record_id', {
        source_record_id: record.source_record_id,
      });
    }
    sourceIds.add(record.source_record_id);
  }

  if (record.municipality_code !== '1480') {
    addError(errors, row, 'municipality_must_be_goteborg_candidate');
  }
  if (record.gothenburg_status !== 'unresolved') {
    addError(errors, row, 'unsafe_gothenburg_status');
  }
  if (record.verification_status !== 'unresolved') {
    addError(errors, row, 'unsafe_verification_status');
  }
  if (record.needs_manual_review !== true) {
    addError(errors, row, 'manual_review_must_be_true');
  }
  if (record.domain_status !== 'unresolved') {
    addError(errors, row, 'unsafe_domain_status');
  }
  if (record.domain_confidence !== 0) {
    addError(errors, row, 'domain_confidence_must_be_zero');
  }
  if (!allowedSegments.has(record.segment)) {
    addError(errors, row, 'unknown_segment', { value: record.segment });
  }

  for (const field of ['website', 'source_url']) {
    try {
      const url = new URL(record[field]);
      if (url.protocol !== 'https:') {
        addError(errors, row, 'url_must_use_https', { field });
      }
    } catch {
      addError(errors, row, 'invalid_url', { field });
    }
  }

  if (
    !Array.isArray(record.evidence_urls) ||
    record.evidence_urls.length === 0
  ) {
    addError(errors, row, 'evidence_urls_required');
  } else {
    for (const [evidenceIndex, value] of record.evidence_urls.entries()) {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') {
          addError(errors, row, 'evidence_url_must_use_https', {
            evidenceIndex,
          });
        }
        if (!samePublicHost(record.website, value)) {
          addError(errors, row, 'evidence_host_mismatch', { evidenceIndex });
        }
      } catch {
        addError(errors, row, 'invalid_evidence_url', { evidenceIndex });
      }
    }
  }

  if (Number.isNaN(Date.parse(record.observed_at))) {
    addError(errors, row, 'invalid_observed_at');
  }
}

function main() {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) {
    console.error(
      'Användning: node scripts/preflight-company-seeds.mjs <company-seeds.json>',
    );
    process.exit(1);
  }

  const path = resolve(input);
  let bytes;
  let data;
  try {
    bytes = readFileSync(path);
    data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: 'FAIL',
          input: path,
          errors: [
            { code: 'unreadable_or_invalid_json', message: error.message },
          ],
          databaseWrites: false,
          networkRequests: false,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ code: 'root_must_be_object' });
  }
  if (data?.schema_version !== SCHEMA_VERSION) {
    errors.push({ code: 'schema_version_mismatch', expected: SCHEMA_VERSION });
  }
  if (!Array.isArray(data?.records)) {
    errors.push({ code: 'records_must_be_array' });
  }

  const records = Array.isArray(data?.records) ? data.records : [];
  if (records.length === 0 || records.length > MAX_RECORDS) {
    errors.push({
      code: 'record_count_out_of_bounds',
      minimum: 1,
      maximum: MAX_RECORDS,
    });
  }
  if (data?.candidate_count !== records.length) {
    errors.push({
      code: 'candidate_count_mismatch',
      declared: data?.candidate_count,
      actual: records.length,
    });
  }
  if (data?.database_import_performed !== false) {
    errors.push({ code: 'database_import_performed_must_be_false' });
  }
  if (data?.algorithm_evaluation_performed !== false) {
    errors.push({ code: 'algorithm_evaluation_performed_must_be_false' });
  }
  if (data?.human_decision_required !== true) {
    errors.push({ code: 'human_decision_required_must_be_true' });
  }

  const sourceIds = new Set();
  records.forEach((record, index) =>
    validateRecord(record, index, errors, sourceIds),
  );

  const report = {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    schemaVersion: data?.schema_version ?? null,
    input: path,
    inputBytes: bytes.length,
    inputSha256: sha256(bytes),
    records: records.length,
    maxRecords: MAX_RECORDS,
    errors,
    capabilities: {
      databaseReads: false,
      databaseWrites: false,
      networkRequests: false,
      queueWrites: false,
      outreachWrites: false,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(errors.length === 0 ? 0 : 2);
}

main();
