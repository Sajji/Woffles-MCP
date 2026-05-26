import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const getLineageTransformationTool = {
  name: 'get_lineage_transformation',
  description:
    'Retrieve the full SQL or script logic for a specific transformation in the technical lineage graph. ' +
    'Transformation IDs appear in the results of get_lineage_upstream and get_lineage_downstream. ' +
    'Use search_lineage_transformations to search for transformations by name.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      transformation_id: {
        type: 'string',
        description: 'The technical lineage transformation ID (from upstream/downstream results)',
      },
    },
    required: ['instance_name', 'transformation_id'],
  },
};

export async function executeGetLineageTransformation(args: any): Promise<string> {
  const { instance_name, transformation_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${LINEAGE_BASE}/transformations/${encodeURIComponent(transformation_id)}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      transformationId: transformation_id,
      ...response,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      transformationId: transformation_id,
    });
  }
}
