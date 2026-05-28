import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const searchDataClassTool = {
  name: 'search_data_class',
  description:
    'Search Collibra data classes (from the Classification service) by name, description, or rule presence. ' +
    'Data classes are used to classify columns and assets (e.g., "Email Address", "Credit Card Number"). ' +
    'Use the returned data class UUID with add_data_classification_match to associate a class with an asset.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Partial, case-insensitive filter on data class name',
      },
      description: {
        type: 'string',
        description: 'Optional: Partial, case-insensitive filter on data class description',
      },
      contains_rules: {
        type: 'boolean',
        description: 'Optional: When true, only return data classes that have associated rules',
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

export async function executeSearchDataClass(args: any): Promise<ToolResult> {
  const { instance_name, name, description, contains_rules, limit = 50, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (name) params.append('name', name);
    if (description) params.append('description', description);
    if (contains_rules !== undefined) params.append('containsRules', String(contains_rules));
    params.append('limit', String(Math.min(limit, 1000)));
    params.append('offset', String(offset));

    const endpoint = `/rest/classification/v1/dataClasses?${params.toString()}`;
    const response = await client.restCall<any>(endpoint);

    return okWithNext({
      instance: instance_name,
      filters: {
        name: name || null,
        description: description || null,
        containsRules: contains_rules ?? null,
      },
      total: response.total || 0,
      offset,
      limit: Math.min(limit, 1000),
      results: (response.results || []).map((dc: any) => ({
        id: dc.id,
        name: dc.name,
        description: dc.description || null,
        status: dc.status,
        columnNameFilters: dc.columnNameFilters,
        columnTypeFilters: dc.columnTypeFilters,
        confidenceThreshold: dc.confidenceThreshold,
        allowNullValues: dc.allowNullValues,
        allowEmptyValues: dc.allowEmptyValues,
        hasRules: Array.isArray(dc.rules) && dc.rules.length > 0,
        examples: dc.examples,
      })),
    }, [
      { tool: 'add_data_classification_match', args: { instance_name, asset_id: '<column asset id>', classification_id: '<id from results>' }, why: 'Classify an asset with one of these data classes.' },
      { tool: 'search_data_classification_match', args: { instance_name, classification_ids: ['<id from results>'] }, why: 'See existing matches for a data class.' },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
