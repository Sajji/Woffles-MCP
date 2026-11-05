import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

export const getCommunitiesTool = {
  name: 'get_communities',
  description: 'Retrieve communities from a Collibra instance. Communities are top-level organizational containers and can be hierarchical. ' +
    'This tool automatically organizes communities by hierarchy, showing top-level communities and their children. ' +
    'Optionally filter by parent community ID to see only child communities, or by name to search.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      parent_id: {
        type: 'string',
        description: 'Optional: Filter by parent community UUID to see only child communities of that parent',
      },
      name: {
        type: 'string',
        description: 'Optional: Search for communities by name (partial match supported)',
      },
      show_hierarchy: {
        type: 'boolean',
        description: 'Optional: If true, organize results hierarchically showing parent-child relationships (default: true)',
        default: true,
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

interface Community {
  id: string;
  name: string;
  description?: string;
  parent?: {
    id: string;
    name: string;
  } | null;
  [key: string]: any;
}

export async function executeGetCommunities(args: any): Promise<ToolResult> {
  const { instance_name, parent_id, name, show_hierarchy = true, limit = 1000, offset = 0 } = args;

  // Get the instance configuration
  const { client } = clientFor(instance_name);

  // Build query parameters
  const params = new URLSearchParams({
    limit: Math.min(limit, 1000).toString(),
    offset: String(offset),
    excludeMeta: 'true',
    sortField: 'NAME',
    sortOrder: 'ASC',
  });

  if (parent_id) {
    params.append('parentId', parent_id);
  }

  if (name) {
    params.append('name', name);
    params.append('nameMatchMode', 'ANYWHERE');
  }

  // Make the REST API call
  const endpoint = `/rest/2.0/communities?${params.toString()}`;
  const response = await client.restCall<any>(endpoint);

  // Compact entries (full REST objects carried audit metadata on every entry).
  const communities: Community[] = (response.results || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    parent: c.parent ? { id: c.parent.id, name: c.parent.name } : null,
    url: client.communityUrl(c.id),
  }));

  // Organize by hierarchy if requested
  let hierarchicalView = null;
  let topLevelCommunities: Community[] = [];
  let childCommunities: Community[] = [];

  if (show_hierarchy && !parent_id) {
    // A community is a root of THIS view when its parent isn't in the result
    // set (true top-level, or its parent was excluded by the name filter /
    // paging) — otherwise filtered children would silently disappear.
    const returnedIds = new Set(communities.map(c => c.id));
    topLevelCommunities = communities.filter(c => !c.parent?.id || !returnedIds.has(c.parent.id));
    childCommunities = communities.filter(c => c.parent?.id && returnedIds.has(c.parent.id));

    // Build hierarchy tree
    const communityMap = new Map<string, any>();
    
    // Initialize all communities in the map
    communities.forEach(community => {
      communityMap.set(community.id, {
        ...community,
        children: [],
      });
    });

    // Build parent-child relationships
    childCommunities.forEach(community => {
      if (community.parent?.id) {
        const parentCommunity = communityMap.get(community.parent.id);
        if (parentCommunity) {
          parentCommunity.children.push(communityMap.get(community.id));
        }
      }
    });

    // Get only top-level communities with their children
    hierarchicalView = topLevelCommunities.map(c => communityMap.get(c.id));
  }

  // Return formatted response
  const result: any = {
    instance: instance_name,
    filters: {
      parentId: parent_id || 'All levels',
      name: name || 'All communities',
    },
    summary: {
      total: response.total || 0,
      returned: communities.length,
      topLevel: topLevelCommunities.length,
      children: childCommunities.length,
    },
    ...(communities.length === Math.min(limit, 1000) ? { nextOffset: offset + communities.length } : {}),
  };

  // The tree already contains every community once; the old `flat` copy repeated them all.
  if (show_hierarchy && !parent_id && hierarchicalView) {
    result.hierarchy = hierarchicalView;
  } else {
    result.communities = communities;
  }

  return okWithNext(result, [
    { tool: 'get_domains', args: { instance_name, community_id: '<pick from communities>' }, why: 'List domains under a chosen community.' },
    { tool: 'create_domain', args: { instance_name, name: '<domain name>', community_id: '<pick from communities>', type_id: '<from get_domain_types>' }, why: 'Create a domain inside a community.' },
  ]);
}
