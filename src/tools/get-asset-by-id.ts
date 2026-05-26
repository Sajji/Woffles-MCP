import { getInstance } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';

export const getAssetByIdTool = {
  name: 'get_asset_by_id',
  description: 'Retrieve complete details about a specific asset by its UUID using GraphQL. ' +
    'Returns the asset with all its attributes (string, boolean, numeric, date), relations (incoming and outgoing ' +
    'with cursor-based pagination), and responsibilities (including inherited from domain/community). ' +
    'Responsibilities are categorized by direct assignment vs inherited. User names are fully resolved. ' +
    'This is the most comprehensive view of a single asset. Supports cursor-based relation pagination — ' +
    'use the last relation target/source ID from a previous response as the cursor to fetch the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'The UUID of the asset to retrieve',
      },
      include_inherited: {
        type: 'boolean',
        description: 'Include inherited responsibilities from domain/community (default: true)',
        default: true,
      },
      outgoing_relations_cursor: {
        type: 'string',
        description: 'Optional: Cursor (relation ID) to fetch next page of outgoing relations. Use the last outgoingRelation id from the previous response.',
      },
      incoming_relations_cursor: {
        type: 'string',
        description: 'Optional: Cursor (relation ID) to fetch next page of incoming relations. Use the last incomingRelation id from the previous response.',
      },
    },
    required: ['instance_name', 'asset_id'],
  },
};

const ATTRIBUTES_LIMIT = 100;
const RELATIONS_LIMIT = 50;

function buildAssetDetailsQuery(
  assetId: string,
  outgoingCursor?: string,
  incomingCursor?: string,
): string {
  const outgoingWhere = outgoingCursor
    ? `, where: { id: { gt: "${outgoingCursor}" } }`
    : '';
  const incomingWhere = incomingCursor
    ? `, where: { id: { gt: "${incomingCursor}" } }`
    : '';

  return `
    {
      assets(where: { id: { eq: "${assetId}" } }, limit: 1) {
        id
        displayName
        fullName
        type { name }
        domain { id name }
        status { name }
        stringAttributes(limit: ${ATTRIBUTES_LIMIT}) {
          type { name }
          stringValue
        }
        booleanAttributes(limit: ${ATTRIBUTES_LIMIT}) {
          type { name }
          booleanValue
        }
        numericAttributes(limit: ${ATTRIBUTES_LIMIT}) {
          type { name }
          numericValue
        }
        dateAttributes(limit: ${ATTRIBUTES_LIMIT}) {
          type { name }
          dateValue
        }
        outgoingRelations(order: { id: asc }, limit: ${RELATIONS_LIMIT}${outgoingWhere}) {
          id
          type { id role }
          target { id displayName type { name } }
        }
        incomingRelations(order: { id: asc }, limit: ${RELATIONS_LIMIT}${incomingWhere}) {
          id
          type { id role }
          source { id displayName type { name } }
        }
      }
    }
  `;
}

