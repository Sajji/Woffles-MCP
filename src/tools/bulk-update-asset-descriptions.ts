import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// Well-known Collibra attribute type ID for "Description"
const DESCRIPTION_TYPE_ID = '00000000-0000-0000-0000-000000003114';

export const bulkUpdateAssetDescriptionsTool = {
  name: 'bulk_update_asset_descriptions',
  description: 'Update the Description attribute for multiple Collibra assets in a single bulk operation. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW current vs. proposed descriptions for every asset. ' +
    '2) Call again with confirm=true to APPLY all changes at once via the /attributes/bulk endpoint. ' +
    'Assets that already have a Description are updated with PATCH /attributes/bulk; ' +
    'assets missing a Description get one added via POST /attributes/bulk. ' +
    'For updating a single asset, prefer update_asset_description instead.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      updates: {
        type: 'array',
        description: 'Array of objects, each containing an asset_id and its new_description.',
        items: {
          type: 'object',
          properties: {
            asset_id: {
              type: 'string',
              description: 'The UUID of the asset whose description should be updated',
            },
            new_description: {
              type: 'string',
              description: 'The new description text to set on the asset',
            },
          },
          required: ['asset_id', 'new_description'],
        },
        minItems: 1,
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually apply all changes. When false (default), returns a preview of every current vs. proposed description without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'updates'],
  },
};

export async function executeBulkUpdateAssetDescriptions(args: any): Promise<string> {
  const { instance_name, updates, confirm = false } = args;

  if (!Array.isArray(updates) || updates.length === 0) {
    return JSON.stringify({ error: 'updates must be a non-empty array of { asset_id, new_description }.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch asset info and current Description attribute for every asset in parallel
    const lookups = await Promise.all(
      updates.map(async (u: any) => {
        const [asset, attributesResponse] = await Promise.all([
          client.restCall<any>(`/rest/2.0/assets/${u.asset_id}`),
          client.restCall<any>(
            `/rest/2.0/attributes?assetId=${u.asset_id}&typeIds=${DESCRIPTION_TYPE_ID}&limit=1`
          ),
        ]);

        const existingAttr = (attributesResponse.results || [])[0] ?? null;

        return {
          assetId: u.asset_id,
          assetName: asset.name || 'Unknown',
          newDescription: u.new_description,
          existingAttr,
          currentDescription: existingAttr?.value ?? '(no description set)',
        };
      }),
    );

    // ── Preview mode ──────────────────────────────────────────────────
    if (!confirm) {
      const preview = {
        mode: 'PREVIEW — no changes made',
        totalAssets: lookups.length,
        assetsToUpdate: lookups.filter((l) => l.existingAttr).length,
        assetsToAdd: lookups.filter((l) => !l.existingAttr).length,
        details: lookups.map((l) => ({
          assetId: l.assetId,
          assetName: l.assetName,
          assetUrl: client.assetUrl(l.assetId),
          currentDescription: l.currentDescription,
          proposedDescription: l.newDescription,
          action: l.existingAttr ? 'UPDATE (PATCH)' : 'ADD (POST)',
        })),
        instructions: 'To apply all changes, call this tool again with confirm=true.',
      };
      return JSON.stringify(preview, null, 2);
    }

    // ── Confirm mode — apply via bulk endpoints ───────────────────────
    const toUpdate = lookups.filter((l) => l.existingAttr);
    const toAdd = lookups.filter((l) => !l.existingAttr);

    let patchResults: any[] = [];
    let postResults: any[] = [];

    // PATCH existing descriptions in bulk
    if (toUpdate.length > 0) {
      const patchBody = toUpdate.map((l) => ({
        id: l.existingAttr.id,
        value: l.newDescription,
      }));
      patchResults = await client.restCallWithBody<any[]>(
        '/rest/2.0/attributes/bulk',
        'PATCH',
        patchBody,
      );
    }

    // POST new descriptions in bulk
    if (toAdd.length > 0) {
      const postBody = toAdd.map((l) => ({
        assetId: l.assetId,
        typeId: DESCRIPTION_TYPE_ID,
        value: l.newDescription,
      }));
      postResults = await client.restCallWithBody<any[]>(
        '/rest/2.0/attributes/bulk',
        'POST',
        postBody,
      );
    }

    const output = {
      mode: 'APPLIED',
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
          previousDescription: l.currentDescription,
          newDescription: l.newDescription,
          action: l.existingAttr ? 'UPDATED' : 'ADDED',
          attributeId: matchedResult?.id || l.existingAttr?.id,
        };
      }),
    };

    return JSON.stringify(output, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: `Failed to bulk update descriptions: ${(error as Error).message}`,
    });
  }
}
