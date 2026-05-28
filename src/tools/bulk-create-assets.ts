import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const bulkCreateAssetsTool = {
  name: 'bulk_create_assets',
  description:
    'Create multiple Collibra assets in a single POST /rest/2.0/assets/bulk call, ' +
    'optionally followed by a single POST /rest/2.0/attributes/bulk call for all attribute values across the batch. ' +
    'Far more efficient than calling create_asset N times (1–2 round trips instead of N×(1+M)). ' +
    'Mixed asset types and mixed target domains in one batch are supported. ' +
    'Two-step safety: ' +
    '1) Call with confirm=false (default) to PREVIEW the batch and detect existing assets by (domain_id, name). ' +
    '2) Call again with confirm=true to APPLY. ' +
    'For a SINGLE asset prefer create_asset (no preview round trip).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      assets: {
        type: 'array',
        description: 'Array of assets to create. Each entry mirrors the input of create_asset.',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name of the asset (must be unique within domain).' },
            asset_type_id: { type: 'string', description: 'UUID of the asset type.' },
            domain_id: { type: 'string', description: 'UUID of the target domain.' },
            display_name: { type: 'string', description: 'Optional display name.' },
            status_id: { type: 'string', description: 'Optional UUID of the workflow status.' },
            attributes: {
              type: 'object',
              description: 'Optional map of attribute type UUID → string value. Fanned out via /attributes/bulk after asset creation.',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['name', 'asset_type_id', 'domain_id'],
        },
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually create the assets. When false (default), returns a preview including any name collisions detected per (domain_id, name).',
        default: false,
      },
      skip_existing: {
        type: 'boolean',
        description: 'When true (default), assets whose (domain_id, name) already exists are skipped in confirm mode. When false, the bulk POST will be attempted as-is and Collibra will reject duplicates.',
        default: true,
      },
    },
    required: ['instance_name', 'assets'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeBulkCreateAssets(args: any): Promise<ToolResult> {
  const { instance_name, assets, confirm = false, skip_existing = true } = args;

  if (!Array.isArray(assets) || assets.length === 0) {
    return ok({ error: 'assets must be a non-empty array of asset descriptors.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Detect existing assets per (domain_id, name) in parallel
    const existenceChecks = await Promise.all(
      assets.map(async (a: any) => {
        const params = new URLSearchParams({
          name: a.name,
          domainId: a.domain_id,
          nameMatchMode: 'EXACT',
          limit: '5',
          offset: '0',
        });
        try {
          const resp = await client.restCall<any>(`/rest/2.0/assets?${params.toString()}`);
          const match = (resp.results || []).find((r: any) => r.name === a.name && (r.domain?.id ?? r.domainId) === a.domain_id);
          return { input: a, existing: match || null };
        } catch (err) {
          return { input: a, existing: null, lookupError: (err as Error).message };
        }
      }),
    );

    const existingCount = existenceChecks.filter((c) => c.existing).length;
    const newCount = existenceChecks.length - existingCount;

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        totalRequested: assets.length,
        toCreate: newCount,
        alreadyExist: existingCount,
        details: existenceChecks.map((c) => ({
          name: c.input.name,
          asset_type_id: c.input.asset_type_id,
          domain_id: c.input.domain_id,
          attributeCount: c.input.attributes ? Object.keys(c.input.attributes).length : 0,
          action: c.existing ? (skip_existing ? 'SKIP (already exists)' : 'ATTEMPT (server will likely reject)') : 'CREATE',
          existingAssetId: c.existing?.id ?? null,
          existingAssetUrl: c.existing ? client.assetUrl(c.existing.id) : null,
          ...(c.lookupError ? { lookupWarning: c.lookupError } : {}),
        })),
        instructions: 'To apply, call again with confirm=true.',
      });
    }

    // Confirm — issue bulk POST
    const toCreate = skip_existing
      ? existenceChecks.filter((c) => !c.existing)
      : existenceChecks;

    if (toCreate.length === 0) {
      return okPretty({
        mode: 'APPLIED',
        totalRequested: assets.length,
        created: 0,
        skipped: existingCount,
        message: 'All requested assets already exist — nothing to do.',
        details: existenceChecks.map((c) => ({
          name: c.input.name,
          action: 'SKIPPED',
          existingAssetId: c.existing?.id ?? null,
        })),
      });
    }

    const bulkAssetBody = toCreate.map((c) => {
      const a = c.input;
      const body: any = { name: a.name, typeId: a.asset_type_id, domainId: a.domain_id };
      if (a.display_name) body.displayName = a.display_name;
      if (a.status_id) body.statusId = a.status_id;
      return body;
    });

    const createdAssets = await client.restCallWithBody<any[]>('/rest/2.0/assets/bulk', 'POST', bulkAssetBody);

    // Map server response back to inputs by index (Collibra returns results in request order)
    const createdById: { input: any; created: any }[] = createdAssets.map((created, idx) => ({
      input: toCreate[idx].input,
      created,
    }));

    // Fan all attributes across the batch into a single /attributes/bulk POST
    const attrBody: { assetId: string; typeId: string; value: string }[] = [];
    for (const { input, created } of createdById) {
      if (input.attributes && typeof input.attributes === 'object') {
        for (const [typeId, value] of Object.entries(input.attributes as Record<string, string>)) {
          attrBody.push({ assetId: created.id, typeId, value });
        }
      }
    }

    let attrResults: any[] = [];
    let attrError: string | null = null;
    if (attrBody.length > 0) {
      try {
        attrResults = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', attrBody);
      } catch (err) {
        attrError = (err as Error).message;
      }
    }

    const output: any = {
      mode: 'APPLIED',
      totalRequested: assets.length,
      created: createdById.length,
      skipped: skip_existing ? existingCount : 0,
      attributesAttempted: attrBody.length,
      attributesCreated: attrError ? 0 : attrResults.length,
      details: existenceChecks.map((c) => {
        const createdEntry = createdById.find((e) => e.input === c.input);
        if (createdEntry) {
          return {
            name: c.input.name,
            action: 'CREATED',
            assetId: createdEntry.created.id,
            assetUrl: client.assetUrl(createdEntry.created.id),
          };
        }
        return {
          name: c.input.name,
          action: 'SKIPPED (existing)',
          existingAssetId: c.existing?.id ?? null,
        };
      }),
    };
    if (attrError) {
      output.attributeError = attrError;
      output.warning = 'Assets were created but the bulk attribute POST failed. Re-issue attributes via bulk_update_asset_attributes.';
    }

    return okWithNext(output, [
      { tool: 'query_assets', args: { instance_name, asset_type_name: '<type>' }, why: 'Verify the new assets appear in queries.' },
      { tool: 'bulk_update_asset_attributes', args: { instance_name, attribute_type_id: '<typeId>', updates: [{ asset_id: '<newAssetId>', new_value: '<value>' }] }, why: 'Add or fix attribute values after creation.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
