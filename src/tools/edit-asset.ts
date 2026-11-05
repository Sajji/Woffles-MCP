import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient, isNotFound } from '../utils/collibra-client.js';
import { findRelation } from '../utils/relations.js';
import { pickExact } from '../utils/resolve.js';
import { isUuid } from '../utils/validation.js';
import {
  coerceAttributeValues,
  getAttributeTypeInfo,
  planAttributeSet,
  type AttributeSetPlan,
  type AttributeTypeInfo,
} from '../utils/attributes.js';

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
  /** Existing attribute IDs matching the op (for remove_attribute). */
  existingAttributeIds?: string[];
  /** Planned attribute writes (for update_attribute / add_attribute). */
  attrPlan?: AttributeSetPlan;
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


type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Resolve a resource role by UUID or by exact (case-insensitive) name.
 * Never guesses: a partial-name hit or several exact hits is an error.
 */
async function resolveRoleId(
  client: CollibraClient,
  role: string,
): Promise<Resolved<{ id: string; name: string }>> {
  if (isUuid(role.trim())) {
    try {
      const r = await client.restCall<any>(`/rest/2.0/roles/${encodeURIComponent(role.trim())}`);
      return { ok: true, value: { id: r.id, name: r.name } };
    } catch (err) {
      if (isNotFound(err)) return { ok: false, error: `Role with UUID "${role}" not found.` };
      throw err;
    }
  }
  const params = new URLSearchParams({ name: role, limit: '100' });
  const resp = await client.restCall<any>(`/rest/2.0/roles?${params.toString()}`);
  const pick = pickExact<any>(resp.results || [], role, (x) => [x.name], (x) => x.name, 'role');
  return pick.ok ? { ok: true, value: { id: pick.match.id, name: pick.match.name } } : { ok: false, error: pick.message };
}

/**
 * Resolve an owner (user or group) by UUID, or by exact username / email /
 * group name. Users are tried before groups. Never guesses on partial matches.
 */
