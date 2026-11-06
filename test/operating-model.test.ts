/**
 * Phase 6: operating-model cache — baseUrl scoping, atomic save + memo,
 * staleness, incremental patching after model writes, supertype-aware
 * validation/traversal, and assignment relation direction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ASSET = id(1), DATA_ASSET = id(2), COLUMN = id(3), TERM = id(4), BUSINESS_ASSET = id(5), NEW_TYPE = id(6);
const REPRESENTS = id(100);

let server: Server;
let dir: string;
let baseUrl: string;
let registry: typeof import('../src/tools/index.js');
let cache: typeof import('../src/utils/operating-model-cache.js');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const send = (b: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(b));
    if (req.method === 'GET' && url.pathname === '/rest/2.0/assetTypes') return send({ results: [] });
    if (req.method === 'POST' && url.pathname === '/rest/2.0/assetTypes') {
      return send({ id: NEW_TYPE, name: 'Data Product Thing', parent: { id: DATA_ASSET, name: 'Data Asset' } });
    }
    if (url.pathname === `/rest/2.0/assignments/assetType/${COLUMN}`) {
      return send([{
        id: 'asg', characteristicTypes: [
          // Declared on supertypes; direction comes from roleDirection.
          { roleDirection: 'TO_SOURCE', relationType: { id: REPRESENTS, role: 'represents', coRole: 'represented by', sourceType: { id: BUSINESS_ASSET, name: 'Business Asset' }, targetType: { id: DATA_ASSET, name: 'Data Asset' } } },
          { roleDirection: 'TO_TARGET', relationType: { id: id(101), role: 'is part of', coRole: 'contains', sourceType: { id: DATA_ASSET, name: 'Data Asset' }, targetType: { id: id(7), name: 'Table' } } },
        ],
      }]);
    }
    send({});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), 'woffles-model-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ readOnly: false, instances: [{ name: 'Mock', baseUrl, username: 'u', password: 'p' }] }));
  process.env.COLLIBRA_CONFIG_PATH = join(dir, 'config.json');
  process.env.COLLIBRA_MCP_CACHE_DIR = join(dir, 'cache');
  registry = await import('../src/tools/index.js');
  cache = await import('../src/utils/operating-model-cache.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

function snapshot(overrides: Record<string, unknown> = {}) {
  const t = (tid: string, name: string, parentId?: string) => ({ id: tid, name, ...(parentId ? { parentId } : {}) });
  return {
    instance: 'Mock',
    baseUrl,
    refreshedAt: new Date().toISOString(),
    snapshotHash: 'h',
    assetTypes: [t(ASSET, 'Asset'), t(DATA_ASSET, 'Data Asset', ASSET), t(COLUMN, 'Column', DATA_ASSET), t(BUSINESS_ASSET, 'Business Asset', ASSET), t(TERM, 'Business Term', BUSINESS_ASSET)],
    domainTypes: [],
    attributeTypes: [],
    relationTypes: [{ id: REPRESENTS, role: 'represents', corole: 'represented by', sourceTypeId: BUSINESS_ASSET, sourceTypeName: 'Business Asset', targetTypeId: DATA_ASSET, targetTypeName: 'Data Asset' }],
    statuses: [],
    ...overrides,
  };
}
const call = async (name: string, args: object) => (await registry.executeTool(name, { instance_name: 'Mock', ...args })).structured as any;

describe('cache storage', () => {
  it('saves atomically (no temp files left) and memoizes until the file changes', () => {
    cache.saveSnapshot(snapshot() as any);
    expect(readdirSync(join(dir, 'cache')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const a = cache.loadSnapshot('Mock');
    expect(cache.loadSnapshot('Mock')).toBe(a);
  });

  it('ignores a snapshot taken from a different server', () => {
    cache.saveSnapshot(snapshot({ baseUrl: 'https://other.example' }) as any);
    expect(cache.loadSnapshot('Mock')).toBeNull();
    cache.saveSnapshot(snapshot() as any);
    expect(cache.loadSnapshot('Mock')).not.toBeNull();
  });

  it('reports staleness from age and missing baseUrl', () => {
    const old = cache.snapshotStatus(snapshot({ refreshedAt: new Date(Date.now() - 48 * 3600_000).toISOString() }) as any);
    expect(old.model.stale).toBe(true);
    expect(old.warnings[0]).toMatch(/refreshed 48h ago/);
    expect(cache.snapshotStatus(snapshot({ baseUrl: undefined }) as any).model.stale).toBe(true);
    expect(cache.snapshotStatus(snapshot() as any).model.stale).toBe(false);
  });
});

describe('supertype-aware model tools', () => {
  it('validate_against_model accepts subtypes at both relation ends', async () => {
    cache.saveSnapshot(snapshot() as any);
    const ok = await call('validate_against_model', { proposal_type: 'relation', relation_type_id: REPRESENTS, source_asset_type_id: TERM, target_asset_type_id: COLUMN });
    expect(ok.data).toMatchObject({ valid: true, violations: [] });
    const bad = await call('validate_against_model', { proposal_type: 'relation', relation_type_id: REPRESENTS, source_asset_type_id: COLUMN, target_asset_type_id: TERM });
    expect(bad.data.valid).toBe(false);
  });

  it('find_traversal_path uses relation types declared on supertypes', async () => {
    cache.saveSnapshot(snapshot() as any);
    const res = await call('find_traversal_path', { source_asset_type_id: TERM, target_asset_type_id: COLUMN, max_depth: 2 });
    expect(res.data.paths[0].length).toBe(1);
    expect(res.data.paths[0].steps[0]).toMatchObject({ label: 'represents', from: 'Business Asset', to: 'Data Asset', viaSupertype: true });
  });
});

describe('get_operating_model_summary', () => {
  it('reports top-level families when the root Asset type is not listed (as Collibra returns it)', async () => {
    const s = snapshot();
    s.assetTypes = s.assetTypes.filter((t) => t.id !== ASSET); // /assetTypes omits the root
    cache.saveSnapshot(s as any);
    const res = await call('get_operating_model_summary', {});
    expect(res.data.topLevelAssetTypeFamilies).toEqual([
      { family: 'Data Asset', descendantCount: 1 },
      { family: 'Business Asset', descendantCount: 1 },
    ]);
  });
});

describe('model writes keep the cache current', () => {
  it('create_asset_type patches the snapshot so describe_asset_type finds the new type', async () => {
    cache.saveSnapshot(snapshot() as any);
    await call('create_asset_type', { name: 'Data Product Thing', parent_id: DATA_ASSET });
    const snap = cache.loadSnapshot('Mock')!;
    expect(snap.assetTypes.some((t) => t.id === NEW_TYPE && t.parentId === DATA_ASSET)).toBe(true);
    expect(snap.patchedSinceRefresh).toEqual([`assetType ${NEW_TYPE}`]);
    expect(snap.snapshotHash).not.toBe('h');
    expect(existsSync(join(dir, 'cache'))).toBe(true);
  });
});

describe('assignment relation direction', () => {
  it('uses roleDirection for relation types declared on supertypes', async () => {
    const a = await cache.fetchAssetTypeAssignments('Mock', COLUMN);
    expect(a.relationTypes.map((r) => [r.role, r.direction, r.otherTypeName])).toEqual([
      ['represents', 'INCOMING', 'Business Asset'],
      ['is part of', 'OUTGOING', 'Table'],
    ]);
  });
});
