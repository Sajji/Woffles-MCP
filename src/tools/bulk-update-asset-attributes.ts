import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const bulkUpdateAssetAttributesTool = {
  name: 'bulk_update_asset_attributes',
  description: 'Update any attribute type for multiple Collibra assets in a single bulk operation. ' +
    'Works for all attribute kinds: STRING, BOOLEAN, NUMERIC, DATE, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, SCRIPT. ' +
    'All updates in a single call must target the same attribute type. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW current vs. proposed values for every asset. ' +
    '2) Call again with confirm=true to APPLY all changes at once via the /attributes/bulk endpoint. ' +
    'Use get_attribute_types first to find the attribute type ID. ' +
    'For updating a single asset, prefer update_asset_attribute instead.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      attribute_type_id: {
        type: 'string',
        description: 'The UUID of the attribute type to update (use get_attribute_types to find this)',
      },
      updates: {
        type: 'array',
        description: 'Array of objects, each containing an asset_id and its new_value.',
        items: {
          type: 'object',
          properties: {
            asset_id: {
              type: 'string',
              description: 'The UUID of the asset whose attribute should be updated',
            },
            new_value: {
              type: 'string',
              description: 'The new value to set for this asset. For BOOLEAN: "true" or "false". For NUMERIC: a number as string. For others: a plain string.',
            },
          },
          required: ['asset_id', 'new_value'],
        },
        minItems: 1,
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually apply all changes. When false (default), returns a preview of every current vs. proposed value without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'attribute_type_id', 'updates'],
  },
};

export async function executeBulkUpdateAssetAttributes(args: any): Promise<string> {
  const { instance_name, attribute_type_id, updates, confirm = false } = args;

  if (!Array.isArray(updates) || updates.length === 0) {
    return JSON.stringify({ error: 'updates must be a non-empty array of { asset_id, new_value }.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch attribute type name
    let attrTypeName = 'Unknown';
    try {
      const attrType = await client.restCall<any>(`/rest/2.0/attributeTypes/${attribute_type_id}`);
      attrTypeName = attrType.name || 'Unknown';
    } catch {
      // non-critical
    }

    // Fetch asset info and current attribute value for every asset in parallel
    const lookups = await Promise.all(
      updates.map(async (u: any) => {
        const [asset, attributesResponse] = await Promise.all([
          client.restCall<any>(`/rest/2.0/assets/${u.asset_id}`),
          client.restCall<any>(
            `/rest/2.0/attributes?assetId=${u.asset_id}&typeIds=${attribute_type_id}&limit=1`
          ),
        ]);

        const existingAttr = (attributesResponse.results || [])[0] ?? null;

        return {
          assetId: u.asset_id,
          assetName: asset.name || 'Unknown',
          newValue: u.new_value,
          existingAttr,
          currentValue: existingAttr?.value ?? '(not set)',
        };
      }),
    );

    // Preview mode
    if (!confirm) {
      const preview = {
        mode: 'PREVIEW — no changes made',
        attributeType: {
          id: attribute_type_id,
          name: attrTypeName,
        },
        totalAssets: lookups.length,
        assetsToUpdate: lookups.filter((l) => l.existingAttr).length,
        assetsToAdd: lookups.filter((l) => !l.existingAttr).length,
        details: lookups.map((l) => ({
          assetId: l.assetId,
          assetName: l.assetName,
          assetUrl: client.assetUrl(l.assetId),
          currentValue: l.currentValue,
          proposedValue: l.newValue,
          action: l.existingAttr ? 'UPDATE (PATCH)' : 'ADD (POST)',
        })),
        instructions: 'To apply all changes, call this tool again with confirm=true.',
      };
      return JSON.stringify(preview, null, 2);
    }

    // Confirm mode — apply via bulk endpoints
    const toUpdate = lookups.filter((l) => l.existingAttr);
    const toAdd = lookups.filter((l) => !l.existingAttr);

    let patchResults: any[] = [];
    let postResults: any[] = [];

    // PATCH existing attributes in bulk
    if (toUpdate.length > 0) {
      const patchBody = toUpdate.map((l) => ({
        id: l.existingAttr.id,
        value: l.newValue,
      }));
      patchResults = await client.restCallWithBody<any[]>(
        '/rest/2.0/attributes/bulk',
        'PATCH',
        patchBody,
      );
    }

    // POST new attributes in bulk
    if (toAdd.length > 0) {
      const postBody = toAdd.map((l) => ({
        assetId: l.assetId,
        typeId: attribute_type_id,
        value: l.newValue,
      }));
      postResults = await client.restCallWithBody<any[]>(
        '/rest/2.0/attributes/bulk',
        'POST',
        postBody,
      );
    }

    const output = {
      mode: 'APPLIED',
      attributeType: {
        id: attribute_type_id,
        name: attrTypeName,
      },
      totalAssets: lookups.length,
      updated: toUpdate.length,
      added: toAdd.length,
      details: lookups.map((l) => {
        const matchedResult = l.existingAttr
          ? (patchResults || []).find((r: any) => r.id === l.existingAttr.id)
          : (postResults || []).find((r: any) => r.asset?.id === l.assetId);

        return {
          assetId: l.assetId,
          assetName: l.assetName,
          assetUrl: client.assetUrl(l.assetId),
          previousValue: l.currentValue,
          newValue: l.newValue,
          action: l.existingAttr ? 'UPDATED' : 'ADDED',
          attributeId: matchedResult?.id || l.existingAttr?.id,
        };
      }),
    };

    return JSON.stringify(output, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: `Failed to bulk update attributes: ${(error as Error).message}`,
    });
  }
}
