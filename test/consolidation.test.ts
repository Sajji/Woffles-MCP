/**
 * Phase 4 consolidation: legacy tools are hidden from tools/list but remain
 * callable; consolidated tools route to the right API calls.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const VIEW = 'b0000000-0000-0000-0000-000000000001'; // a Database View asset
const VIEW_TYPE = '00000000-0000-0000-0001-000400000009';
const TABLE_TYPE = '00000000-0000-0000-0000-000000031007';
const ODD = 'b0000000-0000-0000-0000-000000000002'; // asset of an unsupported type
const REVIEW = 'c0000000-0000-0000-0000-000000000001';
const PORT = 'd0000000-0000-0000-0000-000000000001';

const requests: { method: string; path: string }[] = [];
let server: Server;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    requests.push({ method: req.method!, path: url.pathname });
    const send = (b: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(b));
    const p = url.pathname;
    if (p.startsWith('/technical_lineage_resource/')) return send({ results: [] });
    if (p === `/rest/2.0/assets/${VIEW}`) return send({ id: VIEW, name: 'v_customers', type: { id: VIEW_TYPE, name: 'Database View' } });
    if (p === `/rest/2.0/assets/${ODD}`) return send({ id: ODD, name: 'Odd', type: { id: 'e0000000-0000-0000-0000-000000000000', name: 'Policy' } });
    if (p === `/rest/2.0/assetTypes/${VIEW_TYPE}`) return send({ id: VIEW_TYPE, name: 'Database View', parent: { id: TABLE_TYPE } });
    if (p === '/rest/2.0/assetTypes/e0000000-0000-0000-0000-000000000000') return send({ id: 'e0000000-0000-0000-0000-000000000000', name: 'Policy' });
    if (p === '/rest/2.0/relations') return send({ results: [], total: 0 });
    if (p === `/rest/assessments/v2/assessments/by/assessmentReview/${REVIEW}`) return send({ id: 'asm-1', name: 'DPIA' });
    if (p === '/rest/dataProduct/v1/dataContracts') return send({ id: 'contract-1' });
    send({});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'woffles-consolidation-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ readOnly: false, instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'u', password: 'p' }] }),
  );
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests.length = 0;
});

async function load(extraConfig: Record<string, unknown> = {}) {
  const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  const path = join(dir, `config-${Object.keys(extraConfig).join('-') || 'base'}.json`);
  writeFileSync(path, JSON.stringify({ ...cfg, ...extraConfig }));
  vi.resetModules();
  process.env.COLLIBRA_CONFIG_PATH = path;
  return import('../src/tools/index.js');
}
const call = async (reg: any, name: string, args: object) => (await reg.executeTool(name, { instance_name: 'Mock', ...args })).structured as any;

describe('legacy tools', () => {
  it('are hidden from tools/list but still callable', async () => {
    const reg = await load();
    const listed = new Set(reg.tools.map((t: any) => t.name));
    for (const legacy of Object.keys(reg.LEGACY_TOOLS)) {
      expect(listed.has(legacy), legacy).toBe(false);
      expect(typeof reg.toolExecutors[legacy], legacy).toBe('function');
    }
    for (const canonical of ['get_lineage', 'get_asset_semantics', 'edit_asset', 'bulk_create_assets', 'prepare_create_asset']) {
      expect(listed.has(canonical), canonical).toBe(true);
    }
    const res = await call(reg, 'get_lineage_upstream', { entity_id: 'e1' });
    expect(res.direction).toBe('upstream');
  });

  it('are listed (marked legacy) when listLegacyTools is true', async () => {
    const reg = await load({ listLegacyTools: true });
    const t: any = reg.tools.find((x: any) => x.name === 'update_asset_attribute');
    expect(t.description).toMatch(/^\[Legacy — prefer edit_asset/);
  });
});

describe('consolidated tools', () => {
  it('get_lineage routes by direction', async () => {
    const reg = await load();
    await call(reg, 'get_lineage', { entity_id: 'e1', direction: 'downstream' });
    expect(requests.at(-1)!.path).toBe('/technical_lineage_resource/rest/lineageGraphRead/v1/entities/e1/downstream');
    const bad = await reg.executeTool('get_lineage', { instance_name: 'Mock', entity_id: 'e1', direction: 'sideways' }).catch((e: Error) => e);
    expect(String(bad)).toMatch(/direction must be one of: upstream, downstream/);
  });

  it('get_asset_semantics detects subtypes via the type hierarchy (Database View → table)', async () => {
    const reg = await load();
    const res = await call(reg, 'get_asset_semantics', { asset_id: VIEW });
    expect(res).toMatchObject({ kind: 'table', assetName: 'v_customers', assetType: 'Database View' });
  });

  it('get_asset_semantics reports unsupported asset types as an error', async () => {
    const reg = await load();
    const res = await call(reg, 'get_asset_semantics', { asset_id: ODD });
    expect(res.error).toBe(true);
    expect(res.message).toMatch(/not a Table, Column, Business Term or Measure/);
  });

  it('get_assessment accepts assessment_review_id (formerly get_assessment_by_review)', async () => {
    const reg = await load();
    const res = await call(reg, 'get_assessment', { assessment_review_id: REVIEW });
    expect(res).toMatchObject({ id: 'asm-1', lookedUpBy: 'assessmentReviewId' });
    const none = await reg.executeTool('get_assessment', { instance_name: 'Mock' }).catch((e: Error) => e);
    expect(String(none)).toMatch(/assessment_id|assessment_review_id/);
  });

  it('push_data_contract_manifest mode=init creates a contract; push requires a manifest', async () => {
    const reg = await load();
    const init = await call(reg, 'push_data_contract_manifest', { mode: 'init', governed_asset_id: PORT });
    expect(init.error).toBeUndefined();
    expect(requests.some((r) => r.method === 'POST' && r.path === '/rest/dataProduct/v1/dataContracts')).toBe(true);
    const push = await call(reg, 'push_data_contract_manifest', {});
    expect(push).toMatchObject({ error: true });
    expect(push.message).toMatch(/manifest is required for mode=push/);
  });
});
