/**
 * MCP tool annotations (readOnlyHint / destructiveHint / idempotentHint /
 * openWorldHint + title) for every registered tool.
 *
 * Hints are derived centrally so a new tool cannot ship without them: read
 * tools get the read-only defaults, and every write tool MUST have an entry in
 * WRITE_TOOL_HINTS (enforced by test/registry.test.ts).
 */

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

type WriteHints = { destructive: boolean; idempotent: boolean };

/**
 * Write tools. `destructive` = may overwrite or remove existing data (updates,
 * deletes, replace-style edits, irreversible state transitions). `idempotent`
 * = repeating the same call has no additional effect.
 */
export const WRITE_TOOL_HINTS: Record<string, WriteHints> = {
  update_asset_description: { destructive: true, idempotent: true },
  bulk_update_asset_descriptions: { destructive: true, idempotent: true },
  update_asset_attribute: { destructive: true, idempotent: true },
  bulk_update_asset_attributes: { destructive: true, idempotent: true },
  create_asset: { destructive: false, idempotent: false },
  add_business_term: { destructive: false, idempotent: false },
  bulk_create_assets: { destructive: false, idempotent: false },
  add_data_classification_match: { destructive: false, idempotent: false },
  remove_data_classification_match: { destructive: true, idempotent: true },
  push_data_contract_manifest: { destructive: true, idempotent: true },
  init_data_contract: { destructive: false, idempotent: true },
  create_assessment: { destructive: false, idempotent: false },
  update_assessment: { destructive: true, idempotent: true },
  edit_assessment: { destructive: true, idempotent: false },
  retake_assessment: { destructive: false, idempotent: false },
  create_community: { destructive: false, idempotent: true },
  create_domain: { destructive: false, idempotent: true },
  create_relation: { destructive: false, idempotent: true },
  bulk_create_relations: { destructive: false, idempotent: true },
  create_asset_type: { destructive: false, idempotent: true },
  create_relation_type: { destructive: false, idempotent: true },
  bulk_delete_assets: { destructive: true, idempotent: true },
  bulk_delete_relations: { destructive: true, idempotent: true },
  edit_asset: { destructive: true, idempotent: false },
  create_attribute_type: { destructive: false, idempotent: true },
  assign_attribute_to_asset_type: { destructive: false, idempotent: true },
  add_comment: { destructive: false, idempotent: false },
  add_mapping: { destructive: false, idempotent: true },
  remove_mapping: { destructive: true, idempotent: true },
  undo_write: { destructive: true, idempotent: false },
};

export const WRITE_TOOL_NAMES = Object.keys(WRITE_TOOL_HINTS);

/** Tools that reach systems outside the configured Collibra instances. */
const OPEN_WORLD_TOOLS = new Set(['search_star_wars', 'search_subject']);

const ACRONYMS: Record<string, string> = { id: 'ID', api: 'API', dq: 'DQ' };

/** `get_asset_by_id` → `Get Asset By ID`. */
export function humanizeToolName(name: string): string {
  return name
    .split('_')
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function annotationsFor(name: string): ToolAnnotations {
  const write = WRITE_TOOL_HINTS[name];
  return {
    title: humanizeToolName(name),
    readOnlyHint: !write,
    destructiveHint: write?.destructive ?? false,
    idempotentHint: write?.idempotent ?? true,
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}
