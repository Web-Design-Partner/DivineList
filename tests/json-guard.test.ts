/* oxlint-disable typescript/no-floating-promises -- node:test registers each returned promise with the runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPortableJsonStructure } from '../lib/audit/json-guard';
import {
  buildReviewSession,
  parseReviewSessionJson,
  ReviewSessionValidationError,
} from '../lib/audit/review-session';
import { SAMPLE_DATASET } from '../lib/audit/sample-data';

const limits = { maxDepth: 32, maxNodes: 100, rootLabel: 'json' };

test('portabel JSON bevarar ändliga tal och stoppar numerisk overflow', () => {
  assert.deepEqual(
    inspectPortableJsonStructure(
      { values: [null, 0, -1.5, Number.MAX_VALUE, Number.MIN_VALUE] },
      limits,
    ),
    [],
  );
  for (const value of [Infinity, -Infinity, NaN]) {
    assert.deepEqual(
      inspectPortableJsonStructure({ values: [value] }, limits),
      ['json.values[0]: innehåller ett tal som inte är ändligt.'],
    );
  }
  assert.equal(
    inspectPortableJsonStructure([Infinity, -Infinity], {
      ...limits,
      maxIssues: 1,
    }).length,
    1,
  );
});

test('granskningssession identifierar numerisk overflow före hashverifiering', () => {
  const session = buildReviewSession(
    SAMPLE_DATASET,
    SAMPLE_DATASET.createdAt,
    {},
  );
  const validJson = JSON.stringify(session);
  assert.doesNotThrow(() => parseReviewSessionJson(validJson));

  for (const overflow of ['1e400', '-1e400']) {
    const malformed = validJson.replace(
      /"value":(?:true|false)/u,
      `"value":${overflow}`,
    );
    assert.notEqual(malformed, validJson);
    assert.throws(
      () => parseReviewSessionJson(malformed),
      (error: unknown) =>
        error instanceof ReviewSessionValidationError &&
        error.issues.some((issue) => issue.includes('inte är ändligt')),
    );
  }
});
