import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

export const getDomainsTool = {
  name: 'get_domains',
  description: 'Retrieve domains from a Collibra instance. Domains are organizational containers for assets within communities. ' +
    'Optionally filter by community ID to see domains within a specific community, or by name to search for specific domains.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      community_id: {
        type: 'string',
        description: 'Optional: Filter by community UUID to see only domains within that community',
      },
      name: {
        type: 'string',
        description: 'Optional: Search for domains by name (partial match supported)',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of results to return (default: 1000)',
        default: 1000,
      },
      offset: {
        type: 'number',
        description: 'Optional: Pagination offset (default: 0). Use nextOffset from the previous response.',
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

export async function executeGetDomains(args: any): Promise<ToolResult> {
  const { instance_name, community_id, name, limit = 1000, offset = 0 } = args;

  // Get the instance configuration
  const { client } = clientFor(instance_name);

  // Build query parameters
  const params = new URLSearchParams({
    limit: Math.min(limit, 1000).toString(),
    offset: String(offset),
    sortField: 'NAME',
    sortOrder: 'ASC',
  });

  if (community_id) {
    params.append('communityId', community_id);
  }

  if (name) {
    params.append('name', name);
    params.append('nameMatchMode', 'ANYWHERE');
  }

  // Make the REST API call
  const endpoint = `/rest/2.0/domains?${params.toString()}`;
  const response = await client.restCall<any>(endpoint);

  // One flat list of compact entries. (Previously every domain was returned
  // twice — grouped by community AND flat — as full REST objects with audit
  // metadata: ~1.6 KB per domain.)
  const allDomains = (response.results || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    ...(d.description ? { description: d.description } : {}),
    type: d.type ? { id: d.type.id, name: d.type.name } : null,
    community: d.community ? { id: d.community.id, name: d.community.name } : null,
    url: client.domainUrl(d.id),
  }));

  return okWithNext({
    instance: instance_name,
    filters: {
      communityId: community_id || 'All communities',
      name: name || 'All domains',
    },
    total: response.total || 0,
    returned: allDomains.length,
    ...(allDomains.length === Math.min(limit, 1000) ? { nextOffset: offset + allDomains.length } : {}),
    allDomains,
  }, [
    { tool: 'prepare_create_asset', args: { instance_name, asset_name: '<name>', asset_type_name: '<type>', domain_id: '<pick from allDomains>' }, why: 'Plan an asset creation in a chosen domain (required attributes, statuses, duplicates).' },
  ]);
}
