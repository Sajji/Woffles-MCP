import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { applyAttributeSetPlans, getAttributeTypeInfo, planAttributeSet } from '../utils/attributes.js';

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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeBulkUpdateAssetAttributes(args: any): Promise<ToolResult> {
  const { instance_name, attribute_type_id, updates, confirm = false } = args;

  if (!Array.isArray(updates) || updates.length === 0) {
    return ok({ error: 'updates must be a non-empty array of { asset_id, new_value }.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const attrType = await getAttributeTypeInfo(client, attribute_type_id);
    const attributeType = { id: attribute_type_id, name: attrType.name, kind: attrType.kind };
    const show = (values: unknown[]) => (values.length === 0 ? '(not set)' : values.length === 1 ? values[0] : values);

    // Fetch asset info and plan the value change for every asset in parallel.
    // planAttributeSet coerces values by kind and covers all existing value records.
    const lookups = await Promise.all(
      updates.map(async (u: any) => {
        const [asset, plan] = await Promise.all([
          client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(u.asset_id)}`),
          planAttributeSet(client, u.asset_id, attrType, u.new_value),
        ]);
        return { assetId: u.asset_id, assetName: asset.name || 'Unknown', plan };
      }),
    );

    // Preview mode
    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        attributeType,
        totalAssets: lookups.length,
        assetsToUpdate: lookups.filter((l) => l.plan.current.length > 0 && l.plan.action !== 'NO CHANGE').length,
        assetsToAdd: lookups.filter((l) => l.plan.current.length === 0).length,
        details: lookups.map((l) => ({
          assetId: l.assetId,
          assetName: l.assetName,
          assetUrl: client.assetUrl(l.assetId),
          currentValue: show(l.plan.current),
          proposedValue: show(l.plan.proposed),
          action: l.plan.action,
        })),
        instructions: 'To apply all changes, call this tool again with confirm=true.',
      });
    }

    // Confirm mode — one bulk PATCH + one bulk POST (+ DELETEs of surplus multi-values)
    const result = await applyAttributeSetPlans(client, lookups.map((l) => l.plan));

    const output = {
      mode: 'APPLIED',
      attributeType,
      totalAssets: lookups.length,
      updated: lookups.filter((l) => l.plan.current.length > 0 && l.plan.action !== 'NO CHANGE').length,
      added: lookups.filter((l) => l.plan.current.length === 0).length,
      details: lookups.map((l) => {
        const patchedIds = new Set(l.plan.patch.map((p) => p.id));
        const ids = [
          ...result.patched.filter((r: any) => patchedIds.has(r?.id)),
          ...result.posted.filter((r: any) => r?.asset?.id === l.assetId),
        ].map((r: any) => r.id);
        return {
          assetId: l.assetId,
          assetName: l.assetName,
          assetUrl: client.assetUrl(l.assetId),
          previousValue: show(l.plan.current),
          newValue: show(l.plan.proposed),
          action: l.plan.current.length === 0 ? 'ADDED' : l.plan.action === 'NO CHANGE' ? 'UNCHANGED' : 'UPDATED',
          attributeIds: ids,
        };
      }),
    };

    return okWithNext(output, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id: '<any updated assetId from details>' }, why: 'Spot-check an updated asset.' },
      { tool: 'query_assets', args: { instance_name, asset_type_name: '<type>' }, why: 'Re-query the affected asset type to verify state.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: `Failed to bulk update attributes: ${(error as Error).message}`,
      instance: instance_name,
    });
  }
}
