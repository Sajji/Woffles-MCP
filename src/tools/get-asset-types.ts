import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import type { AssetTypesResponse } from '../types.js';

export const getAssetTypesTool = {
  name: 'get_asset_types',
  description: 'Retrieve the complete list of Asset Types from a Collibra instance. ' +
    'Returns all asset types including their IDs, names, descriptions, parent types, and metadata. ' +
    'WORKFLOW: Always call this tool FIRST before querying assets. Present the returned list of asset ' +
    'type names to the user and ask them to select which asset type they want to explore. Then use ' +
    'the chosen name in query_assets as asset_type_name. If the user explicitly wants all asset types, ' +
    'proceed without filtering but use detail_level="summary" to avoid fetching large volumes of data.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
    },
    required: ['instance_name'],
  },
};

export async function executeGetAssetTypes(args: any): Promise<string> {
  const { instance_name } = args;

  try {
    // Get the instance configuration
    const instance = getInstance(instance_name);

    // Create a client for this instance
    const client = new CollibraClient(instance);

    // Make the REST API call
    const response = await client.restCall<AssetTypesResponse>('/rest/2.0/assetTypes');

    // Return formatted response — only id and name needed for type selection workflow
    return JSON.stringify({
      instance: instance_name,
      total: response.total,
      assetTypes: response.results.map((t) => ({ id: t.id, name: t.name })),
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
