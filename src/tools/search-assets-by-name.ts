import { getInstance } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';

export const searchAssetsByNameTool = {
  name: 'search_assets_by_name',
  description: 'Search for resources across a Collibra instance using the advanced POST search endpoint. ' +
    'Supports keyword-based search with wildcard matching, and filtering by resource type ' +
    '(Asset, Domain, Community, User, UserGroup), community, domain, asset type, and status. ' +
    'Returns matching resources with highlights and relevance scoring.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      search_term: {
        type: 'string',
        description: 'The keyword(s) to search for. Wildcards (*) are automatically added for partial matching.',
      },
      resource_types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter by resource types. Valid values: Asset, Domain, Community, User, UserGroup. Default: all types.',
      },
      community_id: {
        type: 'string',
        description: 'Optional: Filter results to a specific community UUID (use community_ids for multiple)',
      },
      community_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter results to multiple community UUIDs',
      },
      domain_id: {
        type: 'string',
        description: 'Optional: Filter results to a specific domain UUID (use domain_ids for multiple)',
      },
      domain_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter results to multiple domain UUIDs',
      },
      asset_type_id: {
        type: 'string',
        description: 'Optional: Filter results by asset type UUID',
      },
      domain_type_filter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter results by one or more domain type UUIDs',
      },
      created_by_filter: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Filter results by creator user UUIDs',
      },
      status_id: {
        type: 'string',
        description: 'Optional: Filter results by status UUID',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of results to return (default: 100, max: 1000)',
        default: 100,
      },
      offset: {
        type: 'number',
        description: 'Optional: Number of results to skip for pagination (default: 0)',
        default: 0,
      },
    },
    required: ['instance_name', 'search_term'],
  },
};

interface SearchFilter {
  field: string;
  values: string[];
}

export async function executeSearchAssetsByName(args: any): Promise<string> {
  const {
    instance_name,
    search_term,
    resource_types,
    community_id,
    community_ids,
    domain_id,
    domain_ids,
    asset_type_id,
    domain_type_filter,
    created_by_filter,
    status_id,
    limit = 100,
    offset = 0,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Build search request body (chip pattern: wrap with wildcards)
    const keywords = search_term.includes('*') ? search_term : `*${search_term}*`;

    const filters: SearchFilter[] = [];
    if (resource_types && resource_types.length > 0) {
      filters.push({ field: 'resourceType', values: resource_types });
    }
    const communityValues = [...(community_ids || []), ...(community_id ? [community_id] : [])];
    if (communityValues.length > 0) {
      filters.push({ field: 'community', values: communityValues });
    }
    const domainValues = [...(domain_ids || []), ...(domain_id ? [domain_id] : [])];
    if (domainValues.length > 0) {
      filters.push({ field: 'domain', values: domainValues });
    }
    if (asset_type_id) {
      filters.push({ field: 'assetType', values: [asset_type_id] });
    }
    if (domain_type_filter && domain_type_filter.length > 0) {
      filters.push({ field: 'domainType', values: domain_type_filter });
    }
    if (created_by_filter && created_by_filter.length > 0) {
      filters.push({ field: 'createdBy', values: created_by_filter });
    }
    if (status_id) {
      filters.push({ field: 'status', values: [status_id] });
    }

    const searchBody: any = {
      keywords,
      limit: Math.min(limit, 1000),
      offset,
    };

    if (filters.length > 0) {
      searchBody.filters = filters;
    }

    const response = await client.restCallWithBody<any>(
      '/rest/2.0/search',
      'POST',
      searchBody,
    );

    return JSON.stringify(enrichResponseUrls(instance.baseUrl, {
      instance: instance_name,
      searchTerm: search_term,
      keywords,
      filters: filters.length > 0 ? filters : 'none',
      total: response.total || 0,
      returned: response.results?.length || 0,
      offset,
      results: response.results || [],
    }));

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      searchTerm: search_term,
    });
  }
}
