import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getAssetRelationsTool = {
  name: 'get_asset_relations',
  description: 'Retrieve all relations (relationships) for a specific asset using GraphQL. ' +
    'Returns both incoming and outgoing relations in a single efficient call, showing how this asset ' +
    'connects to other assets with full relation type context (role, co-role, source/target type names). ' +
    'Ideal for understanding downstream impact, data lineage, dependencies, and asset hierarchies. ' +
    'For impact analysis questions like "What is the downstream impact of modifying this asset?", ' +
    'use the outgoingRelations (role direction) and incomingRelations (co-role direction) to traverse the graph. ' +
    'Supports pagination on relations if the asset has many connections.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'The UUID of the asset to retrieve relations for',
      },
      relation_limit: {
        type: 'number',
        description: 'Optional: Maximum number of relations to return per direction (default: 100)',
        default: 100,
      },
      relation_offset: {
        type: 'number',
        description: 'Optional: Offset for paginating relations per direction (default: 0)',
        default: 0,
      },
    },
    required: ['instance_name', 'asset_id'],
  },
};

function buildRelationsQuery(assetId: string, limit: number, offset: number): string {
  return `
    {
      assets(where: { id: { eq: "${assetId}" } }, limit: 1) {
        id
        displayName
        fullName
        outgoingRelations(limit: ${limit}, offset: ${offset}) {
          type {
            source {
              name
            }
            role
            corole
            target {
              name
            }
          }
          source {
            id
            fullName
            displayName
          }
          target {
            id
            fullName
            displayName
          }
        }
        incomingRelations(limit: ${limit}, offset: ${offset}) {
          type {
            source {
              name
            }
            role
            corole
            target {
              name
            }
          }
          source {
            id
            fullName
            displayName
          }
          target {
            id
            fullName
            displayName
          }
        }
      }
    }
  `;
}

export async function executeGetAssetRelations(args: any): Promise<string> {
  const { instance_name, asset_id, relation_limit = 100, relation_offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const query = buildRelationsQuery(asset_id, relation_limit, relation_offset);
    const response = await client.graphqlQuery<{ data: { assets: any[] } }>(query);

    const asset = response.data.assets[0];

    if (!asset) {
      return JSON.stringify({
        error: true,
        message: `Asset with ID "${asset_id}" not found.`,
        instance: instance_name,
        assetId: asset_id,
      });
    }

    const enrichRelation = (r: any) => ({
      ...r,
      source: { ...r.source, url: client.assetUrl(r.source.id) },
      target: { ...r.target, url: client.assetUrl(r.target.id) },
    });

    const outgoing = (asset.outgoingRelations || []).map(enrichRelation);
    const incoming = (asset.incomingRelations || []).map(enrichRelation);

    return JSON.stringify({
      instance: instance_name,
      assetId: asset_id,
      assetUrl: client.assetUrl(asset_id),
      assetDisplayName: asset.displayName,
      assetFullName: asset.fullName,
      summary: {
        outgoing: outgoing.length,
        incoming: incoming.length,
        total: outgoing.length + incoming.length,
        has_more_outgoing: outgoing.length === relation_limit,
        has_more_incoming: incoming.length === relation_limit,
        next_offset: relation_offset + relation_limit,
      },
      relations: {
        outgoing,
        incoming,
      },
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assetId: asset_id,
    });
  }
}
