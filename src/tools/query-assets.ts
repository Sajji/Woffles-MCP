import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const queryAssetsTool = {
  name: 'query_assets',
  description:
    'Query assets from a Collibra instance using GraphQL. ' +
    'IMPORTANT WORKFLOW: Before calling this tool you should have already called get_asset_types ' +
    'and presented those options to the user so they can pick an asset type. ' +
    'Pass the chosen type name as asset_type_name to filter results efficiently. ' +
    'If the user explicitly asks for all asset types, omit asset_type_name but use ' +
    'detail_level="summary" to avoid fetching large volumes of attribute data. ' +
    'Use detail_level="full" only when the user wants complete attribute details for a ' +
    'specific asset type — this fetches all attributes, responsibilities, tags, and metadata. ' +
    'detail_level="summary" (default) returns fullName, displayName, and Description only — ' +
    'very efficient: fetches up to 5000 assets per page which covers most datasets in a single call. ' +
    'detail_level="full" returns all attributes but defaults to 100 per page due to payload size. ' +
    'Returns one page of results at a time to stay within response size limits. ' +
    'Check has_more in the response and call again with the returned next_offset to fetch additional pages.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_type_name: {
        type: 'string',
        description:
          'Optional: The exact name of the asset type to filter by (e.g., "Data Set"). ' +
          'Obtain valid names by calling get_asset_types first. ' +
          'If omitted, all assets are retrieved — use detail_level="summary" in that case.',
      },
      detail_level: {
        type: 'string',
        enum: ['summary', 'full'],
        description:
          '"summary" (default) returns fullName, displayName, and Description attribute only — ' +
          'compact per-asset payload allows up to 5000 results per page, covering most datasets in one call. ' +
          '"full" returns all attribute types (string, boolean, numeric, date, multi-value), ' +
          'responsibilities, and tags — use only when the user needs all attribute detail ' +
          'and an asset type filter is applied. Defaults to 100 per page due to heavier payload.',
        default: 'summary',
      },
      limit: {
        type: 'number',
        description: 'Results per page. Defaults to 5000 for summary (compact payload) and 100 for full ' +
          '(heavy payload). Reduce if responses are still too large.',
      },
      offset: {
        type: 'number',
        description: 'Starting position for pagination (default: 0). ' +
          'Use the next_offset value from a previous response to fetch the next page.',
        default: 0,
      },
    },
    required: ['instance_name'],
  },
};

function buildSummaryQuery(whereClause: string, limit: number, offset: number): string {
  return `
    {
      assets(limit: ${limit}, offset: ${offset}${whereClause ? `, ${whereClause}` : ''}) {
        id
        fullName
        displayName
        stringAttributes(where: { type: { name: { eq: "Description" } } }) {
          stringValue
        }
      }
    }
  `;
}

function buildFullQuery(whereClause: string, limit: number, offset: number): string {
  return `
    {
      assets(limit: ${limit}, offset: ${offset}${whereClause ? `, ${whereClause}` : ''}) {
        id
        displayName
        fullName
        type {
          name
        }
        status {
          name
        }
        domain {
          id
          name
        }
        stringAttributes {
          type {
            name
          }
          stringValue
        }
        booleanAttributes {
          type {
            name
          }
          booleanValue
        }
        numericAttributes {
          type {
            name
          }
          numericValue
        }
        dateAttributes {
          type {
            name
          }
          dateValue
        }
        multiValueAttributes {
          type {
            name
          }
          stringValues
        }
        responsibilities {
          role {
            name
          }
          user {
            fullName
          }
        }
        tags {
          name
        }
      }
    }
  `;
}

export async function executeQueryAssets(args: any): Promise<string> {
  const { instance_name, asset_type_name, detail_level = 'summary', offset = 0 } = args;
  // Smart defaults: summary payloads are tiny per asset so 5000 is safe;
  // full payloads carry all attributes so keep pages small.
  const defaultLimit = detail_level === 'full' ? 100 : 5000;
  const limit: number = args.limit ?? defaultLimit;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const whereClause = asset_type_name
      ? `where: { type: { name: { eq: "${asset_type_name}" } } }`
      : '';

    const query =
      detail_level === 'full'
        ? buildFullQuery(whereClause, limit, offset)
        : buildSummaryQuery(whereClause, limit, offset);

    const response = await client.graphqlQuery<{ data: { assets: any[] } }>(query);
    const assets = response.data.assets.map((a: any) => ({
      ...a,
      url: client.assetUrl(a.id),
      ...(a.domain?.id ? { domain: { ...a.domain, url: client.domainUrl(a.domain.id) } } : {}),
    }));
    const has_more = assets.length === limit;
    const next_offset = offset + assets.length;

    return JSON.stringify({
      instance: instance_name,
      assetType: asset_type_name || 'All',
      detailLevel: detail_level,
      count: assets.length,
      offset,
      has_more,
      next_offset: has_more ? next_offset : null,
      assets,
    });
  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assetType: asset_type_name,
    });
  }
}
