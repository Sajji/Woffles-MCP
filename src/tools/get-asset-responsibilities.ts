import { getInstance } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';

export const getAssetResponsibilitiesTool = {
  name: 'get_asset_responsibilities',
  description: 'Get detailed responsibility information for a specific asset. ' +
    'Shows all responsibilities including those inherited from parent domains and communities. ' +
    'Provides clear categorization of direct vs inherited assignments with source information. ' +
    'User names are fully resolved for all responsibilities. ' +
    'Use this when you need to understand who is responsible for an asset and where those assignments come from.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'The UUID of the asset to retrieve responsibilities for',
      },
      include_inherited: {
        type: 'boolean',
        description: 'Include responsibilities inherited from domain/community (default: true)',
        default: true,
      },
      role_name: {
        type: 'string',
        description: 'Optional: Filter by specific role name (e.g., "Data Owner", "Data Steward")',
      },
    },
    required: ['instance_name', 'asset_id'],
  },
};

export async function executeGetAssetResponsibilities(args: any): Promise<string> {
  const { instance_name, asset_id, include_inherited = true, role_name } = args;

  try {
    // Get the instance configuration
    const instance = getInstance(instance_name);

    // Create a client for this instance
    const client = new CollibraClient(instance);

    // Get asset basic info for context
    const asset = await client.restCall<any>(`/rest/2.0/assets/${asset_id}`);

    // Get responsibilities
    const responsibilitiesUrl = `/rest/2.0/responsibilities?resourceIds=${asset_id}&includeInherited=${include_inherited}&limit=1000`;
    const responsibilitiesResponse = await client.restCall<any>(responsibilitiesUrl);

    let allResponsibilities = responsibilitiesResponse.results || [];

    // Extract unique user and user group IDs from responsibilities
    const userIds = new Set<string>();
    const userGroupIds = new Set<string>();

    allResponsibilities.forEach((r: any) => {
      if (r.owner?.id) {
        if (r.owner.resourceType === 'User') {
          userIds.add(r.owner.id);
        } else if (r.owner.resourceType === 'UserGroup') {
          userGroupIds.add(r.owner.id);
        }
      }
    });

    // Fetch full user details in batch
    const usersMap = new Map<string, any>();
    if (userIds.size > 0) {
      try {
        const userIdsArray = Array.from(userIds);
        const userParams = userIdsArray.map(id => `userId=${id}`).join('&');
        const usersResponse = await client.restCall<any>(
          `/rest/2.0/users?${userParams}&limit=1000`
        );
        
        (usersResponse.results || []).forEach((user: any) => {
          usersMap.set(user.id, user);
        });
      } catch (error) {
        console.error('Failed to fetch user details:', error);
      }
    }

    // Fetch full user group details in batch
    const userGroupsMap = new Map<string, any>();
    if (userGroupIds.size > 0) {
      try {
        const groupIdsArray = Array.from(userGroupIds);
        const groupParams = groupIdsArray.map(id => `userGroupId=${id}`).join('&');
        const groupsResponse = await client.restCall<any>(
          `/rest/2.0/userGroups?${groupParams}&limit=1000`
        );
        
        (groupsResponse.results || []).forEach((group: any) => {
          userGroupsMap.set(group.id, group);
        });
      } catch (error) {
        console.error('Failed to fetch user group details:', error);
      }
    }

    // Enrich responsibilities with full user/group details
    allResponsibilities = allResponsibilities.map((r: any) => {
      const enriched = { ...r };
      
      if (r.owner?.id) {
        if (r.owner.resourceType === 'User') {
          const userDetails = usersMap.get(r.owner.id);
          if (userDetails) {
            enriched.owner = {
              ...r.owner,
              userName: userDetails.userName,
              firstName: userDetails.firstName,
              lastName: userDetails.lastName,
              fullName: `${userDetails.firstName || ''} ${userDetails.lastName || ''}`.trim() || userDetails.userName,
              emailAddress: userDetails.emailAddress,
            };
          }
        } else if (r.owner.resourceType === 'UserGroup') {
          const groupDetails = userGroupsMap.get(r.owner.id);
          if (groupDetails) {
            enriched.owner = {
              ...r.owner,
              name: groupDetails.name,
              description: groupDetails.description,
            };
          }
        }
      }
      
      return enriched;
    });

    // Filter by role name if specified
    if (role_name) {
      allResponsibilities = allResponsibilities.filter((r: any) => 
        r.role?.name?.toLowerCase().includes(role_name.toLowerCase())
      );
    }

    // Categorize responsibilities
    const directResponsibilities = allResponsibilities.filter((r: any) => 
      r.baseResource?.id === asset_id
    );

    const inheritedResponsibilities = allResponsibilities.filter((r: any) => 
      r.baseResource?.id !== asset_id
    );

    // Further categorize inherited by level
    const inheritedByCommunity = inheritedResponsibilities.filter((r: any) =>
      r.baseResource?.resourceType === 'Community'
    );
    
    const inheritedByDomain = inheritedResponsibilities.filter((r: any) =>
      r.baseResource?.resourceType === 'Domain'
    );

    // Group by role for easier analysis
    const byRole: Record<string, any> = {};
    allResponsibilities.forEach((r: any) => {
      const roleName = r.role?.name || 'Unknown Role';
      if (!byRole[roleName]) {
        byRole[roleName] = {
          direct: [],
          inherited: [],
        };
      }
      
      if (r.baseResource?.id === asset_id) {
        byRole[roleName].direct.push(r);
      } else {
        byRole[roleName].inherited.push(r);
      }
    });

    // Group by owner for easier analysis
    const byOwner: Record<string, any> = {};
    allResponsibilities.forEach((r: any) => {
      let ownerName = 'Unknown';
      let ownerType = 'Unknown';
      
      if (r.owner?.fullName) {
        ownerName = r.owner.fullName;
        ownerType = 'User';
      } else if (r.owner?.name) {
        ownerName = r.owner.name;
        ownerType = 'UserGroup';
      } else if (r.owner?.userName) {
        ownerName = r.owner.userName;
        ownerType = 'User';
      }
      
      const ownerKey = `${ownerName} (${ownerType})`;
      
      if (!byOwner[ownerKey]) {
        byOwner[ownerKey] = {
          roles: [],
          responsibilities: [],
        };
      }
      
      if (!byOwner[ownerKey].roles.includes(r.role?.name)) {
        byOwner[ownerKey].roles.push(r.role?.name);
      }
      byOwner[ownerKey].responsibilities.push(r);
    });

    // Return comprehensive responsibility analysis
    return JSON.stringify(enrichResponseUrls(instance.baseUrl, {
      instance: instance_name,
      asset: {
        id: asset_id,
        url: client.assetUrl(asset_id),
        name: asset.name,
        type: asset.type?.name,
        domain: asset.domain?.name,
        community: asset.community?.name,
      },
      filters: {
        includeInherited: include_inherited,
        roleNameFilter: role_name || 'All roles',
      },
      summary: {
        total: allResponsibilities.length,
        direct: directResponsibilities.length,
        inherited: inheritedResponsibilities.length,
        inheritedFromCommunity: inheritedByCommunity.length,
        inheritedFromDomain: inheritedByDomain.length,
        uniqueRoles: Object.keys(byRole).length,
        uniqueOwners: Object.keys(byOwner).length,
      },
      responsibilities: {
        direct: directResponsibilities,
        inherited: include_inherited ? {
          all: inheritedResponsibilities,
          fromCommunity: inheritedByCommunity,
          fromDomain: inheritedByDomain,
        } : null,
      },
      groupedByRole: byRole,
      groupedByOwner: byOwner,
    }));

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assetId: asset_id,
    });
  }
}
