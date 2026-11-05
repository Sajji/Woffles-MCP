import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';
import { applyAttributeSetPlans, getAttributeTypeInfo, planAttributeSet } from '../utils/attributes.js';

// Well-known Collibra attribute type ID for "Description"
const DESCRIPTION_TYPE_ID = '00000000-0000-0000-0000-000000003114';

export const updateAssetDescriptionTool = {
  name: 'update_asset_description',
  description: 'Update the Description attribute of a Collibra asset. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the current description and see what will change. ' +
    '2) Call again with confirm=true to APPLY the change. ' +
    'The preview step fetches the asset name and current description so you can verify before committing. ' +
    'For updating 2 or more assets, prefer bulk_update_asset_descriptions (one /attributes/bulk call instead of N).',
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
  outputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['PREVIEW — no changes made', 'APPLIED'],
        description: 'Whether this response previewed the change or applied it.',
      },
      asset: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
        },
      },
      currentDescription: { type: 'string', description: 'Present in preview mode.' },
      proposedDescription: { type: 'string', description: 'Present in preview mode.' },
      previousDescription: { type: 'string', description: 'Present after apply.' },
      newDescription: { type: 'string', description: 'Present after apply.' },
      attributeId: { type: 'string', description: 'Collibra attribute UUID written/updated.' },
      instructions: { type: 'string' },
      error: { type: 'boolean' },
      message: { type: 'string' },
    },
  },
};

export async function executeUpdateAssetDescription(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, new_description, confirm = false } = args;

  const { client } = clientFor(instance_name);

  // Same path as update_asset_attribute (shared planner): Markdown → HTML for
  // the RICH_TEXT Description, and every existing value record is covered.
  const [asset, type] = await Promise.all([
    client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(asset_id)}`),
    getAttributeTypeInfo(client, DESCRIPTION_TYPE_ID),
  ]);
  const plan = await planAttributeSet(client, asset_id, type, new_description);

  const assetRef = { id: asset_id, name: asset.name || 'Unknown', url: client.assetUrl(asset_id) };
  const currentDescription = plan.current[0] ?? '(no description set)';
  const proposedDescription = plan.proposed[0];

  // Preview mode — show what would change without modifying anything
  if (!confirm) {
    const preview = {
      mode: 'PREVIEW — no changes made',
      asset: assetRef,
      currentDescription,
      proposedDescription,
      instructions: 'To apply this change, call this tool again with confirm=true.',
    };
    return { text: JSON.stringify(preview, null, 2), structured: preview };
  }

  const result = await applyAttributeSetPlans(client, [plan]);
  return okWithNext({
    mode: 'APPLIED',
    asset: assetRef,
    previousDescription: currentDescription,
    newDescription: proposedDescription,
    attributeId: result.patched[0]?.id ?? result.posted[0]?.id ?? null,
  }, [
    { tool: 'get_asset_by_id', args: { instance_name, asset_id }, why: 'Verify the updated description on the asset.' },
  ], true);
}
