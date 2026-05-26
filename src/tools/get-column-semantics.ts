import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra relation type UUIDs (same as get-table-semantics.ts)
const COLUMN_TO_TABLE_REL_ID = '00000000-0000-0000-0000-000000007042';
const DATA_ATTRIBUTE_REL_ID_1 = '00000000-0000-0000-0000-000000007094';
const DATA_ATTRIBUTE_REL_ID_2 = 'cd000000-0000-0000-0000-000000000023';
const GENERIC_CONNECTED_ASSET_REL_ID = '00000000-0000-0000-0000-000000007038';
const DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID = '00000000-0000-0000-0000-000000007200';

export const getColumnSemanticsTool = {
  name: 'get_column_semantics',
  description:
    'Retrieve the business meaning of a database Column by traversing the Collibra operating model: ' +
    'Column → Data Attributes → Business Terms / Measures. ' +
    'Answers: "What business concepts does this column represent?" ' +
    'Use get_table_semantics for a full table view, or this tool for a single column.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      column_asset_id: {
        type: 'string',
        description: 'The UUID of the Column asset to analyze',
      },
    },
    required: ['instance_name', 'column_asset_id'],
  },
};

async function fetchRelations(
  client: CollibraClient,
  relationTypeId: string,
  sourceId?: string,
  targetId?: string,
): Promise<any[]> {
  const params = new URLSearchParams({ relationTypeId, limit: '1000' });
  if (sourceId) params.append('sourceId', sourceId);
  if (targetId) params.append('targetId', targetId);
  try {
    const resp = await client.restCall<any>(`/rest/2.0/relations?${params.toString()}`);
    return resp.results || [];
  } catch {
    return [];
  }
}

export async function executeGetColumnSemantics(args: any): Promise<string> {
  const { instance_name, column_asset_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Step 1: Find Data Attributes linked to this column
    const dataAttributeRelTypeIds = [
      DATA_ATTRIBUTE_REL_ID_1,
      DATA_ATTRIBUTE_REL_ID_2,
      GENERIC_CONNECTED_ASSET_REL_ID,
    ];

    const relResults = await Promise.all(
      dataAttributeRelTypeIds.flatMap((relTypeId) => [
        fetchRelations(client, relTypeId, column_asset_id),
        fetchRelations(client, relTypeId, undefined, column_asset_id),
      ]),
    );

    const dataAttrMap = new Map<string, any>();
    for (const relations of relResults) {
      for (const rel of relations) {
        const other = rel.source.id === column_asset_id ? rel.target : rel.source;
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

    if (dataAttributes.length === 0) {
      return JSON.stringify({
        instance: instance_name,
        columnId: column_asset_id,
        columnUrl: client.assetUrl(column_asset_id),
        message: 'No data attributes found linked to this column.',
        dataAttributes: [],
      });
    }

    // Step 2: For each data attribute find linked Measures and Business Terms
    const enrichedDAs = await Promise.all(
      dataAttributes.map(async (da: any) => {
        const [measuresAsSource, measuresAsTarget, businessTermsAsSource, businessTermsAsTarget] =
          await Promise.all([
            fetchRelations(client, DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID, da.id),
            fetchRelations(client, DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID, undefined, da.id),
            fetchRelations(client, GENERIC_CONNECTED_ASSET_REL_ID, da.id),
            fetchRelations(client, GENERIC_CONNECTED_ASSET_REL_ID, undefined, da.id),
          ]);

        const measureMap = new Map<string, any>();
        for (const rel of [...measuresAsSource, ...measuresAsTarget]) {
          const other = rel.source.id === da.id ? rel.target : rel.source;
          if (!measureMap.has(other.id)) {
            measureMap.set(other.id, { id: other.id, name: other.name, url: client.assetUrl(other.id) });
          }
        }

        const btMap = new Map<string, any>();
        for (const rel of [...businessTermsAsSource, ...businessTermsAsTarget]) {
          const other = rel.source.id === da.id ? rel.target : rel.source;
          if (!btMap.has(other.id) && !measureMap.has(other.id)) {
            btMap.set(other.id, { id: other.id, name: other.name, url: client.assetUrl(other.id) });
          }
        }

        return {
          ...da,
          measures: Array.from(measureMap.values()),
          businessTerms: Array.from(btMap.values()),
        };
      }),
    );

    // Step 3: Find the parent table
    const tableRelations = await fetchRelations(client, COLUMN_TO_TABLE_REL_ID, column_asset_id);
    const table = tableRelations.length > 0
      ? { id: tableRelations[0].target.id, name: tableRelations[0].target.name, url: client.assetUrl(tableRelations[0].target.id) }
      : null;

    return JSON.stringify({
      instance: instance_name,
      columnId: column_asset_id,
      columnUrl: client.assetUrl(column_asset_id),
      parentTable: table,
      dataAttributes: enrichedDAs,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
