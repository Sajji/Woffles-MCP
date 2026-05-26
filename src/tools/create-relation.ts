import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createRelationTool = {
  name: 'create_relation',
  description:
    'Create a typed relationship between two assets in a Collibra instance. ' +
    'This tool is idempotent: if a relation of the same type already exists between the two assets, ' +
    'the existing relation is returned without creating a duplicate. ' +
    'Use get_relation_types to find the relation_type_id. ' +
    'Use get_asset_relations on the source asset to verify what relations already exist before calling this tool. ' +
    'Returns the relation id regardless of whether it was newly created or already existed.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      source_asset_id: {
        type: 'string',
        description: 'UUID of the source asset (the asset in the "role" position of the relation type)',
      },
      target_asset_id: {
        type: 'string',
        description: 'UUID of the target asset (the asset in the "co-role" position of the relation type)',
      },
      relation_type_id: {
        type: 'string',
        description:
          'UUID of the relation type that defines the relationship semantics. ' +
          'Use get_relation_types to find valid relation type IDs.',
      },
    },
    required: ['instance_name', 'source_asset_id', 'target_asset_id', 'relation_type_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateRelation(args: any): Promise<ToolResult> {
  const { instance_name, source_asset_id, target_asset_id, relation_type_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    // Look for an existing relation of the same type from the same source
    const checkParams = new URLSearchParams({
      sourceId: source_asset_id,
      typeId: relation_type_id,
      limit: '100',
      offset: '0',
    });

    const existing = await client.restCall<any>(`/rest/2.0/relations?${checkParams.toString()}`);
    const match = (existing.results || []).find(
      (r: any) => r.target?.id === target_asset_id,
    );

    if (match) {
      return okPretty({
        action: 'existing',
        relation: {
          id: match.id,
          type: match.type ? { id: match.type.id, role: match.type.role, corole: match.type.corole } : null,
          source: { id: match.source?.id, name: match.source?.fullName ?? match.source?.name },
          target: { id: match.target?.id, name: match.target?.fullName ?? match.target?.name },
        },
        message: 'Relation already exists — no changes made.',
      });
    }

    // ── Create ────────────────────────────────────────────────────────
    const body = {
      sourceId: source_asset_id,
      targetId: target_asset_id,
      typeId: relation_type_id,
    };

    const created = await client.restCallWithBody<any>('/rest/2.0/relations', 'POST', body);

    return okPretty({
      action: 'created',
      relation: {
        id: created.id,
        type: created.type ? { id: created.type.id, role: created.type.role, corole: created.type.corole } : null,
        source: { id: created.source?.id, name: created.source?.fullName ?? created.source?.name },
        target: { id: created.target?.id, name: created.target?.fullName ?? created.target?.name },
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
