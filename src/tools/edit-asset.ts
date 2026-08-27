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
 *   - { op: 'add_tag',          tag }                          // append a free-text tag (idempotent)
 *   - { op: 'set_responsibility',    role, owner }            // assign a user/group to a resource role (idempotent)
 *   - { op: 'remove_responsibility', role, owner }            // unassign a directly-assigned responsibility
 *
 * Attribute ops are batched into a single /attributes/bulk PATCH + POST.
 * Relation ops are batched into a single /relations/bulk POST + DELETE.
 * Property changes are a single PATCH /assets/{id}.
 * Tags are appended via POST /assets/{id}/tags. Responsibilities resolve role
 * and owner (by name/email/UUID) and go through /responsibilities.
 */
export const editAssetTool = {
  name: 'edit_asset',
  description:
    'Apply a list of typed edits to a single Collibra asset in one tool call. ' +
    'Supported ops: update_attribute, add_attribute, remove_attribute, update_property, add_relation, remove_relation, ' +
    'add_tag, set_responsibility, remove_responsibility. ' +
    'Internally batches attribute changes via /attributes/bulk and relation changes via /relations/bulk — ' +
    'one tool call replaces what would otherwise be many singleton calls (update_asset_attribute, create_relation, …). ' +
    'add_tag appends a free-text tag without replacing existing ones. set_responsibility/remove_responsibility assign or ' +
    'unassign a user or group to a resource role (e.g. Steward, Owner) by username, email, or UUID; remove only affects ' +
    'directly-assigned responsibilities, not inherited ones. ' +
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
              enum: ['update_attribute', 'add_attribute', 'remove_attribute', 'update_property', 'add_relation', 'remove_relation', 'add_tag', 'set_responsibility', 'remove_responsibility'],
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
            tag: { type: 'string', description: 'For add_tag: the free-text tag name to append.' },
            role: { type: 'string', description: 'For *_responsibility ops: resource role name (e.g. Steward, Owner) or its UUID.' },
            owner: { type: 'string', description: 'For *_responsibility ops: the user (username or email) or user group to assign, or its UUID.' },
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
    description: 'Structured result payload. Shape differs between PREVIEW (operations) and APPLIED (appliedActions).',
    properties: {
      mode: { type: 'string', description: 'PREVIEW — no changes made | APPLIED.' },
      asset: { type: 'object', description: 'The edited asset (id, name, url).', additionalProperties: true },
      operationCount: { type: 'number', description: 'Preview: number of resolved operations.' },
      operations: { type: 'array', description: 'Preview: resolved operations with current vs. proposed values.', items: { type: 'object', additionalProperties: true } },
      requestedOps: { type: 'number', description: 'Applied: number of operations requested.' },
      appliedActions: { type: 'array', description: 'Applied: actions that were carried out.', items: { type: 'object', additionalProperties: true } },
      errors: { type: 'array', description: 'Per-operation errors, if any.', items: { type: 'object', additionalProperties: true } },
      instructions: { type: 'string' },
      error: { type: 'boolean' },
      message: { type: 'string' },
    },
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
  /** For add_tag: whether the tag is already present (so apply is a no-op). */
  tagAlreadyPresent?: boolean;
  /** For *_responsibility ops: resolved role UUID. */
  roleId?: string;
  /** For *_responsibility ops: resolved owner (user/group) UUID. */
  ownerId?: string;
  /** For *_responsibility ops: whether the owner resolved to a User or UserGroup. */
  ownerType?: 'User' | 'UserGroup';
  /** For *_responsibility ops: existing directly-assigned responsibility ID. */
  existingResponsibilityId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

/**
 * Resolve a resource role by UUID or by (case-insensitive) name. Returns the
 * role's id and canonical name, or null when no role matches.
 */
async function resolveRoleId(
  client: CollibraClient,
  role: string,
): Promise<{ id: string; name: string } | null> {
  if (isUuid(role)) {
    try {
      const r = await client.restCall<any>(`/rest/2.0/roles/${role}`);
      return { id: r.id, name: r.name };
    } catch {
      return { id: role, name: role };
    }
  }
  const resp = await client
    .restCall<any>(`/rest/2.0/roles?name=${encodeURIComponent(role)}&limit=100`)
    .catch(() => ({ results: [] }));
  const results: any[] = resp.results || [];
  const exact = results.find((x) => x.name?.toLowerCase() === role.toLowerCase());
  const pick = exact || results[0];
  return pick ? { id: pick.id, name: pick.name } : null;
}

/**
 * Resolve an owner (user or group) by UUID, username, email, or group name.
 * Users are tried before groups. Returns the owner id, its type, and a label.
 */
async function resolveOwnerId(
  client: CollibraClient,
  owner: string,
): Promise<{ id: string; type: 'User' | 'UserGroup'; label: string } | null> {
  if (isUuid(owner)) {
    try {
      const u = await client.restCall<any>(`/rest/2.0/users/${owner}`);
      return { id: u.id, type: 'User', label: u.userName };
    } catch { /* fall through to group */ }
    try {
      const g = await client.restCall<any>(`/rest/2.0/userGroups/${owner}`);
      return { id: g.id, type: 'UserGroup', label: g.name };
    } catch { /* fall through */ }
    return { id: owner, type: 'User', label: owner };
  }
  // Try user by name/email
  try {
    const u = await client.restCall<any>(`/rest/2.0/users?name=${encodeURIComponent(owner)}&limit=10`);
    const results: any[] = u.results || [];
    const match =
      results.find(
        (x) =>
          x.userName?.toLowerCase() === owner.toLowerCase() ||
          x.emailAddress?.toLowerCase() === owner.toLowerCase(),
      ) || results[0];
    if (match) return { id: match.id, type: 'User', label: match.userName };
  } catch { /* fall through to group */ }
  // Try group by name
  try {
    const g = await client.restCall<any>(`/rest/2.0/userGroups?name=${encodeURIComponent(owner)}&limit=10`);
    const results: any[] = g.results || [];
    const match = results.find((x) => x.name?.toLowerCase() === owner.toLowerCase()) || results[0];
    if (match) return { id: match.id, type: 'UserGroup', label: match.name };
  } catch { /* fall through */ }
  return null;
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
          case 'add_tag': {
            if (!raw.tag) {
              return { op: raw.op, raw, error: 'tag is required.' };
            }
            const resp = await client
              .restCall<any>(`/rest/2.0/assets/${asset_id}/tags`)
              .catch(() => []);
            const existing: string[] = (Array.isArray(resp) ? resp : resp.results || []).map(
              (t: any) => (typeof t === 'string' ? t : t.name),
            );
            const already = existing.some((t) => String(t).toLowerCase() === String(raw.tag).toLowerCase());
            return {
              op: raw.op,
              raw,
              current: existing,
              proposed: raw.tag,
              tagAlreadyPresent: already,
              notes: already ? 'SKIP (already tagged)' : 'ADD',
            };
          }
          case 'set_responsibility':
          case 'remove_responsibility': {
            if (!raw.role || !raw.owner) {
              return { op: raw.op, raw, error: 'role and owner are required.' };
            }
            const roleRes = await resolveRoleId(client, raw.role);
            if (!roleRes) {
              return { op: raw.op, raw, error: `Role "${raw.role}" not found.` };
            }
            const ownerRes = await resolveOwnerId(client, raw.owner);
            if (!ownerRes) {
              return { op: raw.op, raw, error: `Owner "${raw.owner}" not found.` };
            }
            const resp = await client
              .restCall<any>(`/rest/2.0/responsibilities?resourceIds=${asset_id}&includeInherited=false&limit=1000`)
              .catch(() => ({ results: [] }));
            const results: any[] = resp.results || [];
            const match = results.find(
              (r) => r.role?.id === roleRes.id && r.owner?.id === ownerRes.id && r.baseResource?.id === asset_id,
            );
            return {
              op: raw.op,
              raw,
              roleId: roleRes.id,
              ownerId: ownerRes.id,
              ownerType: ownerRes.type,
              existingResponsibilityId: match?.id,
              current: match ? 'present' : 'absent',
              proposed: raw.op === 'set_responsibility' ? 'present' : 'absent',
              notes:
                raw.op === 'set_responsibility'
                  ? match ? 'SKIP (already assigned)' : `ASSIGN ${roleRes.name} → ${ownerRes.label}`
                  : match ? `UNASSIGN ${roleRes.name} ← ${ownerRes.label}` : 'SKIP (not directly assigned)',
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

    // Markdown → HTML for values targeting RICH_TEXT attribute types
    const richTextValues = new Map<any, string>();
    for (const r of [...updateOps, ...addOps]) {
      const { entries } = await client.convertRichTextEntries([
        { typeId: r.raw.attribute_type_id, value: r.raw.value },
      ]);
      richTextValues.set(r, entries[0].value);
    }

    const patchBody: { id: string; value: string }[] = [];
    const postBody: { assetId: string; typeId: string; value: string }[] = [];

    for (const r of updateOps) {
      const value = richTextValues.get(r) ?? r.raw.value;
      const existingId = r.existingAttributeIds?.[0];
      if (existingId) patchBody.push({ id: existingId, value });
      else postBody.push({ assetId: asset_id, typeId: r.raw.attribute_type_id, value });
    }
    for (const r of addOps) {
      const value = richTextValues.get(r) ?? r.raw.value;
      postBody.push({ assetId: asset_id, typeId: r.raw.attribute_type_id, value });
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

    // 5. Tags → POST /rest/2.0/assets/{id}/tags (append new tags only)
    const tagOps = resolved.filter((r) => r.op === 'add_tag' && !r.error && !r.tagAlreadyPresent);
    if (tagOps.length > 0) {
      const tagNames = tagOps.map((r) => r.raw.tag);
      try {
        await client.restCallWithBody<any>(`/rest/2.0/assets/${asset_id}/tags`, 'POST', tagNames);
        tagOps.forEach((r) => applied.push({ op: 'add_tag', tag: r.raw.tag, status: 'ADDED' }));
      } catch (err) {
        tagOps.forEach((r) => errors.push({ op: 'add_tag', input: r.raw, error: (err as Error).message }));
      }
    }

    // 6. Responsibilities → POST /responsibilities (assign) and DELETE /responsibilities/{id} (unassign)
    const addRespOps = resolved.filter((r) => r.op === 'set_responsibility' && !r.error && !r.existingResponsibilityId);
    for (const r of addRespOps) {
      try {
        await client.restCallWithBody<any>('/rest/2.0/responsibilities', 'POST', {
          roleId: r.roleId,
          ownerId: r.ownerId,
          resourceId: asset_id,
        });
        applied.push({ op: 'set_responsibility', role: r.raw.role, owner: r.raw.owner, ownerType: r.ownerType, status: 'ASSIGNED' });
      } catch (err) {
        errors.push({ op: 'set_responsibility', input: r.raw, error: (err as Error).message });
      }
    }
    const removeRespOps = resolved.filter((r) => r.op === 'remove_responsibility' && !r.error && r.existingResponsibilityId);
    for (const r of removeRespOps) {
      try {
        await client.restCallWithBody<void>(`/rest/2.0/responsibilities/${r.existingResponsibilityId}`, 'DELETE', undefined as any);
        applied.push({ op: 'remove_responsibility', role: r.raw.role, owner: r.raw.owner, status: 'UNASSIGNED' });
      } catch (err) {
        errors.push({ op: 'remove_responsibility', input: r.raw, error: (err as Error).message });
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
