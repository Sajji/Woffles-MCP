/**
 * Phase 5: responses and tools/list stay compact. In-process mock; never
 * touches a real instance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ASSET = 'a0000000-0000-0000-0000-000000000001';
const audit = { createdBy: 'u', createdOn: 1, lastModifiedBy: 'u', lastModifiedOn: 2, system: false, resourceDiscriminator: 'X' };

let server: Server;
let dir: string;
let registry: typeof import('../src/tools/index.js');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const send = (b: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(b));
    switch (url.pathname) {
      case '/rest/2.0/domains':
        return send({ total: 1, results: [{ id: 'd1', name: 'Glossary', ...audit, type: { id: 't1', name: 'Glossary', ...audit }, community: { id: 'c1', name: 'Finance' } }] });
      case '/rest/2.0/communities':
        return send({ total: 2, results: [{ id: 'c1', name: 'Finance', ...audit }, { id: 'c2', name: 'Child', parent: { id: 'c1', name: 'Finance' }, ...audit }] });
      case '/rest/assessments/v2/assessments':
        return send({ results: [{ id: 'a1', name: 'DPIA', status: 'DRAFT', content: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] }] });
      case '/rest/2.0/responsibilities':
        return send({
          results: [
            { id: 'r1', role: { id: 'role1', name: 'Steward' }, owner: { id: 'u1', resourceType: 'User' }, baseResource: { id: ASSET, resourceType: 'Asset' }, ...audit },
            { id: 'r2', role: { id: 'role2', name: 'Owner' }, owner: { id: 'u1', resourceType: 'User' }, baseResource: { id: 'd1', resourceType: 'Domain', name: 'Glossary' }, ...audit },
          ],
        });
      case '/rest/2.0/users':
        return send({ results: [{ id: 'u1', userName: 'jo', firstName: 'Jo', lastName: 'Smith', emailAddress: 'jo@x' }] });
      case `/rest/2.0/assets/${ASSET}`:
        return send({ id: ASSET, name: 'A', type: { name: 'Table' }, domain: { name: 'D' } });
      default:
        return send({ results: [] });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'woffles-payload-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ readOnly: true, instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'u', password: 'p' }] }),
  );
  process.env.COLLIBRA_CONFIG_PATH = join(dir, 'config.json');
  registry = await import('../src/tools/index.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const call = (name: string, args: object) => registry.executeTool(name, { instance_name: 'Mock', ...args });

describe('compact responses', () => {
  it('text is compact JSON even for tools that pretty-print', async () => {
    const r = await call('get_asset_responsibilities', { asset_id: ASSET });
    expect(r.text).toBe(JSON.stringify(r.structured));
  });

  it('get_domains lists each domain once, without audit metadata', async () => {
    const s: any = (await call('get_domains', {})).structured;
    expect(s.domainsByCommunity).toBeUndefined();
    expect(s.allDomains).toEqual([
      { id: 'd1', name: 'Glossary', type: { id: 't1', name: 'Glossary' }, community: { id: 'c1', name: 'Finance' }, url: expect.stringContaining('/domain/d1') },
    ]);
  });

  it('get_communities returns the tree once (no flat duplicate)', async () => {
    const s: any = (await call('get_communities', {})).structured;
    expect(s.flat).toBeUndefined();
    expect(s.hierarchy).toHaveLength(1);
    expect(s.hierarchy[0].children[0]).toMatchObject({ id: 'c2', name: 'Child' });
    expect(JSON.stringify(s)).not.toContain('createdBy');
  });

  it('list_assessments omits Q&A content unless include_content is set', async () => {
    const lean: any = (await call('list_assessments', {})).structured;
    expect(lean.results[0]).toMatchObject({ id: 'a1', questionCount: 3 });
    expect(lean.results[0].content).toBeUndefined();
    const full: any = (await call('list_assessments', { include_content: true })).structured;
    expect(full.results[0].content).toHaveLength(3);
  });

  it('responsibilities are listed once, compactly, with inheritedFrom', async () => {
    const s: any = (await call('get_asset_responsibilities', { asset_id: ASSET })).structured;
    expect(s.responsibilities.direct).toEqual([
      { id: 'r1', role: 'Steward', roleId: 'role1', owner: { id: 'u1', type: 'User', name: 'Jo Smith', userName: 'jo', email: 'jo@x' }, inheritedFrom: null },
    ]);
    expect(s.responsibilities.inherited[0].inheritedFrom).toEqual({ type: 'Domain', id: 'd1', name: 'Glossary' });
    expect(s.groupedByOwner).toEqual({ 'Jo Smith (User)': ['Steward', 'Owner'] });
  });
});

describe('compact tools/list', () => {
  it('uses format: uuid, one short instance_name description, and no placeholder output schemas', () => {
    const json = JSON.stringify(registry.tools);
    expect(json).not.toContain('[0-9a-fA-F]{8}');
    expect(json).not.toContain('Fields vary by tool');
    const descs = new Set(registry.tools.map((t: any) => t.inputSchema.properties?.instance_name?.description).filter(Boolean));
    expect(descs.size).toBe(1);
    for (const t of registry.tools as any[]) {
      if (t.outputSchema) expect(Object.keys(t.outputSchema.properties ?? {}).length, t.name).toBeGreaterThan(0);
      for (const p of Object.values<any>(t.inputSchema.properties ?? {})) {
        expect(p.description ?? '', t.name).not.toMatch(/^Optional\s*[:\-]/i);
      }
    }
  });
});
