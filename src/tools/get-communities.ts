import { getInstance } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';

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
    },
    required: ['instance_name'],
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

export async function executeGetCommunities(args: any): Promise<string> {
  const { instance_name, parent_id, name, show_hierarchy = true, limit = 1000 } = args;

  try {
    // Get the instance configuration
    const instance = getInstance(instance_name);

    // Create a client for this instance
    const client = new CollibraClient(instance);

    // Build query parameters
    const params = new URLSearchParams({
      limit: Math.min(limit, 1000).toString(),
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

    const communities: Community[] = response.results || [];

    // Organize by hierarchy if requested
    let hierarchicalView = null;
    let topLevelCommunities: Community[] = [];
    let childCommunities: Community[] = [];

    if (show_hierarchy && !parent_id) {
      // Separate top-level and child communities
      topLevelCommunities = communities.filter(c => !c.parent);
      childCommunities = communities.filter(c => c.parent);

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
    };

    if (show_hierarchy && !parent_id && hierarchicalView) {
      result.hierarchy = hierarchicalView;
      result.flat = {
        topLevel: topLevelCommunities,
        children: childCommunities,
      };
    } else {
      result.communities = communities;
    }

    return JSON.stringify(enrichResponseUrls(instance.baseUrl, result));

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
