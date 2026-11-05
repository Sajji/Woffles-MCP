import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const getLineageTool = {
  name: 'get_lineage',
  description:
    'Traverse technical lineage from a lineage entity (e.g. a column or table). ' +
    'direction="upstream" shows what flows INTO the entity (sources, transformations, origins); ' +
    'direction="downstream" shows what it flows INTO (consumers, reports, derived columns). ' +
    'Requires the technical lineage entity ID (not the DGC asset ID) — use search_lineage_entities with dgc_asset_id to find it.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The name of the Collibra instance (as defined in config.json)' },
      entity_id: { type: 'string', description: 'The technical lineage entity ID.' },
      direction: {
        type: 'string',
        enum: ['upstream', 'downstream'],
        description: 'upstream = sources feeding the entity; downstream = consumers of the entity.',
      },
      cursor: { type: 'string', description: 'Optional: pagination cursor from a previous response.' },
      entity_type: { type: 'string', description: 'Optional: filter related entities by type (e.g. table, column).' },
      limit: { type: 'number', description: 'Optional: maximum relations per page (default: 20, max: 100).', default: 20, maximum: 100 },
    },
    required: ['instance_name', 'entity_id', 'direction'],
  },
  outputSchema: {
    type: 'object',
    description: 'Lineage page: the API response plus instance, entityId and direction.',
    additionalProperties: true,
  },
};

export async function executeGetLineage(args: any): Promise<ToolResult> {
  const { instance_name, entity_id, direction, cursor, entity_type, limit = 20 } = args;
  const { client } = clientFor(instance_name);

  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  if (entity_type) params.append('type', entity_type);
  params.append('limit', String(Math.min(limit, 100)));

  const response = await client.restCall<any>(
    `${LINEAGE_BASE}/entities/${encodeURIComponent(entity_id)}/${direction}?${params.toString()}`,
  );

  return okWithNext({
    ...response, // API fields first; our keys below take precedence
    instance: instance_name,
    entityId: entity_id,
    direction,
  }, [
    { tool: 'get_lineage_entity', args: { instance_name, entity_id: '<id from results>' }, why: `Inspect a ${direction} entity in detail.` },
    { tool: 'get_lineage', args: { instance_name, entity_id: '<id from results>', direction }, why: `Continue traversing further ${direction}.` },
    { tool: 'get_lineage_transformation', args: { instance_name, transformation_id: '<transformation id from edges>' }, why: 'Inspect a transformation between nodes.' },
  ]);
}
