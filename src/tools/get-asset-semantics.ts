import type { ToolResult } from '../types.js';
import { ok } from '../utils/tool-result.js';
import { clientFor } from './_context.js';
import { executeGetTableSemantics } from './get-table-semantics.js';
import { executeGetColumnSemantics } from './get-column-semantics.js';
import { executeGetBusinessTermData } from './get-business-term-data.js';
import { executeGetMeasureData } from './get-measure-data.js';

/** Out-of-the-box asset type UUIDs the semantics traversals are built on. */
const KINDS: Record<string, 'table' | 'column' | 'business_term' | 'measure'> = {
  '00000000-0000-0000-0000-000000031007': 'table',
  '00000000-0000-0000-0000-000000031008': 'column',
  '00000000-0000-0000-0000-000000011001': 'business_term',
  '00000000-0000-0000-0000-000000031104': 'measure',
};

export const getAssetSemanticsTool = {
  name: 'get_asset_semantics',
  description:
    'Explain the business meaning of a physical asset, or the physical data behind a business asset, by traversing ' +
    'Data Attributes in the operating model. Detects the asset kind automatically (including subtypes such as Database View):\n' +
    '- Table → its columns, each with linked Data Attributes and Measures\n' +
    '- Column → its Data Attributes, Business Terms, Measures and parent table\n' +
    '- Business Term → Data Attributes → Columns → Tables\n' +
    '- Measure → Data Attributes → Columns → Tables',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The name of the Collibra instance (as defined in config.json)' },
      asset_id: { type: 'string', description: 'UUID of a Table, Column, Business Term or Measure asset (or a subtype).' },
    },
    required: ['instance_name', 'asset_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Semantics for the asset; `kind` says which traversal was used.',
    additionalProperties: true,
  },
};

export async function executeGetAssetSemantics(args: any): Promise<ToolResult> {
  const { instance_name, asset_id } = args;
  const { client } = clientFor(instance_name);

  const asset = await client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(asset_id)}`);
  // Walk up the asset type hierarchy until a supported kind is found.
  let typeId: string | undefined = asset.type?.id;
  let kind: (typeof KINDS)[string] | undefined;
  for (let depth = 0; typeId && depth < 10 && !kind; depth++) {
    kind = KINDS[typeId];
    if (!kind) {
      const type = await client.restCall<any>(`/rest/2.0/assetTypes/${encodeURIComponent(typeId)}`);
      typeId = type.parent?.id;
    }
  }
  if (!kind) {
    return ok({
      error: true,
      instance: instance_name,
      message:
        `Asset "${asset.name}" is of type "${asset.type?.name}", which is not a Table, Column, Business Term or Measure ` +
        '(or a subtype of one). Use get_asset_relations to explore its relations instead.',
    });
  }

  const result =
    kind === 'table' ? await executeGetTableSemantics({ instance_name, table_asset_id: asset_id }) :
    kind === 'column' ? await executeGetColumnSemantics({ instance_name, column_asset_id: asset_id }) :
    kind === 'business_term' ? await executeGetBusinessTermData({ instance_name, term_asset_id: asset_id }) :
    await executeGetMeasureData({ instance_name, measure_asset_id: asset_id });

  const structured = { kind, assetName: asset.name, assetType: asset.type?.name ?? null, ...(result.structured as object) };
  return { text: JSON.stringify(structured), structured };
}
