import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getAssetStatusesTool = {
  name: 'get_asset_statuses',
  description:
    'Retrieve all asset workflow statuses from a Collibra instance. ' +
    'Returns the id and name of every status (e.g. Candidate, Accepted, Deprecated). ' +
    'Use this tool when migrating assets cross-instance to map Dev status names to ' +
    'the correct status UUIDs in Prod before calling create_asset with status_id.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter by status name (partial match supported)',
      },
    },
    required: ['instance_name'],
  },
};

export async function executeGetAssetStatuses(args: any): Promise<string> {
  const { instance_name, name } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams({ limit: '500', offset: '0', sortField: 'NAME', sortOrder: 'ASC' });
    if (name) {
      params.set('name', name);
      params.set('nameMatchMode', 'ANYWHERE');
    }

    const response = await client.restCall<any>(`/rest/2.0/statuses?${params.toString()}`);

    return JSON.stringify({
      instance: instance_name,
      total: response.total ?? (response.results || []).length,
      statuses: (response.results || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        publicId: s.publicId || undefined,
        description: s.description || undefined,
      })),
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
