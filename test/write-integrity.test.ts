/**
 * Phase 0 regression tests: write tools must send the exact query parameters
 * and bodies Collibra expects. Runs against an in-process mock that mimics the
 * real API's quirks (notably: GET /relations IGNORES `typeId` and only filters
 * by `relationTypeId`), so it never touches a real instance.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const T1 = '11111111-0000-0000-0000-000000000000';
const T2 = '22222222-0000-0000-0000-000000000000';
const T3 = '33333333-0000-0000-0000-000000000000';
const BROKEN = 'eeeeeeee-0000-0000-0000-000000000500';
const MISSING = 'ffffffff-0000-0000-0000-000000000404';
const DATE_TYPE = 'da7e0000-0000-0000-0000-000000000000';
const MULTI_TYPE = '3a170000-0000-0000-0000-000000000000';
const REQ_TYPE = 'aeq00000-0000-0000-0000-000000000000';
const ASSET_TYPE = 'a55e7000-0000-0000-0000-000000000000';
const DOMAIN = 'd0000000-0000-0000-0000-000000000000';

interface Req { method: string; path: string; query: URLSearchParams; body: any }
let requests: Req[] = [];
let state: any;

function resetState() {
  requests = [];
  state = {
    relations: [
      { id: 'rel-t1', source: { id: A }, target: { id: B }, type: { id: T1 } },
      { id: 'rel-t2', source: { id: A }, target: { id: B }, type: { id: T2 } },
    ],
    attributes: [
      { id: 'm1', asset: { id: A }, type: { id: MULTI_TYPE }, value: 'x' },
      { id: 'm2', asset: { id: A }, type: { id: MULTI_TYPE }, value: 'y' },
      { id: 'm3', asset: { id: A }, type: { id: MULTI_TYPE }, value: 'z' },
    ],
    tags: [] as string[],
  };
}

const readBody = (req: IncomingMessage): Promise<any> =>
  new Promise((r) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        r(b ? JSON.parse(b) : undefined);
      } catch {
        r(b);
      }
    });
  });

let server: Server;
let dir: string;
let registry: typeof import('../src/tools/index.js');

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const body = await readBody(req);
    const p = url.pathname;
    const q = url.searchParams;
    requests.push({ method: req.method!, path: p, query: q, body });
    const send = (data: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    const list = (results: any[]) => send({ results, total: results.length });
    const GET = req.method === 'GET';

    // Assets
    if (GET && p === `/rest/2.0/assets/${A}`) return send({ id: A, name: 'Asset A', type: { id: ASSET_TYPE }, domain: { id: DOMAIN } });
    if (GET && p === `/rest/2.0/assets/${B}`) return send({ id: B, name: 'Asset B' });
    if (GET && p === `/rest/2.0/assets/${BROKEN}`) return send({ message: 'boom' }, 500);
    if (GET && p === '/rest/2.0/assets') return list(q.get('name') === 'Exists' ? [{ id: 'exists-1', name: 'Exists', domain: { id: DOMAIN } }] : []);
    if (req.method === 'POST' && p === '/rest/2.0/assets/bulk') return send(body.map((b: any, i: number) => ({ id: `new-${i}`, name: b.name })));

    // Relations — like the real API, `typeId` is ignored; only `relationTypeId` filters.
    if (GET && p === '/rest/2.0/relations') {
      return list(
        state.relations.filter(
          (r: any) =>
            (!q.get('sourceId') || r.source.id === q.get('sourceId')) &&
            (!q.get('targetId') || r.target.id === q.get('targetId')) &&
            (!q.get('relationTypeId') || r.type.id === q.get('relationTypeId')),
        ),
      );
    }
    if (GET && p.startsWith('/rest/2.0/relations/')) {
      const r = state.relations.find((x: any) => x.id === p.split('/').pop());
      return r ? send(r) : send({}, 404);
    }
    if (req.method === 'POST' && p === '/rest/2.0/relations') return send({ id: 'rel-new', source: { id: body.sourceId }, target: { id: body.targetId }, type: { id: body.typeId } });
    if (req.method === 'POST' && p === '/rest/2.0/relations/bulk') return send(body.map((_: any, i: number) => ({ id: `rel-bulk-${i}` })));
    if (req.method === 'DELETE' && p === '/rest/2.0/relations/bulk') {
      state.relations = state.relations.filter((r: any) => !body.includes(r.id));
      return send({});
    }
    if (GET && p === '/rest/2.0/relationTypes') {
      return list([T1, T2, T3].map((id, i) => ({ id, role: `role${i + 1}`, coRole: `corole${i + 1}` })));
    }

    // Tags
    if (GET && p === `/rest/2.0/assets/${A}/tags`) return send(state.tags.map((name: string) => ({ name })));
    if (req.method === 'POST' && p === `/rest/2.0/assets/${A}/tags`) {
      if (!body || Array.isArray(body) || !Array.isArray(body.tagNames)) return send({ message: 'tagNames required' }, 400);
      state.tags.push(...body.tagNames);
      return send([]);
    }

    // Roles / users / groups (name filter is a case-insensitive "contains", like Collibra)
    const contains = (items: any[], key: string) => items.filter((x) => x[key].toLowerCase().includes((q.get('name') || '').toLowerCase()));
    if (GET && p === '/rest/2.0/roles') return list(contains([{ id: 'role-bs', name: 'Business Steward' }, { id: 'role-s', name: 'Steward' }], 'name'));
    if (GET && p === '/rest/2.0/users') return list(contains([{ id: 'u-josmith', userName: 'jo.smith' }, { id: 'u-jon', userName: 'jon' }], 'userName'));
    if (GET && p === '/rest/2.0/userGroups') return list([]);
    if (GET && p === '/rest/2.0/responsibilities') return list([]);
    if (req.method === 'POST' && p === '/rest/2.0/responsibilities') return send({ id: 'resp-new' });

    // Attribute types
    const attrTypes: Record<string, any> = {
      [DATE_TYPE]: { id: DATE_TYPE, name: 'Approval date', attributeTypeDiscriminator: 'DateAttributeType' },
      [MULTI_TYPE]: { id: MULTI_TYPE, name: 'Regions', attributeTypeDiscriminator: 'MultiValueListAttributeType' },
      [REQ_TYPE]: { id: REQ_TYPE, name: 'Required Thing', attributeTypeDiscriminator: 'StringAttributeType', stringType: 'PLAIN_TEXT' },
    };
    if (GET && p.startsWith('/rest/2.0/attributeTypes/')) {
      const t = attrTypes[p.split('/').pop()!];
      return t ? send(t) : send({}, 404);
    }
    if (GET && p === '/rest/2.0/attributeTypes') {
      return list(q.get('name') === 'Flag' ? [{ id: 'flag-1', name: 'Flag', resourceType: 'StringAttributeType' }] : []);
    }

    // Attributes
    if (GET && p === '/rest/2.0/attributes') {
      return list(state.attributes.filter((a: any) => a.asset.id === q.get('assetId') && (!q.get('typeIds') || a.type.id === q.get('typeIds'))));
    }
    if (req.method === 'PATCH' && p === '/rest/2.0/attributes/bulk') return send(body.map((b: any) => ({ id: b.id })));
    if (req.method === 'POST' && p === '/rest/2.0/attributes/bulk') return send(body.map((b: any, i: number) => ({ id: `attr-new-${i}`, asset: { id: b.assetId } })));
    if (req.method === 'DELETE' && p.startsWith('/rest/2.0/attributes/')) return send({});

    // Assignments: the global one requires REQ_TYPE; a second one, scoped to a
    // DIFFERENT domain, also requires DATE_TYPE and must not be enforced here.
    if (GET && p.startsWith('/rest/2.0/assignments/assetType/')) {
      return send([
        {
          id: 'asg-1',
          domainTypes: [{ id: 'dt-1', name: 'Glossary' }],
          characteristicTypes: [{ attributeType: { id: REQ_TYPE, name: 'Required Thing' }, minimumOccurrences: 1 }],
        },
        {
          id: 'asg-scoped',
          domainTypes: [{ id: 'dt-1', name: 'Glossary' }],
          scope: { name: 'Other scope', domains: [{ id: 'some-other-domain' }], communities: [] },
          characteristicTypes: [
            { attributeType: { id: REQ_TYPE, name: 'Required Thing' }, minimumOccurrences: 1 },
            { attributeType: { id: DATE_TYPE, name: 'Approval date' }, minimumOccurrences: 1 },
          ],
        },
      ]);
    }
    if (GET && p === `/rest/2.0/domains/${DOMAIN}`) return send({ id: DOMAIN, type: { id: 'dt-1' }, community: { id: 'comm-1' } });
    if (GET && p === '/rest/2.0/communities/comm-1') return send({ id: 'comm-1' });
    if (req.method === 'PATCH' && p.startsWith('/rest/2.0/assignments/')) return send({});

    // Domains
    if (GET && p === '/rest/2.0/domains') {
      return list(q.get('name') === 'Glossary' ? [{ id: 'dom-1', name: 'Glossary', type: { id: 'c0000000-0000-0000-0000-000000000010', name: 'Glossary' } }] : []);
    }

    // Mappings
    if (GET && p === '/rest/2.0/mappings/externalSystem/sys/externalEntity/mapped') {
      return send({ id: 'map-1', externalSystemId: 'sys', externalEntityId: 'mapped', mappedResource: { id: A, name: 'Asset A' } });
    }
    if (GET && p === '/rest/2.0/mappings/externalSystem/sys/externalEntity/broken') return send({}, 500);
    if (GET && p.startsWith('/rest/2.0/mappings/externalSystem/')) return send({}, 404);
    if (req.method === 'POST' && p === '/rest/2.0/mappings') return send({ id: 'map-new' });

    send({ statusCode: 404, path: p }, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  dir = mkdtempSync(join(tmpdir(), 'woffles-write-'));
  const cfgPath = join(dir, 'config.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      readOnly: false,
      instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'svc', password: 'pw' }],
    }),
  );
  process.env.COLLIBRA_CONFIG_PATH = cfgPath;
  process.env.COLLIBRA_MCP_CACHE_DIR = join(dir, 'cache');
  registry = await import('../src/tools/index.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(resetState);

const call = async (name: string, args: object) => (await registry.executeTool(name, { instance_name: 'Mock', ...args })).structured as any;
const sent = (method: string, path: string) => requests.filter((r) => r.method === method && r.path === path);

describe('relation writes use relationTypeId, never typeId', () => {
  it('edit_asset remove_relation deletes only the relation of the requested type', async () => {
    const res = await call('edit_asset', {
      asset_id: A,
      operations: [{ op: 'remove_relation', target_asset_id: B, relation_type_id: T2 }],
      confirm: true,
    });
    expect(res.mode).toBe('APPLIED');
    expect(sent('DELETE', '/rest/2.0/relations/bulk')[0].body).toEqual(['rel-t2']);
    expect(state.relations.map((r: any) => r.id)).toEqual(['rel-t1']);
    for (const r of sent('GET', '/rest/2.0/relations')) expect(r.query.has('typeId')).toBe(false);
  });

  it('edit_asset add_relation creates a relation even when another type links the same assets', async () => {
    await call('edit_asset', {
      asset_id: A,
      operations: [{ op: 'add_relation', target_asset_id: B, relation_type_id: T3 }],
      confirm: true,
    });
    expect(sent('POST', '/rest/2.0/relations/bulk')[0].body).toEqual([{ sourceId: A, targetId: B, typeId: T3 }]);
  });

  it('create_relation creates when only a different-type relation exists, with role labels', async () => {
    const res = await call('create_relation', { source_asset_id: A, target_asset_id: B, relation_type_id: T3 });
    expect(res.action).toBe('created');
    expect(res.relation.type).toEqual({ id: T3, role: 'role3', coRole: 'corole3' });
  });

  it('create_relation returns the existing relation for an exact triple', async () => {
    const res = await call('create_relation', { source_asset_id: A, target_asset_id: B, relation_type_id: T1 });
    expect(res.action).toBe('existing');
    expect(res.relation.id).toBe('rel-t1');
    expect(sent('POST', '/rest/2.0/relations')).toHaveLength(0);
  });

  it('bulk_create_relations skips existing triples and in-request duplicates only', async () => {
    const res = await call('bulk_create_relations', {
      relations: [
        { source_asset_id: A, target_asset_id: B, relation_type_id: T1 },
        { source_asset_id: A, target_asset_id: B, relation_type_id: T3 },
        { source_asset_id: A, target_asset_id: B, relation_type_id: T3 },
      ],
      confirm: true,
    });
    expect(res.created).toBe(1);
    expect(sent('POST', '/rest/2.0/relations/bulk')[0].body).toEqual([{ sourceId: A, targetId: B, typeId: T3 }]);
  });
});

describe('edit_asset tags and responsibilities', () => {
  it('add_tag posts { tagNames: [...] }', async () => {
    const res = await call('edit_asset', { asset_id: A, operations: [{ op: 'add_tag', tag: 'pii' }], confirm: true });
    expect(res.errors).toBeUndefined();
    expect(sent('POST', `/rest/2.0/assets/${A}/tags`)[0].body).toEqual({ tagNames: ['pii'] });
  });

  it('resolves an exact role name instead of the first "contains" hit', async () => {
    await call('edit_asset', { asset_id: A, operations: [{ op: 'set_responsibility', role: 'Steward', owner: 'jon' }], confirm: true });
    expect(sent('POST', '/rest/2.0/responsibilities')[0].body).toEqual({ roleId: 'role-s', ownerId: 'u-jon', resourceId: A, resourceType: 'Asset' });
  });

  it('refuses a non-exact owner name instead of guessing', async () => {
    const res = await call('edit_asset', { asset_id: A, operations: [{ op: 'set_responsibility', role: 'Steward', owner: 'jo' }] });
    expect(res.operations[0].error).toMatch(/No user .* named exactly "jo"/);
    expect(sent('POST', '/rest/2.0/responsibilities')).toHaveLength(0);
  });
});

describe('attribute value handling', () => {
  it('update_asset_attribute replaces every value of a multi-value attribute', async () => {
    await call('update_asset_attribute', { asset_id: A, attribute_type_id: MULTI_TYPE, new_value: 'a, b', confirm: true });
    expect(sent('PATCH', '/rest/2.0/attributes/bulk')[0].body).toEqual([
      { id: 'm1', value: 'a' },
      { id: 'm2', value: 'b' },
    ]);
    expect(sent('DELETE', '/rest/2.0/attributes/m3')).toHaveLength(1);
  });

  it('update_asset_attribute converts an ISO date to epoch millis', async () => {
    await call('update_asset_attribute', { asset_id: A, attribute_type_id: DATE_TYPE, new_value: '2026-01-15', confirm: true });
    expect(sent('POST', '/rest/2.0/attributes/bulk')[0].body).toEqual([
      { assetId: A, typeId: DATE_TYPE, value: Date.parse('2026-01-15') },
    ]);
  });

  it('rejects an unparseable date instead of writing it', async () => {
    const res = await call('update_asset_attribute', { asset_id: A, attribute_type_id: DATE_TYPE, new_value: 'next tuesday', confirm: true });
    expect(res.error).toBe(true);
    expect(sent('POST', '/rest/2.0/attributes/bulk')).toHaveLength(0);
  });
});

describe('bulk_create_assets', () => {
  it('blocks the batch when a required attribute is missing', async () => {
    const res = await call('bulk_create_assets', {
      assets: [{ name: 'New One', asset_type_id: ASSET_TYPE, domain_id: DOMAIN }],
      confirm: true,
    });
    expect(res.error).toBe(true);
    expect(res.blocked[0].missingRequiredAttributes).toEqual([{ id: REQ_TYPE, name: 'Required Thing' }]);
    expect(sent('POST', '/rest/2.0/assets/bulk')).toHaveLength(0);
  });

  it('creates an in-request duplicate only once', async () => {
    const asset = { name: 'Twin', asset_type_id: ASSET_TYPE, domain_id: DOMAIN, attributes: { [REQ_TYPE]: 'v' } };
    const res = await call('bulk_create_assets', { assets: [asset, asset], confirm: true });
    expect(res.created).toBe(1);
    expect(sent('POST', '/rest/2.0/assets/bulk')[0].body).toHaveLength(1);
    expect(res.details[1].action).toBe('SKIPPED (duplicate in request)');
  });
});

describe('safety defaults and conflict detection', () => {
  it('assign_attribute_to_asset_type previews by default', async () => {
    const res = await call('assign_attribute_to_asset_type', { asset_type_id: ASSET_TYPE, attribute_type_id: DATE_TYPE });
    expect(res.action).toBe('preview');
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('create_domain reports a conflict when the name exists with another type', async () => {
    const res = await call('create_domain', { name: 'Glossary', community_id: 'c0000000-0000-0000-0000-000000000001', type_id: 'c0000000-0000-0000-0000-0000000000ff' });
    expect(res).toMatchObject({ error: true, status: 'conflict' });
    expect(sent('POST', '/rest/2.0/domains')).toHaveLength(0);
  });

  it('create_attribute_type reports a conflict when the name exists with another kind', async () => {
    const res = await call('create_attribute_type', { name: 'Flag', kind: 'BOOLEAN' });
    expect(res).toMatchObject({ error: true, status: 'conflict' });
  });

  it('add_mapping reports a conflict when the entity is mapped to another resource', async () => {
    const res = await call('add_mapping', { external_system_id: 'sys', external_entity_id: 'mapped', mapped_resource_id: B });
    expect(res).toMatchObject({ error: true, status: 'conflict' });
    expect(sent('POST', '/rest/2.0/mappings')).toHaveLength(0);
  });

  it('add_mapping does not POST when the lookup fails with a server error', async () => {
    const res = await call('add_mapping', { external_system_id: 'sys', external_entity_id: 'broken', mapped_resource_id: B });
    expect(res.error).toBe(true);
    expect(sent('POST', '/rest/2.0/mappings')).toHaveLength(0);
  });

  it('bulk_delete_assets treats only a 404 as "not found" and aborts on server errors', async () => {
    const missing = await call('bulk_delete_assets', { asset_ids: [MISSING] });
    expect(missing.notFound).toBe(1);
    const broken = await call('bulk_delete_assets', { asset_ids: [A, BROKEN], confirm: true });
    expect(broken.error).toBe(true);
    expect(sent('DELETE', '/rest/2.0/assets/bulk')).toHaveLength(0);
  });
});
