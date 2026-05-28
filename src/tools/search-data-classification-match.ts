import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const searchDataClassificationMatchTool = {
  name: 'search_data_classification_match',
  description:
    'Search data classification matches (associations between assets and data classes) in Collibra. ' +
    'Filter by asset IDs, classification IDs, match status (ACCEPTED, REJECTED, SUGGESTED), or asset type IDs. ' +
    'Returns paginated results with match metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter by one or more asset UUIDs',
      },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['ACCEPTED', 'REJECTED', 'SUGGESTED'] },
        description: 'Optional: Filter by match status: ACCEPTED, REJECTED, SUGGESTED',
      },
      classification_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter by one or more data class UUIDs',
      },
      asset_type_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter by one or more asset type UUIDs',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of results to return (default: 50, max: 1000)',
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Optional: Number of results to skip for pagination (default: 0)',
        default: 0,
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

export async function executeSearchDataClassificationMatch(args: any): Promise<ToolResult> {
  const { instance_name, asset_ids, statuses, classification_ids, asset_type_ids, limit = 50, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (Array.isArray(asset_ids)) {
      asset_ids.forEach((id: string) => params.append('assetIds', id));
    }
    if (Array.isArray(statuses)) {
      statuses.forEach((s: string) => params.append('statuses', s));
    }
    if (Array.isArray(classification_ids)) {
      classification_ids.forEach((id: string) => params.append('classificationIds', id));
    }
    if (Array.isArray(asset_type_ids)) {
      asset_type_ids.forEach((id: string) => params.append('assetTypeIds', id));
    }
    params.append('limit', String(Math.min(limit, 1000)));
    params.append('offset', String(offset));

    const endpoint = `/rest/catalog/1.0/dataClassification/classificationMatches?${params.toString()}`;
    const response = await client.restCall<any>(endpoint);

    return okWithNext({
      instance: instance_name,
      filters: {
        assetIds: asset_ids || null,
        statuses: statuses || null,
        classificationIds: classification_ids || null,
        assetTypeIds: asset_type_ids || null,
      },
      total: response.total || 0,
      offset,
      limit: Math.min(limit, 1000),
      results: response.results || [],
    }, [
      { tool: 'remove_data_classification_match', args: { instance_name, classification_match_id: '<id from results>' }, why: 'Remove a stale or wrong classification match.' },
      { tool: 'add_data_classification_match', args: { instance_name, asset_id: '<asset id>', classification_id: '<data class id>' }, why: 'Add additional classifications to assets.' },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
