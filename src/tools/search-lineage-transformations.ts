import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

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
};

export async function executeSearchLineageTransformations(args: any): Promise<string> {
  const { instance_name, name_contains, limit = 20, cursor } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (name_contains) params.append('nameContains', name_contains);
    params.append('limit', String(Math.min(limit, 100)));
    if (cursor) params.append('cursor', cursor);

    const queryString = params.toString();
    const endpoint = `${LINEAGE_BASE}/transformations${queryString ? '?' + queryString : ''}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      searchParams: {
        nameContains: name_contains || null,
        limit: Math.min(limit, 100),
      },
      ...response,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