export async function executeGetAssetById(args: any): Promise<string> {
  const {
    instance_name,
    asset_id,
    include_inherited = true,
    outgoing_relations_cursor,
    incoming_relations_cursor,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch asset details via GraphQL and responsibilities via REST in parallel
    const [gqlResponse, responsibilitiesResponse] = await Promise.all([
      client.graphqlQuery<{ data: { assets: any[] } }>(
        buildAssetDetailsQuery(asset_id, outgoing_relations_cursor, incoming_relations_cursor),
      ),
      client.restCall<any>(
        `/rest/2.0/responsibilities?resourceIds=${asset_id}&includeInherited=${include_inherited}&limit=1000`
      ).catch(() => ({ results: [] })),
    ]);

    const asset = gqlResponse.data.assets[0];

    if (!asset) {
      return JSON.stringify({
        error: true,
        message: `Asset with ID "${asset_id}" not found.`,
        instance: instance_name,
        assetId: asset_id,
      });
    }

    // Process responsibilities — resolve user/group names
    let allResponsibilities = responsibilitiesResponse.results || [];

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

    // Batch-fetch user and group details in parallel
    const [usersMap, userGroupsMap] = await Promise.all([
      (async () => {
        const map = new Map<string, any>();
        if (userIds.size === 0) return map;
        try {
          const userParams = Array.from(userIds).map(id => `userId=${id}`).join('&');
          const resp = await client.restCall<any>(`/rest/2.0/users?${userParams}&limit=1000`);
          (resp.results || []).forEach((u: any) => map.set(u.id, u));
        } catch { /* non-critical */ }
        return map;
      })(),
      (async () => {
        const map = new Map<string, any>();
        if (userGroupIds.size === 0) return map;
        try {
          const groupParams = Array.from(userGroupIds).map(id => `userGroupId=${id}`).join('&');
          const resp = await client.restCall<any>(`/rest/2.0/userGroups?${groupParams}&limit=1000`);
          (resp.results || []).forEach((g: any) => map.set(g.id, g));
        } catch { /* non-critical */ }
        return map;
      })(),
    ]);

    // Enrich responsibilities with full user/group details
    allResponsibilities = allResponsibilities.map((r: any) => {
      const enriched = { ...r };
      if (r.owner?.id) {
        if (r.owner.resourceType === 'User') {
          const u = usersMap.get(r.owner.id);
          if (u) {
            enriched.owner = {
              ...r.owner,
              userName: u.userName,
              firstName: u.firstName,
              lastName: u.lastName,
              fullName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.userName,
              emailAddress: u.emailAddress,
            };
          }
        } else if (r.owner.resourceType === 'UserGroup') {
          const g = userGroupsMap.get(r.owner.id);
          if (g) {
            enriched.owner = { ...r.owner, name: g.name, description: g.description };
          }
        }
      }
      return enriched;
    });

    // Categorize responsibilities
    const directResponsibilities = allResponsibilities.filter((r: any) => r.baseResource?.id === asset_id);
    const inheritedResponsibilities = allResponsibilities.filter((r: any) => r.baseResource?.id !== asset_id);
    const inheritedByCommunity = inheritedResponsibilities.filter((r: any) => r.baseResource?.resourceType === 'Community');
    const inheritedByDomain = inheritedResponsibilities.filter((r: any) => r.baseResource?.resourceType === 'Domain');

    // Enrich relations with URLs
    const outgoing = (asset.outgoingRelations || []).map((r: any) => ({
      ...r,
      target: { ...r.target, url: client.assetUrl(r.target.id) },
    }));
    const incoming = (asset.incomingRelations || []).map((r: any) => ({
      ...r,
      source: { ...r.source, url: client.assetUrl(r.source.id) },
    }));

    const lastOutgoingId = outgoing.length > 0 ? outgoing[outgoing.length - 1].id : null;
    const lastIncomingId = incoming.length > 0 ? incoming[incoming.length - 1].id : null;

    return JSON.stringify(enrichResponseUrls(instance.baseUrl, {
      instance: instance_name,
      assetId: asset_id,
      assetUrl: client.assetUrl(asset_id),
      asset: {
        id: asset.id,
        displayName: asset.displayName,
        fullName: asset.fullName,
        type: asset.type,
        domain: asset.domain ? { ...asset.domain, url: client.domainUrl(asset.domain.id) } : null,
        status: asset.status,
        attributes: {
          string: asset.stringAttributes || [],
          boolean: asset.booleanAttributes || [],
          numeric: asset.numericAttributes || [],
          date: asset.dateAttributes || [],
        },
        relations: {
          outgoing,
          incoming,
          pagination: {
            relationsPerPage: RELATIONS_LIMIT,
            hasMoreOutgoing: outgoing.length === RELATIONS_LIMIT,
            hasMoreIncoming: incoming.length === RELATIONS_LIMIT,
            nextOutgoingCursor: outgoing.length === RELATIONS_LIMIT ? lastOutgoingId : null,
            nextIncomingCursor: incoming.length === RELATIONS_LIMIT ? lastIncomingId : null,
          },
        },
      },
      responsibilities: {
        summary: {
          total: allResponsibilities.length,
          direct: directResponsibilities.length,
          inherited: inheritedResponsibilities.length,
          inheritedFromCommunity: inheritedByCommunity.length,
          inheritedFromDomain: inheritedByDomain.length,
        },
        direct: directResponsibilities,
        inherited: include_inherited ? {
          all: inheritedResponsibilities,
          fromCommunity: inheritedByCommunity,
          fromDomain: inheritedByDomain,
        } : null,
      },
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
