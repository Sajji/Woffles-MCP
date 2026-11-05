import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { applyAttributeSetPlans, getAttributeTypeInfo, planAttributeSet } from '../utils/attributes.js';

export const updateAssetAttributeTool = {
  name: 'update_asset_attribute',
  description: 'Update any attribute of a Collibra asset by specifying the attribute type ID. ' +
    'Works for all attribute kinds: STRING, BOOLEAN, NUMERIC, DATE, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, SCRIPT. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the current value and see what will change. ' +
    '2) Call again with confirm=true to APPLY the change. ' +
    'Use get_attribute_types first to find the attribute type ID for the attribute you want to update. ' +
    'For Boolean attributes (e.g. "Personally Identifiable Information"), pass "true" or "false" as the new_value string. ' +
    'For updating 2 or more assets, prefer bulk_update_asset_attributes (one /attributes/bulk call). ' +
    'For applying many DIFFERENT changes to a single asset, prefer edit_asset.',
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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeUpdateAssetAttribute(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, attribute_type_id, new_value, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const [asset, attrType] = await Promise.all([
      client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(asset_id)}`),
      getAttributeTypeInfo(client, attribute_type_id),
    ]);
    // Coerces the value by kind (DATE→epoch ms, MULTI_VALUE_LIST→split, RICH_TEXT→HTML…)
    // and covers every existing value record, not just the first.
    const plan = await planAttributeSet(client, asset_id, attrType, new_value);

    const assetName = asset.name || 'Unknown';
    const currentValue = plan.current.length === 0 ? '(not set)' : plan.current.length === 1 ? plan.current[0] : plan.current;
    const proposedValue = plan.proposed.length === 1 ? plan.proposed[0] : plan.proposed;
    const attributeType = { id: attribute_type_id, name: attrType.name, kind: attrType.kind };

    // Preview mode
    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        asset: { id: asset_id, name: assetName, url: client.assetUrl(asset_id) },
        attributeType,
        currentValue,
        proposedValue,
        action: plan.action,
        instructions: 'To apply this change, call this tool again with confirm=true.',
      });
    }

    // Confirm mode — apply the change
    const result = await applyAttributeSetPlans(client, [plan]);

    const output: any = {
      mode: 'APPLIED',
      asset: { id: asset_id, name: assetName, url: client.assetUrl(asset_id) },
      attributeType,
      previousValue: currentValue,
      newValue: proposedValue,
      action: plan.action,
      attributeIds: [...result.patched, ...result.posted].map((a: any) => a?.id).filter(Boolean),
      ...(result.deleted.length ? { deletedAttributeIds: result.deleted } : {}),
    };

    return okWithNext(output, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id }, why: 'Verify the updated attribute on the asset.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: `Failed to update asset attribute: ${(error as Error).message}`,
      instance: instance_name,
    });
  }
}