import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const searchLineageTransformationsTool = {
  name: 'search_lineage_transformations',
  description:
    'Search for transformations in the technical lineage graph by name. ' +
    'Normally, transformation IDs are obtained from get_lineage_upstream or get_lineage_downstream results. ' +
    'Use this tool to search by name when you need to find a transformation directly. ' +
    'Use get_lineage_transformation with the returned ID to retrieve the full SQL/script logic.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name_contains: {
        type: 'string',
        description: 'Optional: Partial, case-insensitive name filter (1–256 characters)',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum results per page (default: 20, max: 100)',
        default: 20,
      },
      cursor: {
        type: 'string',
        description: 'Optional: Pagination cursor from a previous response to fetch the next page',
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeSearchLineageTransformations(args: any): Promise<ToolResult> {
  const { instance_name, name_contains, limit = 20, cursor } = args;

  const { client } = clientFor(instance_name);

  const params = new URLSearchParams();
  if (name_contains) params.append('nameContains', name_contains);
  params.append('limit', String(Math.min(limit, 100)));
  if (cursor) params.append('cursor', cursor);

  const queryString = params.toString();
  const endpoint = `${LINEAGE_BASE}/transformations${queryString ? '?' + queryString : ''}`;
  const response = await client.restCall<any>(endpoint);

  return okWithNext({
    ...response, // API fields first; our keys below take precedence
    instance: instance_name,
    searchParams: {
      nameContains: name_contains || null,
      limit: Math.min(limit, 100),
    },
  }, [
    { tool: 'get_lineage_transformation', args: { instance_name, transformation_id: '<id from results>' }, why: 'Inspect a transformation in detail.' },
  ], true);
}
