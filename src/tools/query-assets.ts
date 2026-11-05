import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';

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
    'compact: fetches 500 assets per page by default (up to 1000). ' +
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
          'compact per-asset payload; 500 results per page by default (max 1000). ' +
          '"full" returns all attribute types (string, boolean, numeric, date, multi-value), ' +
          'responsibilities, and tags — use only when the user needs all attribute detail ' +
          'and an asset type filter is applied. Defaults to 100 per page due to heavier payload.',
        default: 'summary',
      },
      limit: {
        type: 'number',
        description: 'Results per page (max 1000). Defaults to 500 for summary and 100 for full ' +
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
  outputSchema: {
    type: 'object',
    properties: {
      instance: { type: 'string' },
      assetType: { type: 'string', description: 'Asset type filter applied, or "All".' },
      detailLevel: { type: 'string', enum: ['summary', 'full'] },
      count: { type: 'number', description: 'Number of assets returned on this page.' },
      offset: { type: 'number' },
      has_more: { type: 'boolean', description: 'True if another page is available.' },
      next_offset: {
        type: ['number', 'null'],
        description: 'Offset to pass on the next call when has_more is true.',
      },
      assets: {
        type: 'array',
        description: 'One page of assets; shape depends on detailLevel.',
        items: { type: 'object', additionalProperties: true },
      },
      error: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['instance'],
  },
};

/**
 * Query header. All user input travels as GraphQL variables — never spliced
 * into the query text — so a crafted asset type name cannot alter the query.
 */
function queryHeader(hasWhere: boolean): string {
  return hasWhere
    ? `query QueryAssets($limit: Int!, $offset: Int!, $where: AssetFilter) {
      assets(limit: $limit, offset: $offset, where: $where) {`
    : `query QueryAssets($limit: Int!, $offset: Int!) {
      assets(limit: $limit, offset: $offset) {`;
}

function buildSummaryQuery(hasWhere: boolean): string {
  return `
    ${queryHeader(hasWhere)}
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

function buildFullQuery(hasWhere: boolean): string {
  return `
    ${queryHeader(hasWhere)}
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

export async function executeQueryAssets(args: any): Promise<ToolResult> {
  const { instance_name, asset_type_name, detail_level = 'summary', offset = 0 } = args;
  // Summary rows are small but 5000 of them (~100K chars) overwhelm an agent's
  // context; full payloads carry all attributes so keep pages smaller still.
  const defaultLimit = detail_level === 'full' ? 100 : 500;
  const limit: number = args.limit ?? defaultLimit;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const where = asset_type_name ? { type: { name: { eq: asset_type_name } } } : undefined;
    const query = detail_level === 'full' ? buildFullQuery(!!where) : buildSummaryQuery(!!where);
    const response = await client.graphqlQuery<{ data: { assets: any[] } }>(query, {
      limit,
      offset,
      ...(where ? { where } : {}),
    });
    const assets = response.data.assets.map((a: any) => ({
      ...a,
      url: client.assetUrl(a.id),
      ...(a.domain?.id ? { domain: { ...a.domain, url: client.domainUrl(a.domain.id) } } : {}),
    }));
    const has_more = assets.length === limit;
    const next_offset = offset + assets.length;

    const structured = {
      instance: instance_name,
      assetType: asset_type_name || 'All',
      detailLevel: detail_level,
      count: assets.length,
      offset,
      has_more,
      next_offset: has_more ? next_offset : null,
      assets,
    };
    return okWithNext(structured, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id: '<id from assets>' }, why: 'Drill into a specific asset.' },
      { tool: 'bulk_update_asset_descriptions', args: { instance_name, updates: [{ asset_id: '<id>', new_description: '<text>' }] }, why: 'Batch-update descriptions across results.' },
      { tool: 'bulk_update_asset_attributes', args: { instance_name, attribute_type_id: '<from get_attribute_types>', updates: [{ asset_id: '<id>', new_value: '<value>' }] }, why: 'Batch-update attributes across results.' },
    ]);
  } catch (error) {
    const structured = {
      instance: instance_name,
      assetType: asset_type_name,
      error: true,
      message: (error as Error).message,
    };
    return { text: JSON.stringify(structured), structured };
  }
}
