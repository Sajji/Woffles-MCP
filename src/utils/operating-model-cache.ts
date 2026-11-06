import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { getInstance } from '../config.js';
import { CollibraClient, isNotFound } from './collibra-client.js';

/**
 * Portable, customer-agnostic operating-model snapshot for a single
 * Collibra instance. Only schema-level constructs are stored; no asset
 * data or customer-specific identifiers are baked into tool logic.
 */
export interface OperatingModelSnapshot {
  instance: string;
  /** Base URL the snapshot was taken from; a snapshot for another server is ignored. */
  baseUrl?: string;
  refreshedAt: string; // ISO timestamp
  snapshotHash: string;
  /** Model writes applied through this server since the last full refresh (patched into the snapshot). */
  patchedSinceRefresh?: string[];
  assetTypes: ModelAssetType[];
  domainTypes: ModelDomainType[];
  attributeTypes: ModelAttributeType[];
  relationTypes: ModelRelationType[];
  statuses: ModelStatus[];
}

export interface ModelAssetType {
  id: string;
  name: string;
  publicId?: string;
  description?: string;
  parentId?: string;
  parentName?: string;
  finalType?: boolean;
  system?: boolean;
}

export interface ModelDomainType {
  id: string;
  name: string;
  publicId?: string;
  description?: string;
}

export interface ModelAttributeType {
  id: string;
  name: string;
  kind: string; // e.g. StringAttributeType, BooleanAttributeType, ...
  description?: string;
}

export interface ModelRelationType {
  id: string;
  role: string;     // source -> target label
  corole: string;   // target -> source label
  sourceTypeId: string;
  sourceTypeName: string;
  targetTypeId: string;
  targetTypeName: string;
  description?: string;
}

export interface ModelStatus {
  id: string;
  name: string;
  description?: string;
}

const PAGE = 1000;

/** Snapshots older than this are reported as stale (refresh_operating_model can override per call). */
export const DEFAULT_MAX_AGE_HOURS = 24;

function cacheDir(create: boolean): string {
  const override = process.env.COLLIBRA_MCP_CACHE_DIR;
  const dir = override ? resolve(override) : join(homedir(), '.collibra-mcp');
  if (create && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePath(instanceName: string, create = false): string {
  const safe = instanceName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(cacheDir(create), `operating-model.${safe}.json`);
}

/** Parsed snapshots keyed by file path, invalidated by the file's mtime. */
const memo = new Map<string, { mtimeMs: number; snapshot: OperatingModelSnapshot }>();

/**
 * The cached snapshot for an instance, or null when there is none — or when
 * it was taken from a different server (the instance's baseUrl changed).
 * Parsed once and memoized until the file changes.
 */
export function loadSnapshot(instanceName: string): OperatingModelSnapshot | null {
  const path = cachePath(instanceName);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  let snapshot = memo.get(path)?.mtimeMs === mtimeMs ? memo.get(path)!.snapshot : null;
  if (!snapshot) {
    try {
      snapshot = JSON.parse(readFileSync(path, 'utf-8')) as OperatingModelSnapshot;
    } catch {
      return null;
    }
    memo.set(path, { mtimeMs, snapshot });
  }
  try {
    const baseUrl = getInstance(instanceName).baseUrl;
    if (snapshot.baseUrl && snapshot.baseUrl !== baseUrl) return null;
  } catch {
    /* unknown instance: let the caller report it */
  }
  return snapshot;
}

/** Write atomically (temp file + rename) so a concurrent reader never sees a partial file. */
export function saveSnapshot(snapshot: OperatingModelSnapshot): string {
  const path = cachePath(snapshot.instance, true);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot), 'utf-8');
  renameSync(tmp, path);
  memo.set(path, { mtimeMs: statSync(path).mtimeMs, snapshot });
  return path;
}

/**
 * Freshness metadata for model-tool envelopes. Stale when older than
 * maxAgeHours or taken before the server recorded its baseUrl. (Writes made
 * through this server are patched in, so they don't make it stale; changes
 * made elsewhere in Collibra are only picked up by a refresh.)
 */
export function snapshotStatus(snapshot: OperatingModelSnapshot, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  const ageHours = (Date.now() - new Date(snapshot.refreshedAt).getTime()) / 3_600_000;
  const reasons: string[] = [];
  if (ageHours > maxAgeHours) reasons.push(`refreshed ${Math.round(ageHours)}h ago (> ${maxAgeHours}h)`);
  if (!snapshot.baseUrl) reasons.push('taken by an older server version (no baseUrl recorded)');
  return {
    model: { snapshotHash: snapshot.snapshotHash, refreshedAt: snapshot.refreshedAt, stale: reasons.length > 0 },
    warnings: reasons.length ? [`Cached operating model may be out of date: ${reasons.join('; ')}. Run refresh_operating_model.`] : [],
  };
}

