import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createAssetTypeTool = {
  name: 'create_asset_type',
  description:
    'Create an asset type in the operating model of a Collibra instance. ' +
    'This tool is idempotent: if an asset type with the same name already exists, ' +
    'the existing type is returned without creating a duplicate. ' +
    'Use this tool to fill operating model gaps when migrating assets from one instance to another. ' +
    'Optionally specify a parent_id to create the type as a sub-type of an existing asset type. ' +
    'Use get_asset_types to browse existing types and find parent type UUIDs.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the new asset type',
      },
      description: {
        type: 'string',
        description: 'Optional: A description for the asset type',
      },
      parent_id: {
        type: 'string',
        description:
          'Optional: UUID of the parent asset type. If omitted, a root-level type is created. ' +
          'Use get_asset_types to find parent type UUIDs.',
      },
      color: {
        type: 'string',
        description: 'Optional: Hex color code for the asset type icon (e.g. "#0078D4")',
      },
      symbol_type: {
        type: 'string',
        description: 'Optional: Symbol/icon identifier for the asset type',
      },
    },
    required: ['instance_name', 'name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateAssetType(args: any): Promise<ToolResult> {
  const { instance_name, name, description, parent_id, color, symbol_type } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    const checkParams = new URLSearchParams({
      name,
      nameMatchMode: 'EXACT',
      limit: '5',
      offset: '0',
    });

    const existing = await client.restCall<any>(`/rest/2.0/assetTypes?${checkParams.toString()}`);
    const match = (existing.results || []).find((t: any) => t.name === name);

    if (match) {
      return okPretty({
        action: 'existing',
        assetType: {
          id: match.id,
          name: match.name,
          description: match.description || null,
          publicId: match.publicId || null,
          parent: match.parent ? { id: match.parent.id, name: match.parent.name } : null,
        },
        message: `Asset type "${name}" already exists — no changes made.`,
      });
    }

    // ── Create ────────────────────────────────────────────────────────
    const body: any = { name };
    if (description) body.description = description;
    if (parent_id) body.parentId = parent_id;
    if (color) body.color = color;
    if (symbol_type) body.symbolType = symbol_type;

    const created = await client.restCallWithBody<any>('/rest/2.0/assetTypes', 'POST', body);

    return okPretty({
      action: 'created',
      assetType: {
        id: created.id,
        name: created.name,
        description: created.description || null,
        publicId: created.publicId || null,
        parent: created.parent ? { id: created.parent.id, name: created.parent.name } : null,
      },
    });

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
