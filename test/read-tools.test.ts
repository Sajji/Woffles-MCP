/**
 * Phase 2 read-tool regressions: exact query parameters sent to Collibra and
 * correct mapping of response fields. In-process mock; never touches a real instance.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const COL = 'c0000000-0000-0000-0000-000000000001';
const DA = 'da000000-0000-0000-0000-000000000001';
const TERM = '7e000000-0000-0000-0000-000000000001';
const MEASURE = 'ae000000-0000-0000-0000-000000000001';
const ASSET = 'a0000000-0000-0000-0000-000000000009';
const GENERIC = '00000000-0000-0000-0000-000000007038';
const MEASURE_REL = '00000000-0000-0000-0000-000000007200';

const requests: { path: string; query: URLSearchParams }[] = [];
let server: Server;
let dir: string;
let registry: typeof import('../src/tools/index.js');

const ref = (id: string, name: string) => ({ id, name });

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const q = url.searchParams;
    requests.push({ path: url.pathname, query: q });
    const send = (body: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    const list = (results: any[]) => send({ results, total: results.length });

    switch (url.pathname) {
      case '/rest/2.0/workflowTasks':
        return list([{ id: 't1', title: 'Approve', createTime: 1700000000000, owner: { id: 'u1', userName: 'jo' }, candidateUsers: [{ id: 'u2', userName: 'al' }], formKeyAvailable: true }]);
      case '/rest/2.0/users':
        return list([]);
      case '/rest/2.0/navigation/most_viewed':
        return list([{ assetId: ASSET, name: 'Popular', numberOfViews: 42, lastViewedDate: 1700000000000 }]);
      case '/rest/2.0/activities':
        return list([{ id: 'act1', timestamp: 1, activityType: 'DELETE', cause: 'BULK_DELETE', user: { id: 'u1', userName: 'Admin' }, description: '{"affected":{"name":"zz","id":"x1","type":"CO"}}' }]);
      case '/rest/2.0/ratings': {
        // Two pages of ratings for the asset: average must cover both.
        const offset = Number(q.get('offset') ?? 0);
        const all = [5, 5, 1, 1].map((rating, i) => ({ id: `r${i}`, rating, asset: ref(ASSET, 'A') }));
        const limit = Number(q.get('limit'));
        return list(all.slice(offset, offset + limit));
      }
      case '/rest/2.0/communities':
        // Name-filtered result: the child matched, its parent did not.
        return list([{ id: 'child', name: 'Finance Child', parent: { id: 'not-returned', name: 'Root' } }]);
      case '/rest/2.0/relations': {
        const type = q.get('relationTypeId');
        const src = q.get('sourceId');
        const tgt = q.get('targetId');
        const rels: any[] = [
          // Column <-> data attribute via the GENERIC type
          { source: ref(COL, 'Column'), target: ref(DA, 'Data Attribute'), type: { id: GENERIC } },
          // Data attribute <-> business term via GENERIC
          { source: ref(DA, 'Data Attribute'), target: ref(TERM, 'Term'), type: { id: GENERIC } },
          // Measure <-> data attribute via the measure type AND the generic type
          { source: ref(DA, 'Data Attribute'), target: ref(MEASURE, 'Measure'), type: { id: MEASURE_REL } },
          { source: ref(DA, 'Data Attribute'), target: ref(MEASURE, 'Measure'), type: { id: GENERIC } },
        ];
        return list(rels.filter((r) => r.type.id === type && (!src || r.source.id === src) && (!tgt || r.target.id === tgt)));
      }
      default:
        return list([]);
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'woffles-read-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ readOnly: true, instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'u', password: 'p' }] }),
  );
  // Operating-model snapshot: chain A -> B -> C -> D for traversal tests.
  const cache = join(dir, 'cache');
  mkdirSync(cache);
  const t = (n: string) => ({ id: `0000000${n}-0000-0000-0000-000000000000`, name: `Type ${n}` });
  const rel = (i: number, a: string, b: string) => ({
    id: `r${i}`, role: `r${i}`, corole: `c${i}`,
    sourceTypeId: t(a).id, sourceTypeName: t(a).name, targetTypeId: t(b).id, targetTypeName: t(b).name,
  });
  writeFileSync(
    join(cache, 'operating-model.Mock.json'),
    JSON.stringify({
      instance: 'Mock', refreshedAt: new Date().toISOString(), snapshotHash: 'h',
      assetTypes: ['A', 'B', 'C', 'D'].map(t), domainTypes: [], attributeTypes: [], statuses: [],
      relationTypes: [rel(1, 'A', 'B'), rel(2, 'B', 'C'), rel(3, 'C', 'D')],
    }),
  );
  process.env.COLLIBRA_CONFIG_PATH = join(dir, 'config.json');
  process.env.COLLIBRA_MCP_CACHE_DIR = cache;
  registry = await import('../src/tools/index.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests.length = 0;
});

const call = async (name: string, args: object) =>
  (await registry.executeTool(name, { instance_name: 'Mock', ...args })).structured as any;
const lastQuery = (path: string) => requests.filter((r) => r.path === path).at(-1)!.query;

describe('query parameters match the REST API', () => {
  it('find_workflow_tasks sends singular businessItemId/userId and maps real task fields', async () => {
    const res = await call('find_workflow_tasks', { business_item_id: ASSET, user_id: COL });
    const q = lastQuery('/rest/2.0/workflowTasks');
    expect(q.get('businessItemId')).toBe(ASSET);
    expect(q.get('businessItemType')).toBe('ASSET');
    expect(q.get('userId')).toBe(COL);
    expect(q.has('businessItemIds')).toBe(false);
    expect(res.data.tasks[0]).toMatchObject({ createTime: 1700000000000, owner: { id: 'u1', name: 'jo' }, formKeyAvailable: true });
  });

  it('find_users maps only_enabled=false to includeDisabled=true', async () => {
    await call('find_users', { only_enabled: false });
    expect(lastQuery('/rest/2.0/users').get('includeDisabled')).toBe('true');
    expect(lastQuery('/rest/2.0/users').has('onlyEnabledUsers')).toBe(false);
  });
});

describe('response fields are mapped correctly', () => {
  it('get_asset_view_stats reads assetId and builds URLs', async () => {
    const res = await call('get_asset_view_stats', {});
    expect(res.data.entries[0]).toMatchObject({ assetId: ASSET, viewCount: 42 });
    expect(res.data.entries[0].url).toContain(ASSET);
  });

  it('get_activities parses the JSON description into onResource', async () => {
    const res = await call('get_activities', {});
    expect(res.data.activities[0].onResource).toEqual({ id: 'x1', name: 'zz', typeCode: 'CO' });
  });

  it('find_ratings averages all of an asset\'s ratings, not one page', async () => {
    const res = await call('find_ratings', { asset_id: ASSET, limit: 2 });
    expect(res.data.count).toBe(2);
    expect(res.data).toMatchObject({ averageRating: 3, ratingCount: 4 });
  });

  it('get_communities keeps filtered children whose parent was not returned', async () => {
    const res = await call('get_communities', { name: 'Finance' });
    expect(res.hierarchy.map((c: any) => c.id)).toEqual(['child']);
  });
});

describe('semantics tools exclude the asset itself', () => {
  it('get_column_semantics does not list the column as its own business term', async () => {
    const res = await call('get_column_semantics', { column_asset_id: COL });
    const terms = res.dataAttributes.flatMap((d: any) => d.businessTerms.map((t: any) => t.id));
    expect(terms).toEqual([TERM]);
  });

  it('get_measure_data does not list the measure as its own column', async () => {
    const res = await call('get_measure_data', { measure_asset_id: MEASURE });
    const cols = res.dataAttributes.flatMap((d: any) => d.columns.map((c: any) => c.id));
    expect(cols).not.toContain(MEASURE);
  });
});

describe('find_traversal_path depth', () => {
  it('never returns paths longer than max_depth', async () => {
    const short = await call('find_traversal_path', { source_asset_type_name: 'Type A', target_asset_type_name: 'Type D', max_depth: 2 });
    expect(short.data.paths).toEqual([]);
    const ok = await call('find_traversal_path', { source_asset_type_name: 'Type A', target_asset_type_name: 'Type D', max_depth: 3 });
    expect(ok.data.paths.map((p: any) => p.length)).toEqual([3]);
  });
});