// ── Mapping from REST shapes (shared by full refresh and incremental patches) ──
export const mapAssetType = (t: any): ModelAssetType => ({
  id: t.id,
  name: t.name,
  publicId: t.publicId,
  description: t.description,
  parentId: t.parent?.id,
  parentName: t.parent?.name,
  finalType: t.finalType,
  system: t.system,
});

const mapDomainType = (t: any): ModelDomainType => ({ id: t.id, name: t.name, publicId: t.publicId, description: t.description });

export const mapAttributeType = (t: any): ModelAttributeType => ({
  id: t.id,
  name: t.name,
  kind: t.resourceType || t.attributeTypeDiscriminator || 'AttributeType',
  description: t.description,
});

export const mapRelationType = (t: any): ModelRelationType => ({
  id: t.id,
  role: t.role,
  corole: t.coRole ?? t.corole ?? '',
  sourceTypeId: t.sourceType?.id ?? t.source?.id ?? t.head?.id,
  sourceTypeName: t.sourceType?.name ?? t.source?.name ?? t.head?.name,
  targetTypeId: t.targetType?.id ?? t.target?.id ?? t.tail?.id,
  targetTypeName: t.targetType?.name ?? t.target?.name ?? t.tail?.name,
  description: t.description,
});

const mapStatus = (s: any): ModelStatus => ({ id: s.id, name: s.name, description: s.description });

/** Hash over ids AND names/endpoints, so renames and re-parenting change it too. */
function computeHash(s: Pick<OperatingModelSnapshot, 'assetTypes' | 'domainTypes' | 'attributeTypes' | 'relationTypes' | 'statuses'>): string {
  const rows = [
    ...s.assetTypes.map((x) => `a|${x.id}|${x.name}|${x.parentId ?? ''}`),
    ...s.domainTypes.map((x) => `d|${x.id}|${x.name}`),
    ...s.attributeTypes.map((x) => `t|${x.id}|${x.name}|${x.kind}`),
    ...s.relationTypes.map((x) => `r|${x.id}|${x.role}|${x.corole}|${x.sourceTypeId}|${x.targetTypeId}`),
    ...s.statuses.map((x) => `s|${x.id}|${x.name}`),
  ].sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Apply a model write made through this server (create_asset_type,
 * create_attribute_type, create_relation_type) to the cached snapshot, if one
 * exists, so model tools see the new type immediately instead of reporting it
 * "not found" until the next refresh. No-op when nothing is cached.
 */
export function patchSnapshot(
  instanceName: string,
  change: { assetType?: any; attributeType?: any; relationType?: any },
): void {
  const snapshot = loadSnapshot(instanceName);
  if (!snapshot) return;
  const upsert = <T extends { id: string }>(list: T[], item: T) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
  };
  const next: OperatingModelSnapshot = {
    ...snapshot,
    assetTypes: [...snapshot.assetTypes],
    attributeTypes: [...snapshot.attributeTypes],
    relationTypes: [...snapshot.relationTypes],
    patchedSinceRefresh: [...(snapshot.patchedSinceRefresh ?? [])],
  };
  if (change.assetType) {
    upsert(next.assetTypes, mapAssetType(change.assetType));
    next.patchedSinceRefresh!.push(`assetType ${change.assetType.id}`);
  }
  if (change.attributeType) {
    upsert(next.attributeTypes, mapAttributeType(change.attributeType));
    next.patchedSinceRefresh!.push(`attributeType ${change.attributeType.id}`);
  }
  if (change.relationType) {
    upsert(next.relationTypes, mapRelationType(change.relationType));
    next.patchedSinceRefresh!.push(`relationType ${change.relationType.id}`);
  }
  next.snapshotHash = computeHash(next);
  saveSnapshot(next);
}

// ── Type hierarchy (supertypes) ──────────────────────────────────────────────
const ancestorMemo = new WeakMap<OperatingModelSnapshot, Map<string, string[]>>();

/** The type itself followed by its supertypes, nearest first (bounded against cycles). */
export function ancestorIds(snapshot: OperatingModelSnapshot, typeId: string): string[] {
  let cache = ancestorMemo.get(snapshot);
  if (!cache) {
    cache = new Map();
    ancestorMemo.set(snapshot, cache);
  }
  const hit = cache.get(typeId);
  if (hit) return hit;
  const byId = new Map(snapshot.assetTypes.map((t) => [t.id, t]));
  const chain: string[] = [];
  let cur: string | undefined = typeId;
  while (cur && !chain.includes(cur) && chain.length < 50) {
    chain.push(cur);
    cur = byId.get(cur)?.parentId;
  }
  cache.set(typeId, chain);
  return chain;
}

