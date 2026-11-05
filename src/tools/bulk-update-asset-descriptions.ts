import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';
import { applyAttributeSetPlans, getAttributeTypeInfo, planAttributeSet } from '../utils/attributes.js';

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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeBulkUpdateAssetDescriptions(args: any): Promise<ToolResult> {
  const { instance_name, updates, confirm = false } = args;

  if (!Array.isArray(updates) || updates.length === 0) {
    return ok({ error: 'updates must be a non-empty array of { asset_id, new_description }.' });
  }

  const { client } = clientFor(instance_name);

  // Same path as bulk_update_asset_attributes (shared planner): Markdown → HTML
  // for the RICH_TEXT Description, and every existing value record is covered.
  const type = await getAttributeTypeInfo(client, DESCRIPTION_TYPE_ID);
  const lookups = await Promise.all(
    updates.map(async (u: any) => {
      const [asset, plan] = await Promise.all([
        client.restCall<any>(`/rest/2.0/assets/${encodeURIComponent(u.asset_id)}`),
        planAttributeSet(client, u.asset_id, type, u.new_description),
      ]);
      return { assetId: u.asset_id, assetName: asset.name || 'Unknown', plan };
    }),
  );
  const current = (l: (typeof lookups)[number]) => l.plan.current[0] ?? '(no description set)';
  const isNew = (l: (typeof lookups)[number]) => l.plan.current.length === 0;

  // ── Preview mode ──────────────────────────────────────────────────
  if (!confirm) {
    return okPretty({
      mode: 'PREVIEW — no changes made',
      totalAssets: lookups.length,
      assetsToUpdate: lookups.filter((l) => !isNew(l)).length,
      assetsToAdd: lookups.filter(isNew).length,
      details: lookups.map((l) => ({
        assetId: l.assetId,
        assetName: l.assetName,
        assetUrl: client.assetUrl(l.assetId),
        currentDescription: current(l),
        proposedDescription: l.plan.proposed[0],
        action: isNew(l) ? 'ADD (POST)' : 'UPDATE (PATCH)',
      })),
      instructions: 'To apply all changes, call this tool again with confirm=true.',
    });
  }

  // ── Confirm mode — one bulk PATCH + one bulk POST ─────────────────
  const result = await applyAttributeSetPlans(client, lookups.map((l) => l.plan));
  return okWithNext({
    mode: 'APPLIED',
    totalAssets: lookups.length,
    updated: lookups.filter((l) => !isNew(l)).length,
    added: lookups.filter(isNew).length,
    details: lookups.map((l) => {
      const patchedIds = new Set(l.plan.patch.map((p) => p.id));
      const written = [...result.patched, ...result.posted].find(
        (r: any) => patchedIds.has(r?.id) || r?.asset?.id === l.assetId,
      );
      return {
        assetId: l.assetId,
        assetName: l.assetName,
        assetUrl: client.assetUrl(l.assetId),
        previousDescription: current(l),
        newDescription: l.plan.proposed[0],
        action: isNew(l) ? 'ADDED' : 'UPDATED',
        attributeId: written?.id ?? null,
      };
    }),
  }, [
    { tool: 'get_asset_by_id', args: { instance_name, asset_id: '<any updated assetId from details>' }, why: 'Spot-check an updated asset.' },
    { tool: 'query_assets', args: { instance_name, asset_type_name: '<type>' }, why: 'Re-query the affected asset type to verify state.' },
  ], true);
}
