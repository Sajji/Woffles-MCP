import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { getInstance } from '../config.js';
import { CollibraClient } from './collibra-client.js';

/**
 * Portable, customer-agnostic operating-model snapshot for a single
 * Collibra instance. Only schema-level constructs are stored; no asset
 * data or customer-specific identifiers are baked into tool logic.
 */
export interface OperatingModelSnapshot {
  instance: string;
  refreshedAt: string; // ISO timestamp
  snapshotHash: string;
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

function cacheDir(): string {
  const override = process.env.COLLIBRA_MCP_CACHE_DIR;
  const dir = override
    ? resolve(override)
    : join(homedir(), '.collibra-mcp');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function cachePath(instanceName: string): string {
  const safe = instanceName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(cacheDir(), `operating-model.${safe}.json`);
}

export function loadSnapshot(instanceName: string): OperatingModelSnapshot | null {
  const path = cachePath(instanceName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as OperatingModelSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: OperatingModelSnapshot): string {
  const path = cachePath(snapshot.instance);
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}

/**
 * Returns the cached snapshot if present, otherwise null. Callers that
 * require a snapshot should surface a `nextActions` entry pointing the
 * agent at `refresh_operating_model` rather than implicitly fetching.
 */
export function getSnapshot(instanceName: string): OperatingModelSnapshot | null {
  return loadSnapshot(instanceName);
}

async function paged<T>(
  client: CollibraClient,
  endpoint: string,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  // Cap to avoid runaway pulls on pathological models; 50k is more than
  // any realistic operating model.
  while (offset < 50_000) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${sep}offset=${offset}&limit=${PAGE}`;
    const resp = await client.restCall<{ results?: T[]; total?: number }>(url);
    const batch = resp.results || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return out;
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

  const assetTypes: ModelAssetType[] = assetTypesRaw.map((t: any) => ({
    id: t.id,
    name: t.name,
    publicId: t.publicId,
    description: t.description,
    parentId: t.parent?.id,
    parentName: t.parent?.name,
    finalType: t.finalType,
    system: t.system,
  }));

  const domainTypes: ModelDomainType[] = domainTypesRaw.map((t: any) => ({
    id: t.id,
    name: t.name,
    publicId: t.publicId,
    description: t.description,
  }));

  const attributeTypes: ModelAttributeType[] = attributeTypesRaw.map((t: any) => ({
    id: t.id,
    name: t.name,
    kind: t.resourceType || t.attributeTypeDiscriminator || 'AttributeType',
    description: t.description,
  }));

  const relationTypes: ModelRelationType[] = relationTypesRaw.map((t: any) => ({
    id: t.id,
    role: t.role,
    corole: t.coRole ?? t.corole ?? '',
    sourceTypeId: t.sourceType?.id ?? t.source?.id ?? t.head?.id,
    sourceTypeName: t.sourceType?.name ?? t.source?.name ?? t.head?.name,
    targetTypeId: t.targetType?.id ?? t.target?.id ?? t.tail?.id,
    targetTypeName: t.targetType?.name ?? t.target?.name ?? t.tail?.name,
    description: t.description,
  }));

  const statuses: ModelStatus[] = statusesRaw.map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

  const refreshedAt = new Date().toISOString();
  const hashInput = JSON.stringify({
    a: assetTypes.length,
    d: domainTypes.length,
    at: attributeTypes.length,
    r: relationTypes.length,
    s: statuses.length,
    ids: [
      ...assetTypes.map((x) => x.id),
      ...domainTypes.map((x) => x.id),
      ...attributeTypes.map((x) => x.id),
      ...relationTypes.map((x) => x.id),
      ...statuses.map((x) => x.id),
    ].sort(),
  });
  const snapshotHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  return {
    instance: instanceName,
    refreshedAt,
    snapshotHash,
    assetTypes,
    domainTypes,
    attributeTypes,
    relationTypes,
    statuses,
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
  const raw = await client
    .restCall<any>(`/rest/2.0/assignments/assetType/${assetTypeId}`)
    .catch(() => []);
  const assignments: any[] = Array.isArray(raw) ? raw : raw.results || [];

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
        // direction: outgoing if this asset type is the source side
        const direction: 'OUTGOING' | 'INCOMING' =
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
