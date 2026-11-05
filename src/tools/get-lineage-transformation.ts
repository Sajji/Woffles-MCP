import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

const LINEAGE_BASE = '/technical_lineage_resource/rest/lineageGraphRead/v1';

export const getLineageTransformationTool = {
  name: 'get_lineage_transformation',
  description:
    'Retrieve the full SQL or script logic for a specific transformation in the technical lineage graph. ' +
    'Transformation IDs appear in the results of get_lineage. ' +
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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetLineageTransformation(args: any): Promise<ToolResult> {
  const { instance_name, transformation_id } = args;

  const { client } = clientFor(instance_name);

  const endpoint = `${LINEAGE_BASE}/transformations/${encodeURIComponent(transformation_id)}`;
  const response = await client.restCall<any>(endpoint);

  return okWithNext({
    ...response, // API fields first; our keys below take precedence
    instance: instance_name,
    transformationId: transformation_id,
  }, [
    { tool: 'get_lineage_entity', args: { instance_name, entity_id: '<source or target entity id>' }, why: 'Inspect the source/target entities of this transformation.' },
  ], true);
}
