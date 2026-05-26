import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra attribute type ID for "Description"
const DESCRIPTION_TYPE_ID = '00000000-0000-0000-0000-000000003114';

export const updateAssetDescriptionTool = {
  name: 'update_asset_description',
  description: 'Update the Description attribute of a Collibra asset. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the current description and see what will change. ' +
    '2) Call again with confirm=true to APPLY the change. ' +
    'The preview step fetches the asset name and current description so you can verify before committing.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'The UUID of the asset whose description should be updated',
      },
      new_description: {
        type: 'string',
        description: 'The new description text to set on the asset',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually apply the change. When false (default), returns a preview of the current vs. new description without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'asset_id', 'new_description'],
  },
};

export async function executeUpdateAssetDescription(args: any): Promise<string> {
  const { instance_name, asset_id, new_description, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Step 1: Fetch asset info and current Description attribute
    const [asset, attributesResponse] = await Promise.all([
      client.restCall<any>(`/rest/2.0/assets/${asset_id}`),
      client.restCall<any>(
        `/rest/2.0/attributes?assetId=${asset_id}&typeIds=${DESCRIPTION_TYPE_ID}&limit=1`
      ),
    ]);

    const assetName = asset.name || 'Unknown';
    const existingAttributes = attributesResponse.results || [];
    const existingAttr = existingAttributes[0];
    const currentDescription = existingAttr?.value ?? '(no description set)';

    // Preview mode — show what would change without modifying anything
    if (!confirm) {
      const preview: any = {
        mode: 'PREVIEW — no changes made',
        asset: {
          id: asset_id,
          name: assetName,
          url: client.assetUrl(asset_id),
        },
        currentDescription,
        proposedDescription: new_description,
        instructions: 'To apply this change, call this tool again with confirm=true.',
      };
      return JSON.stringify(preview, null, 2);
    }

    // Confirm mode — apply the change
    let result: any;

    if (existingAttr) {
      // PATCH existing Description attribute
      result = await client.restCallWithBody<any>(
        `/rest/2.0/attributes/${existingAttr.id}`,
        'PATCH',
        { id: existingAttr.id, value: new_description },
      );
    } else {
      // POST a new Description attribute (asset doesn't have one yet)
      result = await client.restCallWithBody<any>(
        '/rest/2.0/attributes',
        'POST',
        {
          assetId: asset_id,
          typeId: DESCRIPTION_TYPE_ID,
          value: new_description,
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
      previousDescription: currentDescription,
      newDescription: new_description,
      attributeId: result.id || existingAttr?.id,
    };

    return JSON.stringify(output, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: `Failed to update asset description: ${(error as Error).message}`,
    });
  }
}
