import Ajv from 'ajv';

/**
 * Runtime validation of tool arguments against each tool's `inputSchema`.
 *
 * Before this, schemas were advisory only: wrong types, out-of-range limits,
 * unknown enum values and non-UUID ids flowed straight into Collibra URLs and
 * GraphQL queries. Validation also coerces scalar types ("42" → 42) and
 * applies schema defaults.
 */

export const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const UUID_RE = new RegExp(UUID_PATTERN);

/** True when `value` is a canonical UUID string. */
export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Parameter names that always carry a Core REST UUID. Deliberately an
 * allowlist: lineage, assessment, workflow, mapping and data-contract ids use
 * other formats and are not constrained here.
 */
const UUID_PARAMS = new Set([
  'asset_id', 'asset_ids', 'asset_type_id', 'asset_type_ids', 'attribute_type_id', 'attribute_type_ids',
  'community_id', 'community_ids', 'domain_id', 'domain_ids', 'domain_type_id', 'relation_type_id',
  'relation_ids', 'source_asset_id', 'target_asset_id', 'source_asset_type_id', 'target_asset_type_id',
  'status_id', 'table_asset_id', 'column_asset_id', 'term_asset_id', 'measure_asset_id',
  'mapped_resource_id', 'base_resource_id', 'resource_id', 'context_id', 'governed_asset_id',
  'parent_id', 'type_id', 'user_id', 'performed_by_user_id', 'group_id', 'dgc_asset_id',
  // get_asset_by_id relation cursors are relation UUIDs (used in an id > cursor filter).
  'outgoing_relations_cursor', 'incoming_relations_cursor',
]);

/** Largest page Core REST accepts; also a sane ceiling for every other list tool. */
const MAX_LIMIT = 1000;

/**
 * Add constraints that every tool should have but none declared: UUID
 * patterns on id parameters, and bounds on limit/offset. Returns a new schema;
 * explicit constraints already present in a tool's schema win.
 */
export function normalizeInputSchema<T>(schema: T): T {
  const copy = structuredClone(schema) as any;
  constrain(copy);
  return copy;
}

function constrain(schema: any): void {
  if (!schema || typeof schema !== 'object') return;
  for (const [name, prop] of Object.entries<any>(schema.properties ?? {})) {
    const isNumber = prop.type === 'number' || prop.type === 'integer';
    if (UUID_PARAMS.has(name)) {
      if (prop.type === 'string' && !prop.pattern) prop.pattern = UUID_PATTERN;
      if (prop.type === 'array' && prop.items?.type === 'string' && !prop.items.pattern) prop.items.pattern = UUID_PATTERN;
    }
    if (isNumber && (name === 'limit' || name.endsWith('_limit'))) {
      prop.minimum ??= 1;
      prop.maximum ??= MAX_LIMIT;
    }
    if (isNumber && (name === 'offset' || name.endsWith('_offset'))) prop.minimum ??= 0;
    if (prop.type === 'array' && prop.items?.type === 'object') constrain(prop.items);
    if (prop.type === 'object') constrain(prop);
  }
}

/** Raised for arguments that do not match a tool's input schema. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const ajv = new (Ajv as any)({ strict: false, allErrors: true, coerceTypes: true, useDefaults: true, allowUnionTypes: true });
const validators = new Map<string, any>();

/**
 * Validate (and coerce/default) `args` for `toolName` against `schema`.
 * Returns a validated copy; the caller's object is never mutated.
 */
export function validateToolArgs(toolName: string, schema: any, args: unknown): any {
  if (!schema) return args;
  let validate = validators.get(toolName);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(toolName, validate);
  }
  const copy = structuredClone(args ?? {});
  if (!validate(copy)) {
    const problems = (validate.errors as any[]).map((e) => {
      const at = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(arguments)';
      if (e.keyword === 'pattern' && e.params?.pattern === UUID_PATTERN) return `${at} must be a UUID`;
      if (e.keyword === 'enum') return `${at} must be one of: ${e.params.allowedValues.join(', ')}`;
      if (e.keyword === 'required') return `missing required argument "${e.params.missingProperty}"`;
      return `${at} ${e.message}`;
    });
    throw new ToolInputError(`Invalid arguments for ${toolName}: ${[...new Set(problems)].join('; ')}.`);
  }
  return copy;
}
