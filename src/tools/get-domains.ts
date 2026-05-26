import { getInstance } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';

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
    },
    required: ['instance_name'],
  },
};

export async function executeGetDomains(args: any): Promise<string> {
  const { instance_name, community_id, name, limit = 1000 } = args;

  try {
    // Get the instance configuration
    const instance = getInstance(instance_name);

    // Create a client for this instance
    const client = new CollibraClient(instance);

    // Build query parameters
    const params = new URLSearchParams({
      limit: Math.min(limit, 1000).toString(),
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

    // Group domains by community for better organization
    const domainsByCommunity: Record<string, any[]> = {};
    (response.results || []).forEach((domain: any) => {
      const communityName = domain.community?.name || 'Unknown Community';
      if (!domainsByCommunity[communityName]) {
        domainsByCommunity[communityName] = [];
      }
      domainsByCommunity[communityName].push(domain);
    });

    // Return formatted response
    return JSON.stringify(enrichResponseUrls(instance.baseUrl, {
      instance: instance_name,
      filters: {
        communityId: community_id || 'All communities',
        name: name || 'All domains',
      },
      total: response.total || 0,
      returned: response.results?.length || 0,
      domainsByCommunity,
      allDomains: response.results || [],
    }));

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