/** True when `typeId` is `ancestorId` or a (transitive) subtype of it. */
export function isSameOrSubtype(snapshot: OperatingModelSnapshot, typeId: string, ancestorId: string): boolean {
  return ancestorIds(snapshot, typeId).includes(ancestorId);
}

async function paged<T>(
  client: CollibraClient,
  endpoint: string,
): Promise<T[]> {
  // Split any embedded query string into params for restPaginate, which
  // handles offset looping and clamps page size to the REST maximum.
  const [path, qs] = endpoint.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs ?? ''));
  return client.restPaginate<T>(path, params, PAGE);
}

/**
 * Crawl the live instance and build a fresh operating-model snapshot.
 * Pure schema fetches against well-known REST endpoints — works against
 * any Collibra deployment without customer-specific assumptions.
 */
export async function fetchOperatingModel(instanceName: string): Promise<OperatingModelSnapshot> {
  const instance = getInstance(instanceName);
  const client = new CollibraClient(instance);

  const [assetTypesRaw, domainTypesRaw, attributeTypesRaw, relationTypesRaw, statusesRaw] = await Promise.all([
    paged<any>(client, '/rest/2.0/assetTypes?sortField=NAME&sortOrder=ASC'),
    paged<any>(client, '/rest/2.0/domainTypes?sortField=NAME&sortOrder=ASC'),
    paged<any>(client, '/rest/2.0/attributeTypes?sortField=NAME&sortOrder=ASC'),
    paged<any>(client, '/rest/2.0/relationTypes?sortField=ROLE&sortOrder=ASC'),
    paged<any>(client, '/rest/2.0/statuses?sortField=NAME&sortOrder=ASC'),
  ]);

  const model = {
    assetTypes: assetTypesRaw.map(mapAssetType),
    domainTypes: domainTypesRaw.map(mapDomainType),
    attributeTypes: attributeTypesRaw.map(mapAttributeType),
    relationTypes: relationTypesRaw.map(mapRelationType),
    statuses: statusesRaw.map(mapStatus),
  };
  return {
    instance: instanceName,
    baseUrl: instance.baseUrl,
    refreshedAt: new Date().toISOString(),
    snapshotHash: computeHash(model),
    ...model,
  };
}

/**
 * Per-asset-type assignment fetch: which characteristic types (attribute
 * + relation) are assignable to a given asset type, plus the statuses and
 * domain types that the operating model declares eligible. Not cached at
 * refresh time because the assignment surface is large; describe_asset_type
 * fetches on-demand.
 */
export interface AssetTypeAssignments {
  assetTypeId: string;
  attributeTypes: { id: string; name: string; kind: string; minimumOccurrences?: number; maximumOccurrences?: number }[];
  relationTypes: {
    id: string;
    role: string;
    corole: string;
    direction: 'OUTGOING' | 'INCOMING';
    otherTypeId: string;
    otherTypeName: string;
  }[];
  eligibleStatuses: { id: string; name: string }[];
  defaultStatusId?: string;
  eligibleDomainTypes: { id: string; name: string }[];
}

