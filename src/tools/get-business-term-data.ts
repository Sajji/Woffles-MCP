import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra relation type UUIDs
const COLUMN_TO_TABLE_REL_ID = '00000000-0000-0000-0000-000000007042';
const DATA_ATTRIBUTE_REL_ID_1 = '00000000-0000-0000-0000-000000007094';
const DATA_ATTRIBUTE_REL_ID_2 = 'cd000000-0000-0000-0000-000000000023';
const GENERIC_CONNECTED_ASSET_REL_ID = '00000000-0000-0000-0000-000000007038';
const DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID = '00000000-0000-0000-0000-000000007200';

export const getBusinessTermDataTool = {
  name: 'get_business_term_data',
  description: 'Trace a Business Term or Measure back to its physical data by traversing the Collibra ' +
    'operating model in reverse: Business Term/Measure → Data Attributes → Columns → Tables. ' +
    'Uses well-known Collibra relation types to follow the semantic chain backwards. ' +
    'Answers: "Where does this business concept live in the actual data?"',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      term_asset_id: {
        type: 'string',
        description: 'The UUID of the Business Term or Measure asset to trace',
      },
    },
    required: ['instance_name', 'term_asset_id'],
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

export async function executeGetBusinessTermData(args: any): Promise<string> {
  const { instance_name, term_asset_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Step 1: Find Data Attributes linked to this term/measure
    // Check both measure relation and generic data attribute relations
    const dataAttributeRelTypeIds = [
      DATA_ATTRIBUTE_REPRESENTS_MEASURE_REL_ID,
      DATA_ATTRIBUTE_REL_ID_1,
      DATA_ATTRIBUTE_REL_ID_2,
      GENERIC_CONNECTED_ASSET_REL_ID,
    ];

    const relResults = await Promise.all(
      dataAttributeRelTypeIds.flatMap((relTypeId) => [
        fetchRelations(client, relTypeId, term_asset_id),
        fetchRelations(client, relTypeId, undefined, term_asset_id),
      ]),
    );

    // Deduplicate data attributes
    const dataAttrMap = new Map<string, any>();
    for (const relations of relResults) {
      for (const rel of relations) {
        const other = rel.source.id === term_asset_id ? rel.target : rel.source;
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
        termId: term_asset_id,
        termUrl: client.assetUrl(term_asset_id),
        message: 'No Data Attributes found linked to this term/measure.',
        dataAttributes: [],
      });
    }

    // Step 2: For each Data Attribute, find linked Columns
    const enrichedDAs = await Promise.all(
      dataAttributes.map(async (da: any) => {
        // Columns are linked via the same data attribute relation types
        const colRelResults = await Promise.all(
          [DATA_ATTRIBUTE_REL_ID_1, DATA_ATTRIBUTE_REL_ID_2, GENERIC_CONNECTED_ASSET_REL_ID].flatMap(
            (relTypeId) => [
              fetchRelations(client, relTypeId, da.id),
              fetchRelations(client, relTypeId, undefined, da.id),
            ],
          ),
        );

        const columnMap = new Map<string, any>();
        for (const relations of colRelResults) {
          for (const rel of relations) {
            const other = rel.source.id === da.id ? rel.target : rel.source;
            // Exclude the original term itself
            if (other.id !== term_asset_id && !dataAttrMap.has(other.id) && !columnMap.has(other.id)) {
              columnMap.set(other.id, {
                id: other.id,
                name: other.name,
                url: client.assetUrl(other.id),
              });
            }
          }
        }

        const columns = Array.from(columnMap.values());

        // Step 3: For each Column, find its parent Table
        const enrichedColumns = await Promise.all(
          columns.map(async (col: any) => {
            const tableRels = await fetchRelations(client, COLUMN_TO_TABLE_REL_ID, col.id);

            const tables = tableRels.map((rel: any) => ({
              id: rel.target.id,
              name: rel.target.name,
              url: client.assetUrl(rel.target.id),
            }));

            return { ...col, tables };
          }),
        );

        return { ...da, columns: enrichedColumns };
      }),
    );

    return JSON.stringify({
      instance: instance_name,
      termId: term_asset_id,
      termUrl: client.assetUrl(term_asset_id),
      totalDataAttributes: enrichedDAs.length,
      dataAttributes: enrichedDAs,
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      termAssetId: term_asset_id,
    });
  }
}
