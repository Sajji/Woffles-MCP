import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

export const getAssetStatusesTool = {
  name: 'get_asset_statuses',
  description:
    'Retrieve all asset workflow statuses from a Collibra instance. ' +
    'Returns the id and name of every status (e.g. Candidate, Accepted, Deprecated). ' +
    'Use this tool when migrating assets cross-instance to map Dev status names to ' +
    'the correct status UUIDs in Prod before calling bulk_create_assets with status_id.',
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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssetStatuses(args: any): Promise<ToolResult> {
  const { instance_name, name } = args;

  const { client } = clientFor(instance_name);

  // Small, fixed set: fetch every page instead of silently truncating at one.
  const params: Record<string, string> = { sortField: 'NAME', sortOrder: 'ASC' };
  if (name) {
    params.name = name;
    params.nameMatchMode = 'ANYWHERE';
  }
  const results = await client.restPaginate<any>('/rest/2.0/statuses', params);
  const response = { results, total: results.length };

  return okWithNext({
    instance: instance_name,
    total: response.total ?? (response.results || []).length,
    statuses: (response.results || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      publicId: s.publicId || undefined,
      description: s.description || undefined,
    })),
  }, [
    { tool: 'prepare_create_asset', args: { instance_name, asset_name: '<name>', asset_type_name: '<type>', preferred_status_name: '<pick from statuses>' }, why: 'Plan an asset creation with the chosen initial status.' },
    { tool: 'validate_against_model', args: { instance_name, proposal_type: 'asset', asset_type_id: '<asset type uuid>', status_id: '<pick from statuses>' }, why: 'Schema-validate before create_asset.' },
  ], true);
}