export async function fetchAssetTypeAssignments(
  instanceName: string,
  assetTypeId: string,
): Promise<AssetTypeAssignments> {
  const instance = getInstance(instanceName);
  const client = new CollibraClient(instance);

  // The endpoint returns a bare JSON array of Assignment objects. Each
  // assignment carries `characteristicTypes`, `statuses`, `domainTypes` and
  // `defaultStatusId`. There is typically one assignment per asset type but
  // we merge across all returned for safety.
  // Only "no such asset type" means no assignments; permission and server
  // errors must surface rather than look like an empty model.
  let raw: any = [];
  try {
    raw = await client.restCall<any>(`/rest/2.0/assignments/assetType/${encodeURIComponent(assetTypeId)}`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  const assignments: any[] = Array.isArray(raw) ? raw : raw.results || [];
  return parseAssignments(assignments, assetTypeId);
}

/**
 * Resolve the single assignment that governs a NEW asset of `assetTypeId`
 * created in `domainId`, mirroring Collibra's scoping rules:
 *   1. only assignments whose domain types include the domain's type;
 *   2. a scope naming the domain itself wins;
 *   3. else the scope naming the nearest community up the hierarchy;
 *   4. else the unscoped (global) assignment.
 * Merging every assignment instead would enforce requirements from scopes that
 * do not apply (e.g. a "Data Privacy" scope on an unrelated domain).
 * Returns null when no assignment can be determined.
 */
export async function fetchApplicableAssignment(
  instanceName: string,
  assetTypeId: string,
  domainId: string,
): Promise<AssetTypeAssignments | null> {
  const client = new CollibraClient(getInstance(instanceName));
  const [raw, domain] = await Promise.all([
    client.restCall<any>(`/rest/2.0/assignments/assetType/${encodeURIComponent(assetTypeId)}`),
    client.restCall<any>(`/rest/2.0/domains/${encodeURIComponent(domainId)}`),
  ]);
  const all: any[] = Array.isArray(raw) ? raw : raw.results || [];
  const domainTypeId = domain.type?.id;
  const candidates = all.filter(
    (a) => !a.domainTypes?.length || !domainTypeId || a.domainTypes.some((d: any) => d.id === domainTypeId),
  );
  if (!candidates.length) return null;

  const inScope = (a: any, key: 'domains' | 'communities', id: string) =>
    (a.scope?.[key] || []).some((r: any) => r.id === id);

  let chosen = candidates.find((a) => inScope(a, 'domains', domainId));
  if (!chosen) {
    // Walk up the community hierarchy (bounded) looking for the nearest scoped match.
    let communityId: string | undefined = domain.community?.id;
    for (let depth = 0; communityId && depth < 20 && !chosen; depth++) {
      const cid: string = communityId;
      chosen = candidates.find((a) => inScope(a, 'communities', cid));
      if (!chosen) {
        const community = await client.restCall<any>(`/rest/2.0/communities/${encodeURIComponent(cid)}`).catch(() => null);
        communityId = community?.parent?.id;
      }
    }
  }
  chosen ??= candidates.find((a) => !a.scope);
  return chosen ? parseAssignments([chosen], assetTypeId) : null;
}

function parseAssignments(assignments: any[], assetTypeId: string): AssetTypeAssignments {
  const attributeTypes: AssetTypeAssignments['attributeTypes'] = [];
  const relationTypes: AssetTypeAssignments['relationTypes'] = [];
  const statusMap = new Map<string, { id: string; name: string }>();
  const domainTypeMap = new Map<string, { id: string; name: string }>();
  let defaultStatusId: string | undefined;

  for (const a of assignments) {
    if (a.defaultStatusId && !defaultStatusId) defaultStatusId = a.defaultStatusId;
    for (const s of a.statuses || []) {
      if (s.id) statusMap.set(s.id, { id: s.id, name: s.name });
    }
    for (const d of a.domainTypes || []) {
      if (d.id) domainTypeMap.set(d.id, { id: d.id, name: d.name });
    }

    for (const c of a.characteristicTypes || []) {
      const at = c.attributeType;
      const rt = c.relationType;
      const crt = c.complexRelationType;
      const drt = c.derivedRelationType;
      if (at) {
        attributeTypes.push({
          id: at.id,
          name: at.name,
          kind: at.resourceType || at.attributeTypeDiscriminator || 'AttributeType',
          minimumOccurrences: c.minimumOccurrences,
          maximumOccurrences: c.maximumOccurrences,
        });
      } else if (rt || drt) {
        const r = rt || drt;
        // roleDirection says which end THIS asset type plays: TO_TARGET = it is
        // the source (outgoing), TO_SOURCE = it is the target (incoming). Most
        // relation types are declared on a supertype (e.g. Data Element), so
        // comparing the declared source id with this type mislabels them.
        const direction: 'OUTGOING' | 'INCOMING' =
          c.roleDirection === 'TO_TARGET' ? 'OUTGOING' :
          c.roleDirection === 'TO_SOURCE' ? 'INCOMING' :
          r.sourceType?.id === assetTypeId ? 'OUTGOING' : 'INCOMING';
        const other = direction === 'OUTGOING' ? r.targetType : r.sourceType;
        relationTypes.push({
          id: r.id,
          role: r.role || '',
          corole: r.coRole || r.corole || '',
          direction,
          otherTypeId: other?.id || '',
          otherTypeName: other?.name || '',
        });
      } else if (crt) {
        relationTypes.push({
          id: crt.id,
          role: crt.name || crt.role || '(complex)',
          corole: '',
          direction: 'OUTGOING',
          otherTypeId: '',
          otherTypeName: '(complex relation)',
        });
      }
    }
  }

  return {
    assetTypeId,
    attributeTypes,
    relationTypes,
    eligibleStatuses: Array.from(statusMap.values()),
    defaultStatusId,
    eligibleDomainTypes: Array.from(domainTypeMap.values()),
  };
}
