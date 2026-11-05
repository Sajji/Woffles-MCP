import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { fetchApplicableAssignment } from '../utils/operating-model-cache.js';
import { coerceAttributeValues, getAttributeTypeInfo, type AttributeTypeInfo } from '../utils/attributes.js';

export const bulkCreateAssetsTool = {
  name: 'bulk_create_assets',
  description:
    'Create one or more Collibra assets in a single POST /rest/2.0/assets/bulk call, ' +
    'optionally followed by a single POST /rest/2.0/attributes/bulk call for all attribute values across the batch. ' +
    'Use this tool for ALL asset creation — single or batch — for consistent preview/confirm safety. ' +
    'Mixed asset types and mixed target domains in one batch are supported. ' +
    'Two-step safety: ' +
    '1) Call with confirm=false (default) to PREVIEW the batch and detect existing assets by (domain_id, name). ' +
    '2) Call again with confirm=true to APPLY. ' +
    'Use prepare_create_asset first to resolve assetTypeId and domainId. ' +
    'For Business Terms, use asset_type_id=00000000-0000-0000-0000-000000011001 and Definition attribute type id 00000000-0000-0000-0000-000000000202.',
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

    // Same (domain, name) twice in one request: Collibra would reject the whole bulk POST.
    const seen = new Set<string>();
    const duplicateInRequest = existenceChecks.map((c) => {
      const key = `${c.input.domain_id}|${c.input.name}`;
      const dup = seen.has(key);
      seen.add(key);
      return dup;
    });

    // Required attributes per (asset type, target domain), from the assignment
    // that actually applies there (same gate as create_asset). If it cannot be
    // determined, skip enforcement rather than block.
    const reqKey = (a: any) => `${a.asset_type_id}|${a.domain_id}`;
    const requiredByType = new Map<string, { id: string; name: string }[]>();
    await Promise.all(
      [...new Map<string, any>(assets.map((a: any) => [reqKey(a), a])).values()].map(async (a: any) => {
        try {
          const assignment = await fetchApplicableAssignment(instance_name, a.asset_type_id, a.domain_id);
          requiredByType.set(
            reqKey(a),
            (assignment?.attributeTypes ?? []).filter((t) => (t.minimumOccurrences ?? 0) >= 1).map((t) => ({ id: t.id, name: t.name })),
          );
        } catch {
          requiredByType.set(reqKey(a), []);
        }
      }),
    );

    // Coerce attribute values by kind (DATE→epoch ms, MULTI_VALUE_LIST→split, RICH_TEXT→HTML…).
    const typeInfoCache = new Map<string, Promise<AttributeTypeInfo>>();
    const typeInfo = (id: string) => {
      if (!typeInfoCache.has(id)) typeInfoCache.set(id, getAttributeTypeInfo(client, id));
      return typeInfoCache.get(id)!;
    };
    const prepared = await Promise.all(
      existenceChecks.map(async (c, i) => {
        const provided = (c.input.attributes as Record<string, unknown>) || {};
        const missingRequired = (requiredByType.get(reqKey(c.input)) || []).filter((r) => !(r.id in provided));
        const attributeValues: { typeId: string; value: string | number | boolean }[] = [];
        const attributeErrors: string[] = [];
        for (const [typeId, raw] of Object.entries(provided)) {
          try {
            for (const value of coerceAttributeValues(await typeInfo(typeId), raw)) attributeValues.push({ typeId, value });
          } catch (err) {
            attributeErrors.push((err as Error).message);
          }
        }
        const blocked = missingRequired.length > 0 || attributeErrors.length > 0;
        return { ...c, duplicateInRequest: duplicateInRequest[i], missingRequired, attributeValues, attributeErrors, blocked };
      }),
    );

    const existingCount = prepared.filter((c) => c.existing).length;
    const isSkipped = (c: (typeof prepared)[number]) => c.duplicateInRequest || (skip_existing && !!c.existing);
    const blockedEntries = prepared.filter((c) => c.blocked && !isSkipped(c));
    const actionFor = (c: (typeof prepared)[number]) =>
      c.duplicateInRequest ? 'SKIP (duplicate in request)' :
      c.existing ? (skip_existing ? 'SKIP (already exists)' : 'ATTEMPT (server will likely reject)') :
      c.blocked ? 'BLOCKED (fix the errors below)' : 'CREATE';

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        totalRequested: assets.length,
        toCreate: prepared.filter((c) => !isSkipped(c) && !c.blocked).length,
        alreadyExist: existingCount,
        blocked: blockedEntries.length,
        details: prepared.map((c) => ({
          name: c.input.name,
          asset_type_id: c.input.asset_type_id,
          domain_id: c.input.domain_id,
          attributeCount: c.attributeValues.length,
          action: actionFor(c),
          existingAssetId: c.existing?.id ?? null,
          existingAssetUrl: c.existing ? client.assetUrl(c.existing.id) : null,
          ...(c.missingRequired.length ? { missingRequiredAttributes: c.missingRequired } : {}),
          ...(c.attributeErrors.length ? { attributeErrors: c.attributeErrors } : {}),
          ...(c.lookupError ? { lookupWarning: c.lookupError } : {}),
        })),
        instructions: blockedEntries.length
          ? 'Some entries are BLOCKED (missing required attributes or invalid values). Fix them, then call again with confirm=true.'
          : 'To apply, call again with confirm=true.',
      });
    }

    // Never create a partially valid batch: refuse if any entry is blocked.
    if (blockedEntries.length) {
      return ok({
        error: true,
        instance: instance_name,
        message:
          `${blockedEntries.length} asset(s) cannot be created: missing required attributes or invalid attribute values. ` +
          'Nothing was created. Fix the entries below and retry.',
        blocked: blockedEntries.map((c) => ({
          name: c.input.name,
          asset_type_id: c.input.asset_type_id,
          ...(c.missingRequired.length ? { missingRequiredAttributes: c.missingRequired } : {}),
          ...(c.attributeErrors.length ? { attributeErrors: c.attributeErrors } : {}),
        })),
      });
    }

    // Confirm — issue bulk POST
    const toCreate = prepared.filter((c) => !isSkipped(c));

    if (toCreate.length === 0) {
      return okPretty({
        mode: 'APPLIED',
        totalRequested: assets.length,
        created: 0,
        skipped: existingCount,
        message: 'All requested assets already exist — nothing to do.',
        details: prepared.map((c) => ({
          name: c.input.name,
          action: c.duplicateInRequest ? 'SKIPPED (duplicate in request)' : 'SKIPPED',
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
    const createdById = createdAssets.map((created, idx) => ({
      entry: toCreate[idx],
      values: toCreate[idx].attributeValues,
      created,
    }));

    // Fan all (already coerced) attributes across the batch into a single /attributes/bulk POST
    const attrBody = createdById.flatMap(({ values, created }) =>
      values.map((v) => ({ assetId: created.id, typeId: v.typeId, value: v.value })),
    );

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
      skipped: prepared.filter(isSkipped).length,
      attributesAttempted: attrBody.length,
      attributesCreated: attrError ? 0 : attrResults.length,
      details: prepared.map((c) => {
        const createdEntry = createdById.find((e) => e.entry === c);
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
          action: c.duplicateInRequest ? 'SKIPPED (duplicate in request)' : 'SKIPPED (existing)',
          existingAssetId: c.existing?.id ?? null,
        };
      }),
    };
    if (attrError) {
      output.status = 'partial';
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
