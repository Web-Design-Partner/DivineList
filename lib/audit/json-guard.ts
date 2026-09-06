export type JsonStructureLimits = {
  maxDepth: number;
  maxIssues?: number;
  maxNodes: number;
  rootLabel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

/**
 * Iterative guard for portable JSON artifacts before hashing or recursive work.
 * It prevents deep or oversized structures, non-finite numbers and ambiguous
 * UTF-16 from reaching the canonical JSON serializer.
 */
export const inspectPortableJsonStructure = (
  value: unknown,
  limits: JsonStructureLimits,
): string[] => {
  const issues: string[] = [];
  const maxIssues = Math.max(1, limits.maxIssues ?? Number.MAX_SAFE_INTEGER);
  type WorkItem =
    | { kind: 'value'; value: unknown; path: string; depth: number }
    | {
        kind: 'array';
        value: unknown[];
        index: number;
        path: string;
        depth: number;
      }
    | {
        kind: 'object';
        value: Record<string, unknown>;
        keys: string[];
        index: number;
        path: string;
        depth: number;
      };
  const stack: WorkItem[] = [
    { kind: 'value', value, path: limits.rootLabel, depth: 0 },
  ];
  let nodeCount = 0;

  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.kind === 'array') {
      if (entry.index >= entry.value.length) continue;
      stack.push({ ...entry, index: entry.index + 1 });
      stack.push({
        kind: 'value',
        value: entry.value[entry.index],
        path: `${entry.path}[${entry.index}]`,
        depth: entry.depth + 1,
      });
      continue;
    }
    if (entry.kind === 'object') {
      if (entry.index >= entry.keys.length) continue;
      const key = entry.keys[entry.index];
      if (hasUnpairedSurrogate(key))
        issues.push(
          `${entry.path}: innehåller ett ogiltigt UTF-16-surrogat i ett fältnamn.`,
        );
      if (issues.length >= maxIssues) break;
      stack.push({ ...entry, index: entry.index + 1 });
      stack.push({
        kind: 'value',
        value: entry.value[key],
        path: `${entry.path}.${key}`,
        depth: entry.depth + 1,
      });
      continue;
    }
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      issues.push(
        `${limits.rootLabel}: innehåller fler än ${limits.maxNodes.toLocaleString('sv-SE')} JSON-noder.`,
      );
      break;
    }
    if (entry.depth > limits.maxDepth) {
      issues.push(
        `${entry.path}: JSON-strukturen är djupare än ${limits.maxDepth} nivåer.`,
      );
      if (issues.length >= maxIssues) break;
      continue;
    }
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) {
      issues.push(`${entry.path}: innehåller ett tal som inte är ändligt.`);
      if (issues.length >= maxIssues) break;
      continue;
    }
    if (typeof entry.value === 'string') {
      if (hasUnpairedSurrogate(entry.value))
        issues.push(
          `${entry.path}: innehåller ett ogiltigt ensamt UTF-16-surrogat.`,
        );
      if (issues.length >= maxIssues) break;
      continue;
    }
    if (Array.isArray(entry.value)) {
      stack.push({
        kind: 'array',
        value: entry.value,
        index: 0,
        path: entry.path,
        depth: entry.depth,
      });
      continue;
    }
    if (isRecord(entry.value)) {
      stack.push({
        kind: 'object',
        value: entry.value,
        keys: Object.keys(entry.value),
        index: 0,
        path: entry.path,
        depth: entry.depth,
      });
    }
  }

  return issues;
};
