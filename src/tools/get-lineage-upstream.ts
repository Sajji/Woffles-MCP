import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const getLineageUpstreamTool = {
  name: 'get_lineage_upstream',
  description: 'Retrieve upstream lineage for a technical lineage entity (e.g., a column or table). ' +
    'Shows what data flows INTO the specified entity — its source columns, transformations, and origins. ' +
    'Requires the technical lineage entity ID (not the DGC asset ID). ' +
    'Use search_lineage_entities to find the entity ID from a DGC asset UUID.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      entity_id: {
        type: 'string',
        description: 'The technical lineage entity ID to get upstream lineage for',
      },
      cursor: {
        type: 'string',
        description: 'Optional: Pagination cursor from a previous response to fetch the next page',
      },
      entity_type: {
        type: 'string',
        description: 'Optional: Filter upstream entities by type (e.g., table, column)',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum relations per page (default: 20, max: 100)',
        default: 20,
      },
    },
    required: ['instance_name', 'entity_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetLineageUpstream(args: any): Promise<ToolResult> {
  const { instance_name, entity_id, cursor, entity_type, limit = 20 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    if (entity_type) params.append('type', entity_type);
    params.append('limit', String(Math.min(limit, 100)));

    const endpoint = `${LINEAGE_BASE}/entities/${encodeURIComponent(entity_id)}/upstream${params.toString() ? '?' + params.toString() : ''}`;
    const response = await client.restCall<any>(endpoint);

    return okWithNext({
      instance: instance_name,
      entityId: entity_id,
      direction: 'upstream',
      ...response,
    }, [
      { tool: 'get_lineage_entity', args: { instance_name, entity_id: '<id from results>' }, why: 'Inspect an upstream entity in detail.' },
      { tool: 'get_lineage_upstream', args: { instance_name, entity_id: '<id from results>' }, why: 'Continue traversing further upstream.' },
      { tool: 'get_lineage_transformation', args: { instance_name, transformation_id: '<transformation id from edges>' }, why: 'Inspect a transformation between nodes.' },
    ]);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      entityId: entity_id,
    });
  }
}
