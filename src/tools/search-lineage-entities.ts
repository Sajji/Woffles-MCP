import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const searchLineageEntitiesTool = {
  name: 'search_lineage_entities',
  description: 'Search for technical lineage entities by name, type, or DGC asset UUID. ' +
    'Use this to find the technical lineage entity ID needed by the lineage upstream/downstream tools. ' +
    'Common entity types: Column, Table, Database, Schema, Process. ' +
    'You can search by partial name or link to a known DGC (Collibra) asset UUID.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      name_contains: {
        type: 'string',
        description: 'Optional: Search for entities whose name contains this string',
      },
      entity_type: {
        type: 'string',
        description: 'Optional: Filter by entity type (e.g., Column, Table, Database, Schema, Process)',
      },
      dgc_asset_id: {
        type: 'string',
        description: 'Optional: Find the lineage entity linked to a specific DGC (Collibra) asset UUID',
      },
      cursor: {
        type: 'string',
        description: 'Optional: Pagination cursor from a previous response to fetch the next page',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum results per page (default: 20, max: 100)',
        default: 20,
      },
    },
    required: ['instance_name'],
  },
};

export async function executeSearchLineageEntities(args: any): Promise<string> {
  const { instance_name, name_contains, entity_type, dgc_asset_id, cursor, limit = 20 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (name_contains) params.append('nameContains', name_contains);
    if (entity_type) params.append('type', entity_type);
    if (dgc_asset_id) params.append('dgcId', dgc_asset_id);
    if (cursor) params.append('cursor', cursor);
    params.append('limit', String(Math.min(limit, 100)));

    const queryString = params.toString();
    const endpoint = `${LINEAGE_BASE}/entities${queryString ? '?' + queryString : ''}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      searchParams: {
        nameContains: name_contains || null,
        entityType: entity_type || null,
        dgcAssetId: dgc_asset_id || null,
      },
      ...response,
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
