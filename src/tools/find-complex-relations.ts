import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findComplexRelationsTool = {
  name: 'find_complex_relations',
  description:
    'Find complex relations — multi-leg relations connecting 3+ assets with optional attributes ' +
    '(e.g. a mapping relation joining Source Column ↔ Transformation ↔ Target Column). ' +
    'Filter by an involved asset (asset_id) and/or complex relation type public IDs. ' +
    'Returns each relation\'s legs (role, co-role, and the asset on each leg) and attributes.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of an asset — only complex relations involving it.',
      },
      type_public_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Public IDs of the complex relation types to include.',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 100, max: 1000).',
        default: 100,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset (default: 0).',
        default: 0,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Envelope with data.complexRelations: legs and attributes per relation.',
    additionalProperties: true,
  },
};

export async function executeFindComplexRelations(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, type_public_ids, limit = 100, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (asset_id) qp.set('assetId', asset_id);
    for (const t of type_public_ids ?? []) qp.append('typePublicIds', t);

    const resp = await client.restCall<any>(`/rest/2.0/complexRelations?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const complexRelations = results.map((cr) => ({
      id: cr.id,
      type: cr.type ? { id: cr.type.id, name: cr.type.name } : null,
      legs: (cr.legs || []).map((leg: any) => ({
        role: leg.role ?? null,
        coRole: leg.coRole ?? leg.corole ?? null,
        asset: leg.asset ? { id: leg.asset.id, name: leg.asset.name, url: client.assetUrl(leg.asset.id) } : null,
      })),
      attributes: cr.attributes ?? undefined,
    }));

    return withEnvelope({
      instance: instance_name,
      operation: 'find_complex_relations',
      data: { count: complexRelations.length, total: resp.total ?? null, complexRelations },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_complex_relations',
      message: (error as Error).message,
    });
  }
}
