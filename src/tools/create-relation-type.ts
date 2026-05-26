import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createRelationTypeTool = {
  name: 'create_relation_type',
  description:
    'Create a relation type in the operating model of a Collibra instance. ' +
    'A relation type defines how two asset types may be linked: it specifies the source asset type, ' +
    'target asset type, a "role" label (source→target) and a "co-role" label (target→source). ' +
    'This tool is idempotent: if a relation type with the same role, co-role, source type and target type ' +
    'already exists, the existing type is returned without creating a duplicate. ' +
    'Use this tool to fill operating model gaps when migrating relations from one instance to another. ' +
    'Use get_relation_types and get_asset_types to find the source/target asset type UUIDs.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      role: {
        type: 'string',
        description: 'Label for the relation in the source→target direction (e.g. "contains", "is part of")',
      },
      corole: {
        type: 'string',
        description: 'Label for the relation in the target→source direction (e.g. "is contained by", "contains")',
      },
      source_asset_type_id: {
        type: 'string',
        description: 'UUID of the source asset type. Use get_asset_types to find this.',
      },
      target_asset_type_id: {
        type: 'string',
        description: 'UUID of the target asset type. Use get_asset_types to find this.',
      },
      description: {
        type: 'string',
        description: 'Optional: A description for the relation type',
      },
    },
    required: ['instance_name', 'role', 'corole', 'source_asset_type_id', 'target_asset_type_id'],
  },
};

export async function executeCreateRelationType(args: any): Promise<string> {
  const { instance_name, role, corole, source_asset_type_id, target_asset_type_id, description } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    // Filter by role; then match co-role + source + target from results
    const checkParams = new URLSearchParams({
      role,
      limit: '100',
      offset: '0',
    });

    const existing = await client.restCall<any>(`/rest/2.0/relationTypes?${checkParams.toString()}`);
    const match = (existing.results || []).find(
      (rt: any) =>
        rt.role === role &&
        rt.corole === corole &&
        rt.sourceType?.id === source_asset_type_id &&
        rt.targetType?.id === target_asset_type_id,
    );

    if (match) {
      return JSON.stringify({
        action: 'existing',
        relationType: {
          id: match.id,
          role: match.role,
          corole: match.corole,
          sourceType: match.sourceType ? { id: match.sourceType.id, name: match.sourceType.name } : null,
          targetType: match.targetType ? { id: match.targetType.id, name: match.targetType.name } : null,
        },
        message: `Relation type "${role} / ${corole}" already exists — no changes made.`,
      }, null, 2);
    }

    // ── Create ────────────────────────────────────────────────────────
    const body: any = {
      role,
      corole,
      sourceTypeId: source_asset_type_id,
      targetTypeId: target_asset_type_id,
    };
    if (description) body.description = description;

    const created = await client.restCallWithBody<any>('/rest/2.0/relationTypes', 'POST', body);

    return JSON.stringify({
      action: 'created',
      relationType: {
        id: created.id,
        role: created.role,
        corole: created.corole,
        sourceType: created.sourceType ? { id: created.sourceType.id, name: created.sourceType.name } : null,
        targetType: created.targetType ? { id: created.targetType.id, name: created.targetType.name } : null,
      },
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
