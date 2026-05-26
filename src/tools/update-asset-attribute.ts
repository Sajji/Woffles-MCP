import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const updateAssetAttributeTool = {
  name: 'update_asset_attribute',
  description: 'Update any attribute of a Collibra asset by specifying the attribute type ID. ' +
    'Works for all attribute kinds: STRING, BOOLEAN, NUMERIC, DATE, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, SCRIPT. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the current value and see what will change. ' +
    '2) Call again with confirm=true to APPLY the change. ' +
    'Use get_attribute_types first to find the attribute type ID for the attribute you want to update. ' +
    'For Boolean attributes (e.g. "Personally Identifiable Information"), pass "true" or "false" as the new_value string.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'The UUID of the asset whose attribute should be updated',
      },
      attribute_type_id: {
        type: 'string',
        description: 'The UUID of the attribute type to update (use get_attribute_types to find this)',
      },
      new_value: {
        type: 'string',
        description: 'The new value to set. For BOOLEAN: "true" or "false". For NUMERIC: a number as string. For DATE: epoch millis or ISO date string. For MULTI_VALUE_LIST: comma-separated values. For all others: a plain string.',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually apply the change. When false (default), returns a preview of the current vs. new value without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'asset_id', 'attribute_type_id', 'new_value'],
  },
};

export async function executeUpdateAssetAttribute(args: any): Promise<string> {
  const { instance_name, asset_id, attribute_type_id, new_value, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch asset info, current attribute value, and attribute type metadata in parallel
    const [asset, attributesResponse, attrTypeResponse] = await Promise.all([
      client.restCall<any>(`/rest/2.0/assets/${asset_id}`),
      client.restCall<any>(
        `/rest/2.0/attributes?assetId=${asset_id}&typeIds=${attribute_type_id}&limit=1`
      ),
      client.restCall<any>(
        `/rest/2.0/attributeTypes?offset=0&limit=1&nameMatchMode=EXACT`
      ).catch(() => null), // non-critical — we'll try to fetch the specific type
    ]);

    // Also fetch the specific attribute type by ID for its name
    let attrTypeName = 'Unknown';
    try {
      const attrType = await client.restCall<any>(`/rest/2.0/attributeTypes/${attribute_type_id}`);
      attrTypeName = attrType.name || 'Unknown';
    } catch {
      // Fall back — not critical
    }

    const assetName = asset.name || 'Unknown';
    const existingAttributes = attributesResponse.results || [];
    const existingAttr = existingAttributes[0];
    const currentValue = existingAttr?.value ?? '(not set)';

    // Preview mode
    if (!confirm) {
      const preview: any = {
        mode: 'PREVIEW — no changes made',
        asset: {
          id: asset_id,
          name: assetName,
          url: client.assetUrl(asset_id),
        },
        attributeType: {
          id: attribute_type_id,
          name: attrTypeName,
        },
        currentValue,
        proposedValue: new_value,
        instructions: 'To apply this change, call this tool again with confirm=true.',
      };
      return JSON.stringify(preview, null, 2);
    }

    // Confirm mode — apply the change
    let result: any;

    if (existingAttr) {
      // PATCH existing attribute
      result = await client.restCallWithBody<any>(
        `/rest/2.0/attributes/${existingAttr.id}`,
        'PATCH',
        { id: existingAttr.id, value: new_value },
      );
    } else {
      // POST a new attribute (asset doesn't have one for this type yet)
      result = await client.restCallWithBody<any>(
        '/rest/2.0/attributes',
        'POST',
        {
          assetId: asset_id,
          typeId: attribute_type_id,
          value: new_value,
        },
      );
    }

    const output: any = {
      mode: 'APPLIED',
      asset: {
        id: asset_id,
        name: assetName,
        url: client.assetUrl(asset_id),
      },
      attributeType: {
        id: attribute_type_id,
        name: attrTypeName,
      },
      previousValue: currentValue,
      newValue: new_value,
      attributeId: result.id || existingAttr?.id,
    };

    return JSON.stringify(output, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: `Failed to update asset attribute: ${(error as Error).message}`,
    });
  }
}
