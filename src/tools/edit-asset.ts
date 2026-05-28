import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * `edit_asset` — chip-inspired multi-op tool that lets the agent apply a
 * sequence of typed edits to a single asset in as few round trips as possible.
 *
 * Supported operations:
 *   - { op: 'update_attribute', attribute_type_id, value }     // PATCH if present, else POST
 *   - { op: 'add_attribute',    attribute_type_id, value }     // POST (always)
 *   - { op: 'remove_attribute', attribute_type_id }            // DELETE all matching attribute IDs
 *   - { op: 'update_property',  property: 'name'|'displayName'|'statusId', value }
 *   - { op: 'add_relation',     target_asset_id, relation_type_id }     // idempotent
 *   - { op: 'remove_relation',  target_asset_id, relation_type_id }
 *
 * Attribute ops are batched into a single /attributes/bulk PATCH + POST.
 * Relation ops are batched into a single /relations/bulk POST + DELETE.
 * Property changes are a single PATCH /assets/{id}.
 */
export const editAssetTool = {
  name: 'edit_asset',
  description:
    'Apply a list of typed edits to a single Collibra asset in one tool call. ' +
    'Supported ops: update_attribute, add_attribute, remove_attribute, update_property, add_relation, remove_relation. ' +
    'Internally batches attribute changes via /attributes/bulk and relation changes via /relations/bulk — ' +
    'one tool call replaces what would otherwise be many singleton calls (update_asset_attribute, create_relation, …). ' +
    'Two-step safety: ' +
    '1) Call with confirm=false (default) to PREVIEW every resolved op (current vs. proposed value). ' +
    '2) Call with confirm=true to APPLY all ops as a single batch. ' +
    'For changes affecting MANY assets (e.g. setting the same attribute on 50 assets), prefer bulk_update_asset_attributes instead.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The Collibra instance name.' },
      asset_id: { type: 'string', description: 'UUID of the asset to edit.' },
      operations: {
        type: 'array',
        minItems: 1,
        description: 'Ordered list of edit operations to apply.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['update_attribute', 'add_attribute', 'remove_attribute', 'update_property', 'add_relation', 'remove_relation'],
            },
            attribute_type_id: { type: 'string', description: 'For *_attribute ops: UUID of the attribute type.' },
            value: { type: 'string', description: 'For attribute and update_property ops: the value to set.' },
            property: {
              type: 'string',
              enum: ['name', 'displayName', 'statusId'],
              description: 'For update_property: which top-level asset property to change.',
            },
            target_asset_id: { type: 'string', description: 'For *_relation ops: UUID of the other asset.' },
            relation_type_id: { type: 'string', description: 'For *_relation ops: UUID of the relation type.' },
          },
          required: ['op'],
        },
      },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview. Set true to apply.',
        default: false,
      },
    },
    required: ['instance_name', 'asset_id', 'operations'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload.',
    additionalProperties: true,
  },
};

interface ResolvedOp {
  op: string;
  raw: any;
  notes?: string;
  error?: string;
  /** Current value/target on the server (for preview). */
  current?: unknown;
  /** Proposed value/target (for preview). */
  proposed?: unknown;
  /** Existing attribute IDs matching the op (for update_attribute/remove_attribute). */
  existingAttributeIds?: string[];
  /** Existing relation ID (for remove_relation / dedup of add_relation). */
  existingRelationId?: string;
}

