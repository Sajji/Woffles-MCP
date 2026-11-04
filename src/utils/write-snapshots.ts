/**
 * Pre-write snapshots and undo for audited write tools.
 *
 * Undo covers what can be restored faithfully through Core REST:
 *   - asset core properties (name, displayName, status) and every attribute
 *     type's values, for tools that update existing assets; and
 *   - deletion of assets a create tool made.
 * Relations, tags, responsibilities and deletions are recorded for forensics
 * but are not reverted automatically.
 */
import type { CollibraClient } from './collibra-client.js';
import type { AssetSnapshot, AuditEntry } from './audit.js';

/** Max assets snapshotted per call; larger bulk writes are logged without full snapshots. */
export const MAX_SNAPSHOT_ASSETS = 500;
const SNAPSHOT_CONCURRENCY = 5;

/** Tools whose pre-write asset state is snapshotted, and how to find the asset IDs. */
const AFFECTED_ASSETS: Record<string, (args: any) => unknown[]> = {
  update_asset_description: (a) => [a.asset_id],
  update_asset_attribute: (a) => [a.asset_id],
  edit_asset: (a) => [a.asset_id],
  bulk_update_asset_descriptions: (a) => (a.updates ?? []).map((u: any) => u?.asset_id),
  bulk_update_asset_attributes: (a) => (a.updates ?? []).map((u: any) => u?.asset_id),
  bulk_delete_assets: (a) => a.asset_ids ?? [],
};

/** Tools that restore cleanly from a snapshot (bulk_delete_assets is forensic-only). */
const RESTORABLE = new Set([
  'update_asset_description',
  'update_asset_attribute',
  'edit_asset',
  'bulk_update_asset_descriptions',
  'bulk_update_asset_attributes',
]);

const CREATED_ASSETS: Record<string, (s: any) => unknown[]> = {
  create_asset: (s) => [s?.asset?.id],
  add_business_term: (s) => [s?.businessTerm?.id],
  bulk_create_assets: (s) => (s?.details ?? []).filter((d: any) => d?.action === 'CREATED').map((d: any) => d.assetId),
};

const uuids = (xs: unknown[]): string[] => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0))];

export function affectedAssetIds(tool: string, args: any): string[] {
  return uuids(AFFECTED_ASSETS[tool]?.(args ?? {}) ?? []);
}

export function createdAssetIds(tool: string, structured: unknown): string[] {
  return uuids(CREATED_ASSETS[tool]?.(structured) ?? []);
}

export function isUndoable(entry: AuditEntry): boolean {
  if (entry.kind !== 'write' || entry.mode !== 'apply' || entry.outcome !== 'success') return false;
  return (RESTORABLE.has(entry.tool) && !!entry.before?.length) || !!entry.createdAssetIds?.length;
}

/**
 * Whether a write call will actually change data. Tools with a `confirm`
 * flag only write when it is true; tools with `dry_run` only when it is not.
 */
export function isApplyCall(inputSchema: any, args: any): boolean {
  const props = inputSchema?.properties ?? {};
  if ('confirm' in props) return args?.confirm === true;
  if ('dry_run' in props) return args?.dry_run !== true;
  return true;
}

async function snapshotOne(client: CollibraClient, id: string): Promise<AssetSnapshot> {
  try {
    const asset: any = await client.restCall(`/rest/2.0/assets/${encodeURIComponent(id)}`);
    const attrs = await client.getAssetAttributes(id);
    return {
      id,
      name: asset.name,
      displayName: asset.displayName ?? null,
      statusId: asset.status?.id ?? null,
      typeId: asset.type?.id ?? null,
      domainId: asset.domain?.id ?? null,
      attributes: attrs.map((a) => ({ typeId: a.typeId, value: a.value })),
    };
  } catch (error) {
    return { id, name: '', displayName: null, statusId: null, typeId: null, domainId: null, attributes: [], error: (error as Error).message };
  }
}

export async function snapshotAssets(client: CollibraClient, ids: string[]): Promise<AssetSnapshot[]> {
  const out: AssetSnapshot[] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      out[i] = await snapshotOne(client, ids[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, ids.length) }, worker));
  return out;
}

