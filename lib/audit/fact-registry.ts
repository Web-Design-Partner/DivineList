import { AUDIT_RULES } from './catalog';
import {
  FACT_REGISTRY_VERSION,
  type AuditFact,
  type Condition,
  type EvidenceMethod,
  type FactValue,
} from './types';

export type FactKind = 'boolean' | 'number' | 'string' | 'null' | 'array';

export interface FactDefinition {
  key: string;
  registryVersion: typeof FACT_REGISTRY_VERSION;
  kinds: FactKind[];
  unit: string | null;
  scope: 'page' | 'site' | 'business' | 'run';
  unknownSemantics: 'omit';
  allowedMethods: EvidenceMethod[];
  minimumEvidence: number;
  freshnessDays: number;
  negativeEvidenceRequired: boolean;
  allowedActors: Array<'human' | 'tool'>;
  sideEffectRisk: 'none' | 'read_only' | 'external_write';
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}

const clauses = (
  condition: Condition,
): Array<Extract<Condition, { fact: string }>> => {
  if ('fact' in condition) return [condition];
  return ('all' in condition ? condition.all : condition.any).flatMap(clauses);
};

const kindOf = (value: FactValue | undefined): FactKind | null => {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as Exclude<FactKind, 'null' | 'array'>;
};

const scopeFor = (key: string): FactDefinition['scope'] => {
  if (key.startsWith('business.') || key.startsWith('local.'))
    return 'business';
  if (key.startsWith('availability.last_30d')) return 'run';
  if (
    key.startsWith('availability.') ||
    key.startsWith('crawl.') ||
    key.startsWith('operations.') ||
    key.startsWith('transport.') ||
    key.startsWith('security.') ||
    key.startsWith('seo.duplicate_') ||
    key.startsWith('seo.thin_')
  )
    return 'site';
  return 'page';
};

const numericConstraintsFor = (
  key: string,
): Pick<FactDefinition, 'minimum' | 'maximum' | 'integer'> => {
  if (key === 'availability.http_status')
    return { minimum: 100, maximum: 599, integer: true };
  if (key.endsWith('_percent')) return { minimum: 0, maximum: 100 };
  if (
    key.endsWith('_count') ||
    key.endsWith('_depth') ||
    key.endsWith('_hops') ||
    key.endsWith('_length') ||
    key.endsWith('_px')
  )
    return { minimum: 0, integer: true };
  if (key.endsWith('_ms') || key.endsWith('_kb') || key.endsWith('_cls'))
    return { minimum: 0 };
  return {};
};

const freezeFactDefinition = (definition: FactDefinition): FactDefinition => {
  Object.freeze(definition.kinds);
  Object.freeze(definition.allowedMethods);
  Object.freeze(definition.allowedActors);
  return Object.freeze(definition);
};

const unitFor = (key: string): string | null => {
  if (key.endsWith('_ms')) return 'milliseconds';
  if (key.endsWith('_kb')) return 'kilobytes';
  if (key.endsWith('_percent')) return 'percent';
  if (key.endsWith('_count')) return 'count';
  return null;
};

const buildRegistry = (): Map<string, FactDefinition> => {
  const draft = new Map<
    string,
    { kinds: Set<FactKind>; methods: Set<EvidenceMethod>; freshness: number }
  >();
  for (const rule of AUDIT_RULES) {
    const ruleClauses = [
      ...clauses(rule.condition),
      ...(rule.appliesWhen ? clauses(rule.appliesWhen) : []),
    ];
    for (const clause of ruleClauses) {
      const current = draft.get(clause.fact) ?? {
        kinds: new Set<FactKind>(),
        methods: new Set<EvidenceMethod>(),
        freshness: rule.maxEvidenceAgeDays,
      };
      const inferred = kindOf(clause.value);
      if (inferred) current.kinds.add(inferred);
      if (['gt', 'gte', 'lt', 'lte'].includes(clause.operator))
        current.kinds.add('number');
      if (['includes', 'not_includes'].includes(clause.operator)) {
        current.kinds.add('string');
        current.kinds.add('array');
      }
      if (['empty', 'not_empty'].includes(clause.operator)) {
        current.kinds.add('string');
        current.kinds.add('array');
        current.kinds.add('null');
      }
      for (const method of rule.evidenceMethodsByFact[clause.fact] ?? [])
        current.methods.add(method);
      current.freshness = Math.min(current.freshness, rule.maxEvidenceAgeDays);
      draft.set(clause.fact, current);
    }
  }
  return new Map(
    [...draft.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        freezeFactDefinition({
          key,
          registryVersion: FACT_REGISTRY_VERSION,
          kinds: [...value.kinds].sort(),
          unit: unitFor(key),
          scope: scopeFor(key),
          unknownSemantics: 'omit',
          allowedMethods: [...value.methods].sort(),
          minimumEvidence: 1,
          freshnessDays: value.freshness,
          negativeEvidenceRequired: true,
          allowedActors: ['human', 'tool'],
          sideEffectRisk:
            key.startsWith('forms.') || key.startsWith('commerce.')
              ? 'external_write'
              : 'read_only',
          ...numericConstraintsFor(key),
        }),
      ]),
  );
};

export const FACT_REGISTRY: ReadonlyMap<string, FactDefinition> =
  buildRegistry();

export const factKind = (value: FactValue): FactKind => {
  const kind = kindOf(value);
  if (!kind) throw new Error('Fact value is missing.');
  return kind;
};

export const validateFact = (fact: AuditFact): string | null => {
  const definition = FACT_REGISTRY.get(fact.key);
  if (!definition) return `${fact.key}: okänd faktanyckel.`;
  const actualKind = factKind(fact.value);
  if (!definition.kinds.includes(actualKind))
    return `${fact.key}: förväntade ${definition.kinds.join('/')} men fick ${actualKind}.`;
  if (typeof fact.value === 'number') {
    if (definition.integer && !Number.isInteger(fact.value))
      return `${fact.key}: måste vara ett heltal.`;
    if (definition.minimum !== undefined && fact.value < definition.minimum)
      return `${fact.key}: får inte understiga ${definition.minimum}.`;
    if (definition.maximum !== undefined && fact.value > definition.maximum)
      return `${fact.key}: får inte överstiga ${definition.maximum}.`;
  }
  return null;
};

export const factRegistryJson = (): string =>
  JSON.stringify(
    {
      version: FACT_REGISTRY_VERSION,
      facts: [...FACT_REGISTRY.values()],
    },
    null,
    2,
  );