export async function executeEditAsset(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, operations, confirm = false } = args;

  if (!Array.isArray(operations) || operations.length === 0) {
    return ok({ error: 'operations must be a non-empty array.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch the asset once
    const asset = await client.restCall<any>(`/rest/2.0/assets/${asset_id}`);

    // Resolve all ops up front: figure out current state, distinguish PATCH vs POST etc.
    const resolved: ResolvedOp[] = await Promise.all(
      operations.map(async (raw: any): Promise<ResolvedOp> => {
        switch (raw.op) {
          case 'update_attribute':
          case 'add_attribute':
          case 'remove_attribute': {
            if (!raw.attribute_type_id) {
              return { op: raw.op, raw, error: 'attribute_type_id is required.' };
            }
            const resp = await client.restCall<any>(
              `/rest/2.0/attributes?assetId=${asset_id}&typeIds=${raw.attribute_type_id}&limit=100`,
            );
            const existing = (resp.results || []) as any[];
            const ids = existing.map((a) => a.id);
            if (raw.op === 'remove_attribute') {
              return { op: raw.op, raw, current: existing.map((a) => a.value), proposed: null, existingAttributeIds: ids };
            }
            if (raw.op === 'add_attribute') {
              return { op: raw.op, raw, current: existing.map((a) => a.value), proposed: raw.value, existingAttributeIds: ids };
            }
            // update_attribute → PATCH if exists else POST
            return {
              op: raw.op,
              raw,
              current: existing[0]?.value ?? '(not set)',
              proposed: raw.value,
              existingAttributeIds: ids,
              notes: existing.length > 0 ? 'PATCH (existing)' : 'POST (new)',
            };
          }
          case 'update_property': {
            if (!raw.property || raw.value === undefined) {
              return { op: raw.op, raw, error: 'property and value are required.' };
            }
            const current =
              raw.property === 'name' ? asset.name :
              raw.property === 'displayName' ? asset.displayName :
              raw.property === 'statusId' ? asset.status?.id : undefined;
            return { op: raw.op, raw, current, proposed: raw.value };
          }
          case 'add_relation':
          case 'remove_relation': {
            if (!raw.target_asset_id || !raw.relation_type_id) {
              return { op: raw.op, raw, error: 'target_asset_id and relation_type_id are required.' };
            }
            const params = new URLSearchParams({
              sourceId: asset_id,
              typeId: raw.relation_type_id,
              limit: '1000',
              offset: '0',
            });
            const resp = await client.restCall<any>(`/rest/2.0/relations?${params.toString()}`);
            const match = (resp.results || []).find((r: any) => r.target?.id === raw.target_asset_id);
            const existingId = match?.id;
            return {
              op: raw.op,
              raw,
              current: existingId ? 'present' : 'absent',
              proposed: raw.op === 'add_relation' ? 'present' : 'absent',
              existingRelationId: existingId,
              notes:
                raw.op === 'add_relation'
                  ? existingId ? 'SKIP (already exists)' : 'CREATE'
                  : existingId ? 'DELETE' : 'SKIP (not present)',
            };
          }
          default:
            return { op: raw.op, raw, error: `Unknown op: ${raw.op}` };
        }
      }),
    );

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        asset: { id: asset_id, name: asset.name, url: client.assetUrl(asset_id) },
        operationCount: resolved.length,
        operations: resolved.map((r) => ({
          op: r.op,
          input: r.raw,
          current: r.current,
          proposed: r.proposed,
          ...(r.notes ? { plan: r.notes } : {}),
          ...(r.error ? { error: r.error } : {}),
        })),
        instructions: 'To apply, call again with confirm=true.',
      });
    }

    // ── Apply phase ────────────────────────────────────────────────
    const errors: any[] = resolved.filter((r) => r.error).map((r) => ({ op: r.op, input: r.raw, error: r.error }));
    const applied: any[] = [];

    // 1. Property change → single PATCH /assets/{id}
    const propOps = resolved.filter((r) => r.op === 'update_property' && !r.error);
    if (propOps.length > 0) {
      const body: any = { id: asset_id };
      for (const r of propOps) {
        body[r.raw.property] = r.raw.value;
      }
      try {
        await client.restCallWithBody<any>(`/rest/2.0/assets/${asset_id}`, 'PATCH', body);
        propOps.forEach((r) => applied.push({ op: r.op, property: r.raw.property, newValue: r.raw.value, status: 'APPLIED' }));
      } catch (err) {
        propOps.forEach((r) => errors.push({ op: r.op, input: r.raw, error: (err as Error).message }));
      }
    }

    // 2. Attribute removals → one DELETE per attribute id (Collibra has no /attributes/bulk DELETE)
    const removeAttrOps = resolved.filter((r) => r.op === 'remove_attribute' && !r.error);
    for (const r of removeAttrOps) {
      for (const aid of r.existingAttributeIds || []) {
        try {
          await client.restCallWithBody<void>(`/rest/2.0/attributes/${aid}`, 'DELETE', undefined as any);
          applied.push({ op: r.op, attribute_type_id: r.raw.attribute_type_id, attributeId: aid, status: 'DELETED' });
        } catch (err) {
          errors.push({ op: r.op, input: r.raw, attributeId: aid, error: (err as Error).message });
        }
      }
    }

    // 3. Attribute updates/adds → batch into /attributes/bulk PATCH + POST
    const updateOps = resolved.filter((r) => r.op === 'update_attribute' && !r.error);
    const addOps = resolved.filter((r) => r.op === 'add_attribute' && !r.error);

    const patchBody: { id: string; value: string }[] = [];
    const postBody: { assetId: string; typeId: string; value: string }[] = [];

    for (const r of updateOps) {
      const existingId = r.existingAttributeIds?.[0];
      if (existingId) patchBody.push({ id: existingId, value: r.raw.value });
      else postBody.push({ assetId: asset_id, typeId: r.raw.attribute_type_id, value: r.raw.value });
    }
    for (const r of addOps) {
      postBody.push({ assetId: asset_id, typeId: r.raw.attribute_type_id, value: r.raw.value });
    }

    if (patchBody.length > 0) {
      try {
        const resp = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'PATCH', patchBody);
        applied.push({ op: 'update_attribute', bulkPatch: patchBody.length, attributeIds: (resp || []).map((a: any) => a?.id) });
      } catch (err) {
        errors.push({ op: 'update_attribute', error: (err as Error).message, bulkPatchBody: patchBody });
      }
    }
    if (postBody.length > 0) {
      try {
        const resp = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', postBody);
        applied.push({ op: 'add_attribute_or_upsert', bulkPost: postBody.length, attributeIds: (resp || []).map((a: any) => a?.id) });
      } catch (err) {
        errors.push({ op: 'add_attribute', error: (err as Error).message, bulkPostBody: postBody });
      }
    }

    // 4. Relations → batch into /relations/bulk POST and /relations/bulk DELETE
    const addRelOps = resolved.filter((r) => r.op === 'add_relation' && !r.error && !r.existingRelationId);
    const removeRelOps = resolved.filter((r) => r.op === 'remove_relation' && !r.error && r.existingRelationId);

    if (addRelOps.length > 0) {
      const body = addRelOps.map((r) => ({
        sourceId: asset_id,
        targetId: r.raw.target_asset_id,
        typeId: r.raw.relation_type_id,
      }));
      try {
        const resp = await client.restCallWithBody<any[]>('/rest/2.0/relations/bulk', 'POST', body);
        applied.push({ op: 'add_relation', bulkPost: addRelOps.length, relationIds: (resp || []).map((r: any) => r?.id) });
      } catch (err) {
        errors.push({ op: 'add_relation', error: (err as Error).message });
      }
    }
    if (removeRelOps.length > 0) {
      const ids = removeRelOps.map((r) => r.existingRelationId!) as string[];
      try {
        await client.restCallWithBody<void>('/rest/2.0/relations/bulk', 'DELETE', ids);
        applied.push({ op: 'remove_relation', bulkDelete: ids.length, relationIds: ids });
      } catch (err) {
        errors.push({ op: 'remove_relation', error: (err as Error).message });
      }
    }

    return okWithNext({
      mode: 'APPLIED',
      asset: { id: asset_id, name: asset.name, url: client.assetUrl(asset_id) },
      requestedOps: operations.length,
      appliedActions: applied,
      ...(errors.length > 0 ? { errors } : {}),
    }, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id }, why: 'Verify the edited asset.' },
      { tool: 'get_asset_relations', args: { instance_name, asset_id }, why: 'Verify relation changes took effect.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
