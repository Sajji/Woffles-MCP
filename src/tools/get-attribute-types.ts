import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getAttributeTypesTool = {
  name: 'get_attribute_types',
  description: 'Retrieve attribute types from a Collibra instance. ' +
    'Returns attribute type IDs, names, and kinds (BOOLEAN, STRING, NUMERIC, DATE, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, SCRIPT). ' +
    'Use this tool to discover the attribute type ID needed for update_asset_attribute. ' +
    'You can filter by name (e.g. "Personally Identifiable Information") and/or kind (e.g. "BOOLEAN"). ' +
    'WORKFLOW: Call this tool to find the attribute type ID before calling update_asset_attribute or bulk_update_asset_attributes.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Filter attribute types by name (optional). Matches anywhere in the name by default.',
      },
      name_match_mode: {
        type: 'string',
        enum: ['START', 'END', 'ANYWHERE', 'EXACT'],
        description: 'How to match the name filter. Only EXACT is case-sensitive. Default: ANYWHERE.',
      },
      kind: {
        type: 'string',
        enum: ['BOOLEAN', 'STRING', 'NUMERIC', 'DATE', 'SINGLE_VALUE_LIST', 'MULTI_VALUE_LIST', 'SCRIPT'],
        description: 'Filter by attribute type kind (optional).',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (max 1000). Default: 100.',
      },
    },
    required: ['instance_name'],
  },
};

export async function executeGetAttributeTypes(args: any): Promise<string> {
  const { instance_name, name, name_match_mode, kind, limit = 100 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    params.set('offset', '0');
    params.set('limit', String(Math.min(limit, 1000)));

    if (name) {
      params.set('name', name);
      params.set('nameMatchMode', name_match_mode || 'ANYWHERE');
    }
    if (kind) {
      params.set('kind', kind);
    }
    params.set('sortField', 'NAME');
    params.set('sortOrder', 'ASC');

    const response = await client.restCall<any>(`/rest/2.0/attributeTypes?${params.toString()}`);

    return JSON.stringify({
      instance: instance_name,
      total: response.total,
      attributeTypes: (response.results || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        kind: t.resourceType || t.attributeTypeDiscriminator,
        description: t.description || undefined,
        statisticsEnabled: t.statisticsEnabled,
        isInteger: t.isInteger,
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
