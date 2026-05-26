import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra relation type UUIDs
const COLUMN_TO_TABLE_REL_ID = '00000000-0000-0000-0000-000000007042';
const DATA_ATTRIBUTE_REL_ID_1 = '00000000-0000-0000-0000-000000007094';
const DATA_ATTRIBUTE_REL_ID_2 = 'cd000000-0000-0000-0000-000000000023';
const GENERIC_CONNECTED_ASSET_REL_ID = '00000000-0000-0000-0000-000000007038';
const DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID = '00000000-0000-0000-0000-000000007200';

export const getMeasureDataTool = {
  name: 'get_measure_data',
  description:
    'Trace a Measure back to its physical data by traversing the Collibra operating model: ' +
    'Measure → Data Attributes → Columns → Tables. ' +
    'Answers: "Which physical columns are used to calculate this measure?" ' +
    'Use get_business_term_data for Business Terms, or get_column_semantics to go the other direction.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      measure_asset_id: {
        type: 'string',
        description: 'The UUID of the Measure asset to trace',
      },
    },
    required: ['instance_name', 'measure_asset_id'],
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

export async function executeGetMeasureData(args: any): Promise<string> {
  const { instance_name, measure_asset_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Step 1: Find Data Attributes linked to this measure
    const dataAttributeRelTypeIds = [
      DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID,
      DATA_ATTRIBUTE_REL_ID_1,
      DATA_ATTRIBUTE_REL_ID_2,
      GENERIC_CONNECTED_ASSET_REL_ID,
    ];

    const relResults = await Promise.all(
      dataAttributeRelTypeIds.flatMap((relTypeId) => [
        fetchRelations(client, relTypeId, measure_asset_id),
        fetchRelations(client, relTypeId, undefined, measure_asset_id),
      ]),
    );

    const dataAttrMap = new Map<string, any>();
    for (const relations of relResults) {
      for (const rel of relations) {
        const other = rel.source.id === measure_asset_id ? rel.target : rel.source;
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
        measureId: measure_asset_id,
        measureUrl: client.assetUrl(measure_asset_id),
        message: 'No data attributes found linked to this measure.',
        dataAttributes: [],
      });
    }

    // Step 2: For each data attribute, find linked Columns
    const enrichedDAs = await Promise.all(
      dataAttributes.map(async (da: any) => {
        const colRelTypeIds = [DATA_ATTRIBUTE_REL_ID_1, DATA_ATTRIBUTE_REL_ID_2, GENERIC_CONNECTED_ASSET_REL_ID];
        const colResults = await Promise.all(
          colRelTypeIds.flatMap((relTypeId) => [
            fetchRelations(client, relTypeId, da.id),
            fetchRelations(client, relTypeId, undefined, da.id),
          ]),
        );

        const colMap = new Map<string, any>();
        for (const relations of colResults) {
          for (const rel of relations) {
            const other = rel.source.id === da.id ? rel.target : rel.source;
            if (!colMap.has(other.id)) {
              colMap.set(other.id, { id: other.id, name: other.name, url: client.assetUrl(other.id) });
            }
          }
        }

        const columns = Array.from(colMap.values());

        // Step 3: For each column, find the parent table
        const enrichedCols = await Promise.all(
          columns.map(async (col: any) => {
            const tableRels = await fetchRelations(client, COLUMN_TO_TABLE_REL_ID, col.id);
            const table = tableRels.length > 0
              ? { id: tableRels[0].target.id, name: tableRels[0].target.name, url: client.assetUrl(tableRels[0].target.id) }
              : null;
            return { ...col, table };
          }),
        );

        return { ...da, columns: enrichedCols };
      }),
    );

    return JSON.stringify({
      instance: instance_name,
      measureId: measure_asset_id,
      measureUrl: client.assetUrl(measure_asset_id),
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
