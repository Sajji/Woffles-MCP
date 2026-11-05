import { enrichResponseUrls } from '../utils/collibra-client.js';
import { ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';
import { categorizeResponsibilities, enrichResponsibilityOwners } from '../utils/responsibilities.js';

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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssetResponsibilities(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, include_inherited = true, role_name } = args;

  // Get the instance configuration
  const { instance, client } = clientFor(instance_name);

  // Get asset basic info for context
  const asset = await client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(asset_id)}`);

  // Get responsibilities
  const responsibilitiesUrl = `/rest/2.0/responsibilities?resourceIds=${encodeURIComponent(asset_id)}&includeInherited=${include_inherited}&limit=1000`;
  const responsibilitiesResponse = await client.restCall<any>(responsibilitiesUrl);

  // Resolve owner user/group details
  let allResponsibilities = await enrichResponsibilityOwners(client, responsibilitiesResponse.results || []);

  // Filter by role name if specified
  if (role_name) {
    allResponsibilities = allResponsibilities.filter((r: any) =>
      r.role?.name?.toLowerCase().includes(role_name.toLowerCase())
    );
  }

  // Categorize responsibilities (direct vs inherited, and inherited by level)
  const {
    direct: directResponsibilities,
    inherited: inheritedResponsibilities,
    inheritedByCommunity,
    inheritedByDomain,
  } = categorizeResponsibilities(allResponsibilities, asset_id);

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
  return ok(enrichResponseUrls(instance.baseUrl, {
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
}
