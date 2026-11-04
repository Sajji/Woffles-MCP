/**
 * create_asset against an in-process mock of the Collibra REST endpoints it
 * uses: the asset must be created even when attributes the asset type marks as
 * required (minimumOccurrences >= 1) are missing, and no status is sent unless
 * the caller supplied one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TYPE = 't0000000-0000-0000-0000-000000000001';
const DOMAIN = 'd0000000-0000-0000-0000-000000000001';
const DEFINITION = '00000000-0000-0000-0000-000000000202';

const posted: any[] = [];
let server: Server;
let dir: string;
let registry: typeof import('../src/tools/index.js');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (b: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(b));
      };
      if (req.method === 'GET' && url.pathname === `/rest/2.0/assignments/assetType/${TYPE}`) {
        return send([
          {
            statuses: [{ id: 's1', name: 'Candidate' }],
            domainTypes: [],
            characteristicTypes: [{ minimumOccurrences: 1, attributeType: { id: DEFINITION, name: 'Definition', resourceType: 'StringAttributeType' } }],
          },
        ]);
      }
      if (req.method === 'GET' && url.pathname === '/rest/2.0/assets') return send({ results: [], total: 0 });
      if (req.method === 'POST' && url.pathname === '/rest/2.0/assets') {
        const b = JSON.parse(body);
        posted.push(b);
        return send({ id: 'new-asset', name: b.name, displayName: b.name, type: { id: TYPE }, domain: { id: DOMAIN } });
      }
      send({ statusCode: 404 }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'woffles-create-'));
  const cfg = join(dir, 'config.json');
  writeFileSync(
    cfg,
    JSON.stringify({
      readOnly: false,
      instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'u', password: 'mock-password' }],
    }),
  );
  process.env.COLLIBRA_CONFIG_PATH = cfg;
  registry = await import('../src/tools/index.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('create_asset', () => {
  it('creates the asset even when required attributes are missing, and reports them', async () => {
    const r: any = (await registry.executeTool('create_asset', { instance_name: 'Mock', name: 'Test 001', asset_type_id: TYPE, domain_id: DOMAIN })).structured;
    expect(r.success).toBe(true);
    expect(r.asset.id).toBe('new-asset');
    expect(r.missingRequiredAttributes).toEqual([{ id: DEFINITION, name: 'Definition' }]);
    expect(r.warning).toMatch(/created anyway/);
    expect(r.nextActions.map((a: any) => a.tool)).toEqual(['get_asset_by_id', 'edit_asset', 'create_relation']);
    expect(r.nextActions[1].args.operations[0]).toMatchObject({ op: 'update_attribute', attribute_type_id: DEFINITION });
  });

  it('sends no status unless one is supplied', async () => {
    posted.length = 0;
    await registry.executeTool('create_asset', { instance_name: 'Mock', name: 'Test 002', asset_type_id: TYPE, domain_id: DOMAIN });
    await registry.executeTool('create_asset', { instance_name: 'Mock', name: 'Test 003', asset_type_id: TYPE, domain_id: DOMAIN, status_id: 's1' });
    expect(posted[0]).not.toHaveProperty('statusId');
    expect(posted[1].statusId).toBe('s1');
  });
});
