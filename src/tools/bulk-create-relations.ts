import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const bulkCreateRelationsTool = {
  name: 'bulk_create_relations',
  description:
    'Create multiple typed relations between assets in a single POST /rest/2.0/relations/bulk call. ' +
    'Far more efficient than calling create_relation N times. ' +
    'Idempotent: existing (source, target, type) triples are detected during preview and skipped during apply. ' +
    'Two-step safety: ' +
    '1) Call with confirm=false (default) to PREVIEW which relations are new vs. already present. ' +
    '2) Call again with confirm=true to APPLY. ' +
    'For a SINGLE relation prefer create_relation (no preview round trip).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      relations: {
        type: 'array',
        minItems: 1,
        description: 'Array of relations to create. Each entry mirrors the input of create_relation.',
        items: {
          type: 'object',
          properties: {
            source_asset_id: { type: 'string', description: 'UUID of the source asset.' },
            target_asset_id: { type: 'string', description: 'UUID of the target asset.' },
            relation_type_id: { type: 'string', description: 'UUID of the relation type (from get_relation_types).' },
          },
          required: ['source_asset_id', 'target_asset_id', 'relation_type_id'],
        },
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually create the relations. When false (default), returns a preview classifying each input as NEW or EXISTING.',
        default: false,
      },
    },
    required: ['instance_name', 'relations'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeBulkCreateRelations(args: any): Promise<ToolResult> {
  const { instance_name, relations, confirm = false } = args;

  if (!Array.isArray(relations) || relations.length === 0) {
    return ok({ error: 'relations must be a non-empty array of relation descriptors.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Group by (sourceId, typeId) so we issue at most one GET per unique pair
    const groupKey = (r: any) => `${r.source_asset_id}|${r.relation_type_id}`;
    const groups = new Map<string, { source_asset_id: string; relation_type_id: string }>();
    for (const r of relations) {
      groups.set(groupKey(r), { source_asset_id: r.source_asset_id, relation_type_id: r.relation_type_id });
    }

    // For each unique pair, fetch existing target IDs
    const existingByKey = new Map<string, Set<string>>();
    await Promise.all(
      Array.from(groups.values()).map(async (g) => {
        const params = new URLSearchParams({
          sourceId: g.source_asset_id,
          typeId: g.relation_type_id,
          limit: '1000',
          offset: '0',
        });
        try {
          const resp = await client.restCall<any>(`/rest/2.0/relations?${params.toString()}`);
          const targets = new Set<string>((resp.results || []).map((r: any) => r.target?.id).filter(Boolean));
          existingByKey.set(`${g.source_asset_id}|${g.relation_type_id}`, targets);
        } catch {
          existingByKey.set(`${g.source_asset_id}|${g.relation_type_id}`, new Set());
        }
      }),
    );

    const classified = relations.map((r: any) => {
      const targets = existingByKey.get(groupKey(r)) || new Set<string>();
      return { input: r, existing: targets.has(r.target_asset_id) };
    });

    const newOnes = classified.filter((c) => !c.existing);
    const existingOnes = classified.filter((c) => c.existing);

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        totalRequested: relations.length,
        toCreate: newOnes.length,
        alreadyExist: existingOnes.length,
        details: classified.map((c) => ({
          source_asset_id: c.input.source_asset_id,
          target_asset_id: c.input.target_asset_id,
          relation_type_id: c.input.relation_type_id,
          action: c.existing ? 'SKIP (already exists)' : 'CREATE',
        })),
        instructions: 'To apply, call again with confirm=true.',
      });
    }

    if (newOnes.length === 0) {
      return okPretty({
        mode: 'APPLIED',
        totalRequested: relations.length,
        created: 0,
        skipped: existingOnes.length,
        message: 'All requested relations already exist — nothing to do.',
      });
    }

    const bulkBody = newOnes.map((c) => ({
      sourceId: c.input.source_asset_id,
      targetId: c.input.target_asset_id,
      typeId: c.input.relation_type_id,
    }));

    const created = await client.restCallWithBody<any[]>('/rest/2.0/relations/bulk', 'POST', bulkBody);

    return okWithNext({
      mode: 'APPLIED',
      totalRequested: relations.length,
      created: created.length,
      skipped: existingOnes.length,
      details: classified.map((c, idx) => {
        if (c.existing) {
          return {
            source_asset_id: c.input.source_asset_id,
            target_asset_id: c.input.target_asset_id,
            relation_type_id: c.input.relation_type_id,
            action: 'SKIPPED (existing)',
          };
        }
        const createdIndex = newOnes.findIndex((n) => n === c);
        const r = created[createdIndex];
        return {
          source_asset_id: c.input.source_asset_id,
          target_asset_id: c.input.target_asset_id,
          relation_type_id: c.input.relation_type_id,
          action: 'CREATED',
          relationId: r?.id,
        };
      }),
    }, [
      { tool: 'get_asset_relations', args: { instance_name, asset_id: '<any source_asset_id>' }, why: 'Verify the new relations appear on the source asset.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