async function resolveOwnerId(
  client: CollibraClient,
  owner: string,
): Promise<Resolved<{ id: string; type: 'User' | 'UserGroup'; label: string }>> {
  if (isUuid(owner.trim())) {
    const id = encodeURIComponent(owner.trim());
    try {
      const u = await client.restCall<any>(`/rest/2.0/users/${id}`);
      return { ok: true, value: { id: u.id, type: 'User', label: u.userName } };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    try {
      const g = await client.restCall<any>(`/rest/2.0/userGroups/${id}`);
      return { ok: true, value: { id: g.id, type: 'UserGroup', label: g.name } };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    return { ok: false, error: `No user or user group with UUID "${owner}".` };
  }

  const userResp = await client.restCall<any>(
    `/rest/2.0/users?${new URLSearchParams({ name: owner, limit: '25' }).toString()}`,
  );
  const users = pickExact<any>(
    userResp.results || [],
    owner,
    (x) => [x.userName, x.emailAddress],
    (x) => `${x.userName}${x.emailAddress ? ` <${x.emailAddress}>` : ''}`,
    'user',
  );
  if (users.ok) return { ok: true, value: { id: users.match.id, type: 'User', label: users.match.userName } };
  if (users.reason === 'ambiguous') return { ok: false, error: users.message };

  const groupResp = await client.restCall<any>(
    `/rest/2.0/userGroups?${new URLSearchParams({ name: owner, limit: '25' }).toString()}`,
  );
  const groups = pickExact<any>(groupResp.results || [], owner, (x) => [x.name], (x) => x.name, 'user group');
  if (groups.ok) return { ok: true, value: { id: groups.match.id, type: 'UserGroup', label: groups.match.name } };
  if (groups.reason === 'ambiguous') return { ok: false, error: groups.message };

  const similar = [...users.candidates, ...groups.candidates].slice(0, 10);
  return {
    ok: false,
    error:
      `No user (username/email) or user group named exactly "${owner}".` +
      (similar.length ? ` Similar: ${similar.join(', ')}. Use the exact name or the UUID.` : ''),
  };
}

export async function executeEditAsset(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, operations, confirm = false } = args;

  if (!Array.isArray(operations) || operations.length === 0) {
    return ok({ error: 'operations must be a non-empty array.' });
  }
  if (!isUuid(asset_id)) {
    return ok({ error: true, message: `asset_id must be a UUID (got "${asset_id}").`, instance: instance_name });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);
    const assetPath = `/rest/2.0/assets/${encodeURIComponent(asset_id)}`;

    // Fetch the asset once
    const asset = await client.restCall<any>(assetPath);

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
            if (raw.op === 'remove_attribute') {
              const existing = await client.restPaginate<any>('/rest/2.0/attributes', {
                assetId: asset_id,
                typeIds: raw.attribute_type_id,
              });
              return { op: raw.op, raw, current: existing.map((a) => a.value), proposed: null, existingAttributeIds: existing.map((a) => a.id) };
            }
            let typeInfo: AttributeTypeInfo;
            try {
              typeInfo = await getAttributeTypeInfo(client, raw.attribute_type_id);
            } catch (err) {
              return { op: raw.op, raw, error: (err as Error).message };
            }
            try {
              if (raw.op === 'add_attribute') {
                const existing = await client.restPaginate<any>('/rest/2.0/attributes', {
                  assetId: asset_id,
                  typeIds: raw.attribute_type_id,
                });
                const values = coerceAttributeValues(typeInfo, raw.value);
                return {
                  op: raw.op,
                  raw,
                  current: existing.map((a) => a.value),
                  proposed: values,
                  attrPlan: {
                    assetId: asset_id, typeId: typeInfo.id, current: existing.map((a) => a.value), proposed: values,
                    patch: [], post: values.map((value) => ({ assetId: asset_id, typeId: typeInfo.id, value })), delete: [],
                    action: 'ADD (POST)',
                  },
                };
              }
              // update_attribute → set the attribute to exactly this value (coerced by
              // kind; surplus values of a multi-value attribute are deleted).
              const plan = await planAttributeSet(client, asset_id, typeInfo, raw.value);
              return {
                op: raw.op,
                raw,
                current: plan.current.length === 0 ? '(not set)' : plan.current.length === 1 ? plan.current[0] : plan.current,
                proposed: plan.proposed.length === 1 ? plan.proposed[0] : plan.proposed,
                attrPlan: plan,
                notes: plan.action,
              };
            } catch (err) {
              return { op: raw.op, raw, error: (err as Error).message };
            }
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
            if (!isUuid(raw.target_asset_id) || !isUuid(raw.relation_type_id)) {
              return { op: raw.op, raw, error: 'target_asset_id and relation_type_id must be UUIDs.' };
            }
            const match = await findRelation(client, {
              sourceId: asset_id,
              targetId: raw.target_asset_id,
              relationTypeId: raw.relation_type_id,
            });
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
            const resp = await client.restCall<any>(`${assetPath}/tags`);
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
            const roleLookup = await resolveRoleId(client, raw.role);
            if (!roleLookup.ok) return { op: raw.op, raw, error: roleLookup.error };
            const ownerLookup = await resolveOwnerId(client, raw.owner);
            if (!ownerLookup.ok) return { op: raw.op, raw, error: ownerLookup.error };
            const roleRes = roleLookup.value;
            const ownerRes = ownerLookup.value;
            const results = await client.restPaginate<any>('/rest/2.0/responsibilities', {
              resourceIds: asset_id,
              roleIds: roleRes.id,
              ownerIds: ownerRes.id,
              includeInherited: 'false',
            });
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
        await client.restCallWithBody<any>(assetPath, 'PATCH', body);
        propOps.forEach((r) => applied.push({ op: r.op, property: r.raw.property, newValue: r.raw.value, status: 'APPLIED' }));
      } catch (err) {
        propOps.forEach((r) => errors.push({ op: r.op, input: r.raw, error: (err as Error).message }));
      }
    }

    // 2. Attribute removals → one DELETE per attribute id (Collibra has no /attributes/bulk DELETE).
    //    Includes surplus values that update_attribute removes from multi-value attributes.
    const removeAttrOps = resolved.filter((r) => r.op === 'remove_attribute' && !r.error);
    const surplusOps = resolved
      .filter((r) => r.op === 'update_attribute' && !r.error && (r.attrPlan?.delete.length ?? 0) > 0)
      .map((r) => ({ ...r, existingAttributeIds: r.attrPlan!.delete }));
    for (const r of [...removeAttrOps, ...surplusOps]) {
      for (const aid of r.existingAttributeIds || []) {
        try {
          await client.restCallWithBody<void>(`/rest/2.0/attributes/${encodeURIComponent(aid)}`, 'DELETE', undefined as any);
          applied.push({ op: r.op, attribute_type_id: r.raw.attribute_type_id, attributeId: aid, status: 'DELETED' });
        } catch (err) {
          errors.push({ op: r.op, input: r.raw, attributeId: aid, error: (err as Error).message });
        }
      }
    }

    // 3. Attribute updates/adds → batch into /attributes/bulk PATCH + POST.
    //    Values were already coerced by kind (incl. Markdown → HTML for RICH_TEXT) in the plan.
    const attrPlans = resolved
      .filter((r) => (r.op === 'update_attribute' || r.op === 'add_attribute') && !r.error && r.attrPlan)
      .map((r) => r.attrPlan!);
    const patchBody = attrPlans.flatMap((p) => p.patch);
    const postBody = attrPlans.flatMap((p) => p.post);

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
        // Body is AddAssetTagsRequest: { tagNames: string[] } (a bare array is rejected).
        await client.restCallWithBody<any>(`${assetPath}/tags`, 'POST', { tagNames });
        tagOps.forEach((r) => applied.push({ op: 'add_tag', tag: r.raw.tag, status: 'ADDED' }));
      } catch (err) {
        tagOps.forEach((r) => errors.push({ op: 'add_tag', input: r.raw, error: (err as Error).message }));
      }
    }

    // 6. Responsibilities → POST /responsibilities (assign) and DELETE /responsibilities/{id} (unassign)
    const addRespOps = resolved.filter((r) => r.op === 'set_responsibility' && !r.error && !r.existingResponsibilityId);
    for (const r of addRespOps) {
      try {
        // resourceType is required alongside resourceId (400 "Value not allowed" otherwise).
        await client.restCallWithBody<any>('/rest/2.0/responsibilities', 'POST', {
          roleId: r.roleId,
          ownerId: r.ownerId,
          resourceId: asset_id,
          resourceType: 'Asset',
        });
        applied.push({ op: 'set_responsibility', role: r.raw.role, owner: r.raw.owner, ownerType: r.ownerType, status: 'ASSIGNED' });
      } catch (err) {
        errors.push({ op: 'set_responsibility', input: r.raw, error: (err as Error).message });
      }
    }
    const removeRespOps = resolved.filter((r) => r.op === 'remove_responsibility' && !r.error && r.existingResponsibilityId);
    for (const r of removeRespOps) {
      try {
        await client.restCallWithBody<void>(`/rest/2.0/responsibilities/${encodeURIComponent(r.existingResponsibilityId!)}`, 'DELETE', undefined as any);
        applied.push({ op: 'remove_responsibility', role: r.raw.role, owner: r.raw.owner, status: 'UNASSIGNED' });
      } catch (err) {
        errors.push({ op: 'remove_responsibility', input: r.raw, error: (err as Error).message });
      }
    }

    return okWithNext({
      mode: 'APPLIED',
      // partial: some ops applied, some failed — report, don't flag the whole call as an error.
      ...(errors.length > 0 && applied.length > 0 ? { status: 'partial' } : {}),
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
