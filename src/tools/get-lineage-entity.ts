import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const getLineageEntityTool = {
  name: 'get_lineage_entity',
  description: 'Get details about a single technical lineage entity by its ID. ' +
    'Returns metadata about the entity including its type, name, and DGC asset association. ' +
    'Requires the technical lineage entity ID. ' +
    'Use search_lineage_entities to find the entity ID from a name or DGC asset UUID.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      entity_id: {
        type: 'string',
        description: 'The technical lineage entity ID to retrieve details for',
      },
    },
    required: ['instance_name', 'entity_id'],
  },
};

export async function executeGetLineageEntity(args: any): Promise<string> {
  const { instance_name, entity_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${LINEAGE_BASE}/entities/${encodeURIComponent(entity_id)}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      entityId: entity_id,
      ...response,
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      entityId: entity_id,
    });
  }
}
