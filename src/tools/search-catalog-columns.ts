import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * `search_catalog_columns` — chip-parity tool. Finds catalog Column assets by
 * metadata that keyword search can't filter on: attribute values (Description,
 * Data Type), a Data Steward responsibility, or relations to a Business
 * Term / Business Rule / Data Element / Data Attribute by name. Filters are
 * AND-combined and pushed down into a single Knowledge Graph GraphQL query.
 */

const DEFAULT_RELATED_TYPES = ['Business Term', 'Business Rule', 'Data Element', 'Data Attribute'];

export const searchCatalogColumnsTool = {
  name: 'search_catalog_columns',
  description:
    'Find catalog Column assets by metadata that keyword search cannot filter on: ' +
    'Description or Data Type attribute values, a Data Steward assignment, or a relation to a ' +
    'Business Term / Business Rule / Data Element / Data Attribute (by name). ' +
    'All supplied filters are AND-combined and evaluated in a single Knowledge Graph GraphQL query. ' +
    'String matching uses case-sensitive "contains". ' +
    'Requires the Knowledge Graph GraphQL API to be enabled on the instance. ' +
    'For simple name/keyword lookups use search_assets_by_name instead.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      description_contains: {
        type: 'string',
        description: 'Optional: Only columns whose Description attribute contains this text.',
      },
      data_type_contains: {
        type: 'string',
        description: 'Optional: Only columns whose Data Type attribute contains this text (e.g. "VARCHAR").',
      },
      steward_name_contains: {
        type: 'string',
        description: 'Optional: Only columns with a Data Steward whose full name contains this text.',
      },
      related_to_name: {
        type: 'string',
        description:
          'Optional: Only columns related (either direction) to an asset whose name contains this text. ' +
          'By default the related asset must be a Business Term, Business Rule, Data Element, or Data Attribute.',
      },
      related_to_types: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: Asset type names the related asset may have (used with related_to_name). ' +
          `Default: ${DEFAULT_RELATED_TYPES.join(', ')}.`,
      },
      domain_id: {
        type: 'string',
        description: 'Optional: Restrict to columns in this domain (UUID).',
      },
      asset_type_public_id: {
        type: 'string',
        description: 'Optional: Public ID of the asset type to search (default: "Column").',
        default: 'Column',
      },
      limit: {
        type: 'number',
        description: 'Max results per page (default: 50, max: 500).',
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset (default: 0). Use next_offset from a previous response.',
        default: 0,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      instance: { type: 'string' },
      operation: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                displayName: { type: 'string' },
                fullName: { type: 'string' },
                domain: { type: 'object', additionalProperties: true },
                status: { type: ['string', 'null'] },
                description: { type: ['string', 'null'] },
                dataType: { type: ['string', 'null'] },
                stewards: { type: 'array', items: { type: 'string' } },
                relatedAssets: { type: 'array', items: { type: 'object', additionalProperties: true } },
                url: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      pagination: { type: 'object', additionalProperties: true },
      nextActions: { type: 'array', items: { type: 'object', additionalProperties: true } },
      errors: { type: 'array', items: { type: 'string' } },
    },
    required: ['instance', 'operation', 'data'],
  },
};

/** Build the AssetFilter `where` object from the supplied filters. */
function buildWhere(args: any): Record<string, any> {
  const {
    description_contains,
    data_type_contains,
    steward_name_contains,
    related_to_name,
    related_to_types,
    domain_id,
    asset_type_public_id = 'Column',
  } = args;

  const where: Record<string, any> = {
    type: { publicId: { eq: asset_type_public_id } },
  };

  if (domain_id) {
    where.domain = { id: { eq: domain_id } };
  }

  const stringAttrFilters: any[] = [];
  if (description_contains) {
    stringAttrFilters.push({
      any: { type: { name: { eq: 'Description' } }, stringValue: { contains: description_contains } },
    });
  }
  if (data_type_contains) {
    stringAttrFilters.push({
      any: { type: { name: { eq: 'Data Type' } }, stringValue: { contains: data_type_contains } },
    });
  }
  // Multiple collection filters on the same field must be AND-combined via _and
  if (stringAttrFilters.length === 1) {
    where.stringAttributes = stringAttrFilters[0];
  } else if (stringAttrFilters.length > 1) {
    where._and = (where._and || []).concat(stringAttrFilters.map((f) => ({ stringAttributes: f })));
  }

  if (steward_name_contains) {
    where.responsibilities = {
      any: {
        role: { name: { eq: 'Data Steward' } },
        user: { fullName: { contains: steward_name_contains } },
      },
    };
  }

  if (related_to_name) {
    const typeNames: string[] = Array.isArray(related_to_types) && related_to_types.length > 0
      ? related_to_types
      : DEFAULT_RELATED_TYPES;
    const relatedTargetFilter = (side: 'target' | 'source') => ({
      any: {
        [side]: {
          displayName: { contains: related_to_name },
          type: { name: { in: typeNames } },
        },
      },
    });
    // Related in either direction → OR across outgoing/incoming
    where._or = [
      { outgoingRelations: relatedTargetFilter('target') },
      { incomingRelations: relatedTargetFilter('source') },
    ];
  }

  return where;
}