// Multi-value list attributes come back as one attribute whose value is an array; flatten so
// restores send ["a","b"], not [["a","b"]].
const valuesByType = (attrs: { typeId: string; value: unknown }[]) => {
  const m = new Map<string, unknown[]>();
  for (const a of attrs) {
    const vals = Array.isArray(a.value) ? a.value : [a.value];
    m.set(a.typeId, [...(m.get(a.typeId) ?? []), ...vals]);
  }
  return m;
};
const sameValues = (a: unknown[] = [], b: unknown[] = []) =>
  JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

export interface RestoreAction {
  assetId: string;
  action: 'set_attribute_values' | 'change_properties' | 'delete_created_asset';
  typeId?: string;
  from?: unknown;
  to?: unknown;
}

/** Compute the actions that bring each asset back to its snapshot (diff against current state). */
export async function planRestore(client: CollibraClient, entry: AuditEntry): Promise<{ actions: RestoreAction[]; notes: string[] }> {
  const actions: RestoreAction[] = [];
  const notes: string[] = [];

  if (RESTORABLE.has(entry.tool)) {
    const current = await snapshotAssets(client, (entry.before ?? []).map((s) => s.id));
    for (const before of entry.before ?? []) {
      const now = current.find((c) => c.id === before.id)!;
      if (before.error) {
        notes.push(`Asset ${before.id}: no pre-write snapshot (${before.error}); skipped.`);
        continue;
      }
      if (now.error) {
        notes.push(`Asset ${before.id}: cannot read current state (${now.error}); skipped.`);
        continue;
      }
      const props: Record<string, unknown> = {};
      if (now.name !== before.name) props.name = before.name;
      if ((now.displayName ?? null) !== (before.displayName ?? null)) props.displayName = before.displayName;
      if (before.statusId && now.statusId !== before.statusId) props.statusId = before.statusId;
      if (Object.keys(props).length) {
        actions.push({ assetId: before.id, action: 'change_properties', from: { name: now.name, displayName: now.displayName, statusId: now.statusId }, to: props });
      }
      const b = valuesByType(before.attributes);
      const n = valuesByType(now.attributes);
      for (const typeId of new Set([...b.keys(), ...n.keys()])) {
        if (!sameValues(b.get(typeId), n.get(typeId))) {
          actions.push({ assetId: before.id, action: 'set_attribute_values', typeId, from: n.get(typeId) ?? [], to: b.get(typeId) ?? [] });
        }
      }
    }
    if (entry.tool === 'edit_asset') {
      notes.push('edit_asset relation, tag and responsibility operations are not reverted; only attributes and properties are.');
    }
  }

  for (const id of entry.createdAssetIds ?? []) {
    actions.push({ assetId: id, action: 'delete_created_asset' });
  }
  return { actions, notes };
}

export async function applyRestore(client: CollibraClient, actions: RestoreAction[]): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;
  const deletes = actions.filter((a) => a.action === 'delete_created_asset').map((a) => a.assetId);
  for (const a of actions) {
    try {
      if (a.action === 'change_properties') {
        await client.restCallWithBody(`/rest/2.0/assets/${a.assetId}`, 'PATCH', { id: a.assetId, ...(a.to as object) });
        applied++;
      } else if (a.action === 'set_attribute_values') {
        await client.restCallWithBody(`/rest/2.0/assets/${a.assetId}/attributes`, 'PUT', { typeId: a.typeId, values: a.to });
        applied++;
      }
    } catch (error) {
      errors.push(`${a.action} ${a.assetId}${a.typeId ? ` (${a.typeId})` : ''}: ${(error as Error).message}`);
    }
  }
  if (deletes.length) {
    try {
      await client.restCallWithBody('/rest/2.0/assets/bulk', 'DELETE', deletes);
      applied += deletes.length;
    } catch (error) {
      errors.push(`delete created assets: ${(error as Error).message}`);
    }
  }
  return { applied, errors };
}
