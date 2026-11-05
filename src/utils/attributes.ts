import { attrKindFromDiscriminator, type CollibraClient } from './collibra-client.js';
import { toRichTextValue } from './markdown.js';

/**
 * Shared "set an asset attribute to exactly these values" logic used by
 * update_asset_attribute, bulk_update_asset_attributes and edit_asset.
 *
 * Core REST stores one record per value (multi-value lists are several
 * records) and expects typed values: epoch-ms numbers for DATE, JSON numbers
 * for NUMERIC, JSON booleans for BOOLEAN. Callers pass strings, so they are
 * coerced here according to the attribute type's kind.
 */

export interface AttributeTypeInfo {
  id: string;
  name: string;
  /** STRING, NUMERIC, DATE, BOOLEAN, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, SCRIPT, or null if unknown. */
  kind: string | null;
  isRichText: boolean;
}

/** Look up an attribute type's name/kind (cached per client). Throws if it does not exist. */
export async function getAttributeTypeInfo(client: CollibraClient, typeId: string): Promise<AttributeTypeInfo> {
  const t = await client.getAttributeType(typeId);
  if (!t?.id) throw new Error(`Attribute type "${typeId}" not found.`);
  return {
    id: t.id,
    name: t.name ?? 'Unknown',
    kind: attrKindFromDiscriminator(t.attributeTypeDiscriminator ?? t.resourceDiscriminator ?? t.resourceType),
    isRichText: t.stringType === 'RICH_TEXT',
  };
}

/**
 * Convert a caller-supplied string into the typed value(s) Collibra stores.
 * MULTI_VALUE_LIST splits on commas into several values. Throws on input that
 * cannot be represented (e.g. a non-numeric NUMERIC value) so a bad value is
 * reported instead of being written.
 */
export function coerceAttributeValues(type: AttributeTypeInfo, raw: unknown): Array<string | number | boolean> {
  if (raw === null || raw === undefined) throw new Error(`A value is required for attribute "${type.name}".`);
  if (Array.isArray(raw)) return raw.flatMap((v) => coerceAttributeValues(type, v));
  const text = String(raw);
  switch (type.kind) {
    case 'MULTI_VALUE_LIST':
      return text.split(',').map((v) => v.trim()).filter(Boolean);
    case 'NUMERIC': {
      const n = Number(text.trim());
      if (text.trim() === '' || !Number.isFinite(n)) {
        throw new Error(`"${text}" is not a valid number for NUMERIC attribute "${type.name}".`);
      }
      return [n];
    }
    case 'BOOLEAN': {
      const v = text.trim().toLowerCase();
      if (v !== 'true' && v !== 'false') {
        throw new Error(`"${text}" is not valid for BOOLEAN attribute "${type.name}" — use "true" or "false".`);
      }
      return [v === 'true'];
    }
    case 'DATE': {
      const t = text.trim();
      const ms = /^-?\d+$/.test(t) ? Number(t) : Date.parse(t);
      if (!Number.isFinite(ms)) {
        throw new Error(`"${text}" is not a valid date for DATE attribute "${type.name}" — use epoch millis or an ISO date.`);
      }
      return [ms];
    }
    default:
      return [type.isRichText ? toRichTextValue(text, true).value : text];
  }
}

export interface AttributeSetPlan {
  assetId: string;
  typeId: string;
  current: unknown[];
  proposed: Array<string | number | boolean>;
  patch: { id: string; value: string | number | boolean }[];
  post: { assetId: string; typeId: string; value: string | number | boolean }[];
  /** Existing attribute ids to delete (surplus values of a multi-value attribute). */
  delete: string[];
  action: 'ADD (POST)' | 'UPDATE (PATCH)' | 'REPLACE (PATCH/POST/DELETE)' | 'NO CHANGE';
}

/**
 * Plan the writes that make `assetId`'s `typeId` attribute hold exactly the
 * coerced values: existing records are PATCHed in order, extra new values are
 * POSTed, and surplus existing records are DELETEd.
 */
export async function planAttributeSet(
  client: CollibraClient,
  assetId: string,
  type: AttributeTypeInfo,
  rawValue: unknown,
): Promise<AttributeSetPlan> {
  const proposed = coerceAttributeValues(type, rawValue);
  const existing = await client.restPaginate<any>('/rest/2.0/attributes', { assetId, typeIds: type.id });
  const plan: AttributeSetPlan = {
    assetId,
    typeId: type.id,
    current: existing.map((a) => a.value),
    proposed,
    patch: [],
    post: [],
    delete: [],
    action: 'NO CHANGE',
  };
  proposed.forEach((value, i) => {
    const rec = existing[i];
    if (!rec) plan.post.push({ assetId, typeId: type.id, value });
    else if (rec.value !== value) plan.patch.push({ id: rec.id, value });
  });
  plan.delete = existing.slice(proposed.length).map((a) => a.id);

  if (existing.length === 0) plan.action = 'ADD (POST)';
  else if (plan.delete.length || (plan.post.length && existing.length)) plan.action = 'REPLACE (PATCH/POST/DELETE)';
  else if (plan.patch.length) plan.action = 'UPDATE (PATCH)';
  return plan;
}

/** Apply one or more plans with the bulk endpoints (one PATCH, one POST, per-id DELETEs). */
export async function applyAttributeSetPlans(
  client: CollibraClient,
  plans: AttributeSetPlan[],
): Promise<{ patched: any[]; posted: any[]; deleted: string[] }> {
  const patchBody = plans.flatMap((p) => p.patch);
  const postBody = plans.flatMap((p) => p.post);
  const deleteIds = plans.flatMap((p) => p.delete);
  const patched = patchBody.length
    ? ((await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'PATCH', patchBody)) ?? [])
    : [];
  const posted = postBody.length
    ? ((await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', postBody)) ?? [])
    : [];
  for (const id of deleteIds) {
    await client.restCallWithBody<void>(`/rest/2.0/attributes/${encodeURIComponent(id)}`, 'DELETE', undefined);
  }
  return { patched: Array.isArray(patched) ? patched : [], posted: Array.isArray(posted) ? posted : [], deleted: deleteIds };
}