const COLUMNS_QUERY = `
  query SearchCatalogColumns($where: AssetFilter, $limit: Int!, $offset: Int!) {
    assets(where: $where, limit: $limit, offset: $offset) {
      id
      displayName
      fullName
      domain { id name }
      status { name }
      stringAttributes(where: { type: { name: { in: ["Description", "Data Type"] } } }) {
        type { name }
        stringValue
      }
      responsibilities(where: { role: { name: { eq: "Data Steward" } } }) {
        user { fullName }
      }
      outgoingRelations(limit: 20) {
        type { role }
        target { id displayName type { name } }
      }
      incomingRelations(limit: 20) {
        type { role }
        source { id displayName type { name } }
      }
    }
  }
`;

export async function executeSearchCatalogColumns(args: any): Promise<ToolResult> {
  const { instance_name, related_to_name, limit = 50, offset = 0 } = args;
  const pageSize = Math.min(Math.max(1, limit), 500);

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const hasFilter =
      args.description_contains || args.data_type_contains || args.steward_name_contains || related_to_name;
    if (!hasFilter) {
      return errorEnvelope({
        instance: instance_name,
        operation: 'search_catalog_columns',
        message:
          'Provide at least one filter: description_contains, data_type_contains, steward_name_contains, or related_to_name. ' +
          'To list all columns, use query_assets with asset_type_name="Column" instead.',
      });
    }

    const where = buildWhere(args);
    const resp = await client.graphqlQuery<any>(COLUMNS_QUERY, { where, limit: pageSize, offset });
    const assets: any[] = resp?.data?.assets ?? [];

    const relatedTypeNames: string[] = Array.isArray(args.related_to_types) && args.related_to_types.length > 0
      ? args.related_to_types
      : DEFAULT_RELATED_TYPES;

    const columns = assets.map((a) => {
      const attrByName = new Map<string, string>(
        (a.stringAttributes || []).map((s: any) => [s.type?.name, s.stringValue]),
      );
      const related = [
        ...(a.outgoingRelations || []).map((r: any) => ({
          direction: 'outgoing',
          role: r.type?.role ?? null,
          id: r.target?.id,
          name: r.target?.displayName,
          type: r.target?.type?.name,
        })),
        ...(a.incomingRelations || []).map((r: any) => ({
          direction: 'incoming',
          role: r.type?.role ?? null,
          id: r.source?.id,
          name: r.source?.displayName,
          type: r.source?.type?.name,
        })),
      ].filter((r) => relatedTypeNames.includes(r.type));
      return {
        id: a.id,
        displayName: a.displayName,
        fullName: a.fullName,
        domain: a.domain ?? null,
        status: a.status?.name ?? null,
        description: attrByName.get('Description') ?? null,
        dataType: attrByName.get('Data Type') ?? null,
        stewards: (a.responsibilities || []).map((r: any) => r.user?.fullName).filter(Boolean),
        relatedAssets: related,
        url: client.assetUrl(a.id),
      };
    });

    const hasMore = assets.length === pageSize;
    return withEnvelope({
      instance: instance_name,
      operation: 'search_catalog_columns',
      data: { count: columns.length, columns },
      pagination: { offset, limit: pageSize, ...(hasMore ? { nextOffset: offset + pageSize } : {}) },
      nextActions: columns.slice(0, 1).map((c) => ({
        tool: 'get_asset_by_id',
        args: { instance_name, asset_id: c.id },
        why: 'Inspect a matched column in full detail.',
      })),
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'search_catalog_columns',
      message:
        `${(error as Error).message} — this tool requires the Knowledge Graph GraphQL API to be enabled on the instance.`,
    });
  }
}
