import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { okWithNext } from '../utils/tool-result.js';
import type { AssetTypesResponse, ToolResult } from '../types.js';

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
  outputSchema: {
    type: 'object',
    properties: {
      instance: { type: 'string', description: 'The Collibra instance name that was queried.' },
      total: { type: 'number', description: 'Total number of asset types reported by Collibra.' },
      assetTypes: {
        type: 'array',
        description: 'Asset types returned by Collibra, trimmed to the fields needed for selection.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Asset type UUID.' },
            name: { type: 'string', description: 'Asset type display name.' },
          },
          required: ['id', 'name'],
        },
      },
      error: { type: 'boolean', description: 'Present and true when the call failed.' },
      message: { type: 'string', description: 'Error message when error=true.' },
    },
    required: ['instance'],
  },
};

export async function executeGetAssetTypes(args: any): Promise<ToolResult> {
  const { instance_name } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);
    const response = await client.restCall<AssetTypesResponse>('/rest/2.0/assetTypes');

    const structured = {
      instance: instance_name,
      total: response.total,
      assetTypes: response.results.map((t) => ({ id: t.id, name: t.name })),
    };
    return okWithNext(structured, [
      { tool: 'describe_asset_type', args: { instance_name, name: '<pick from assetTypes>' }, why: 'See assignable attributes, relations, and eligible statuses for an asset type.' },
      { tool: 'plan_asset_creation', args: { instance_name, asset_name: '<name>', asset_type_name: '<pick from assetTypes>', domain_name: '<domain>' }, why: 'Plan a creation that conforms to the operating model.' },
      { tool: 'refresh_operating_model', args: { instance_name }, why: 'Cache the full model so subsequent model-aware tools work offline.' },
    ]);

  } catch (error) {
    const structured = {
      instance: instance_name,
      error: true,
      message: (error as Error).message,
    };
    return { text: JSON.stringify(structured), structured };
  }
}
