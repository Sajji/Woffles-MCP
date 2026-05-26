import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const listDataContractTool = {
  name: 'list_data_contract',
  description:
    'List data contracts available in Collibra. Returns a cursor-paginated list of data contract metadata, ' +
    'sorted by last modified date descending. Use pull_data_contract_manifest to download the manifest for a specific contract.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      manifest_id: {
        type: 'string',
        description: 'Optional: Filter by the unique identifier of the data contract manifest',
      },
      cursor: {
        type: 'string',
        description: 'Optional: Pagination cursor from a previous response (nextCursor) to fetch the next page',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of results to return (default: 100, max: 500)',
        default: 100,
      },
    },
    required: ['instance_name'],
  },
};

export async function executeListDataContract(args: any): Promise<string> {
  const { instance_name, manifest_id, cursor, limit = 100 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    params.append('includeTotal', 'true');
    params.append('limit', String(Math.min(limit, 500)));
    if (manifest_id) params.append('manifestId', manifest_id);
    if (cursor) params.append('cursor', cursor);

    const endpoint = `/rest/dataProduct/v1/dataContracts?${params.toString()}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      filters: { manifestId: manifest_id || null },
      total: response.total ?? null,
      limit: response.limit,
      nextCursor: response.nextCursor || null,
      contracts: response.items || [],
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
