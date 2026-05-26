import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra relation type UUIDs
const COLUMN_TO_TABLE_REL_ID = '00000000-0000-0000-0000-000000007042';
const DATA_ATTRIBUTE_REL_ID_1 = '00000000-0000-0000-0000-000000007094';
const DATA_ATTRIBUTE_REL_ID_2 = 'cd000000-0000-0000-0000-000000000023';
const GENERIC_CONNECTED_ASSET_REL_ID = '00000000-0000-0000-0000-000000007038';
const DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID = '00000000-0000-0000-0000-000000007200';

export const getTableSemanticsTool = {
  name: 'get_table_semantics',
  description: 'Discover the business meaning of a database Table by traversing the Collibra operating model: ' +
    'Table → Columns → Data Attributes → Business Terms/Measures. ' +
    'Uses well-known Collibra relation types to follow the semantic chain. ' +
    'Returns columns with their linked data attributes, connected business terms, and measures.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      table_asset_id: {
        type: 'string',
        description: 'The UUID of the Table asset to analyze',
      },
    },
    required: ['instance_name', 'table_asset_id'],
  },
};

async function fetchRelations(
  client: CollibraClient,
  relationTypeId: string,
  sourceId?: string,
  targetId?: string,
): Promise<any[]> {
  const params = new URLSearchParams({
    relationTypeId,
    limit: '1000',
  });
  if (sourceId) params.append('sourceId', sourceId);
  if (targetId) params.append('targetId', targetId);

  try {
    const resp = await client.restCall<any>(`/rest/2.0/relations?${params.toString()}`);
    return resp.results || [];
  } catch {
    return [];
  }
}

export async function executeGetTableSemantics(args: any): Promise<string> {
  const { instance_name, table_asset_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Step 1: Find all Columns that belong to this Table
    // Column→Table relation: column is source, table is target
    const columnRelations = await fetchRelations(client, COLUMN_TO_TABLE_REL_ID, undefined, table_asset_id);
    const columns = columnRelations.map((r: any) => ({
      id: r.source.id,
      name: r.source.name,
      url: client.assetUrl(r.source.id),
    }));

    if (columns.length === 0) {
      return JSON.stringify({
        instance: instance_name,
        tableId: table_asset_id,
        tableUrl: client.assetUrl(table_asset_id),
        message: 'No columns found for this table.',
        columns: [],
      });
    }

    // Step 2: For each column, find linked Data Attributes
    // Data Attribute relations use multiple relation type IDs
    const dataAttributeRelTypeIds = [
      DATA_ATTRIBUTE_REL_ID_1,
      DATA_ATTRIBUTE_REL_ID_2,
      GENERIC_CONNECTED_ASSET_REL_ID,
    ];

    const columnDetails = await Promise.all(
      columns.map(async (col: any) => {
        // Fetch data attribute relations where column is source OR target
        const relResults = await Promise.all(
          dataAttributeRelTypeIds.flatMap((relTypeId) => [
            fetchRelations(client, relTypeId, col.id),
            fetchRelations(client, relTypeId, undefined, col.id),
          ]),
        );

        // Deduplicate data attributes
        const dataAttrMap = new Map<string, any>();
        for (const relations of relResults) {
          for (const rel of relations) {
            const other = rel.source.id === col.id ? rel.target : rel.source;
            if (!dataAttrMap.has(other.id)) {
              dataAttrMap.set(other.id, {
                id: other.id,
                name: other.name,
                url: client.assetUrl(other.id),
              });
            }
          }
        }

        const dataAttributes = Array.from(dataAttrMap.values());

        // Step 3: For each data attribute, find linked Measures
        const enrichedDAs = await Promise.all(
          dataAttributes.map(async (da: any) => {
            const [measuresAsSource, measuresAsTarget] = await Promise.all([
              fetchRelations(client, DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID, da.id),
              fetchRelations(client, DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID, undefined, da.id),
            ]);

            const measureMap = new Map<string, any>();
            for (const rel of [...measuresAsSource, ...measuresAsTarget]) {
              const other = rel.source.id === da.id ? rel.target : rel.source;
              if (!measureMap.has(other.id)) {
                measureMap.set(other.id, {
                  id: other.id,
                  name: other.name,
                  url: client.assetUrl(other.id),
                });
              }
            }

            return {
              ...da,
              measures: Array.from(measureMap.values()),
            };
          }),
        );

        return {
          ...col,
          dataAttributes: enrichedDAs,
        };
      }),
    );

    return JSON.stringify({
      instance: instance_name,
      tableId: table_asset_id,
      tableUrl: client.assetUrl(table_asset_id),
      totalColumns: columnDetails.length,
      columns: columnDetails,
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      tableAssetId: table_asset_id,
    });
  }
}
