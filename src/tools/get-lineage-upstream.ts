import type { ToolResult } from '../types.js';
import { executeGetLineage } from './get-lineage.js';

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

/** Legacy name — same as get_lineage with direction="upstream". */
export async function executeGetLineageUpstream(args: any): Promise<ToolResult> {
  return executeGetLineage({ ...args, direction: 'upstream' });
}
