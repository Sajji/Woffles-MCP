/**
 * End-to-end: a confirmed write is audited with a pre-write snapshot, and
 * undo_write restores it. Runs against an in-process mock of the Collibra
 * REST endpoints involved, so it never touches a real instance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DESC = '00000000-0000-0000-0000-000000003114';
const ASSET = 'a0000000-0000-0000-0000-000000000001';

const state = {
  asset: { id: ASSET, name: 'Customer Table', displayName: 'Customer Table', status: { id: 's1' }, type: { id: 't1' }, domain: { id: 'd1' } },
  attributes: [{ id: 'attr-1', type: { id: DESC, name: 'Description' }, value: 'original description' }],
};

let server: Server;
let dir: string;
let registry: typeof import('../src/tools/index.js');
let config: typeof import('../src/config.js');

const readJson = (req: any): Promise<any> =>
  new Promise((r) => {
    let b = '';
    req.on('data', (d: any) => (b += d));
    req.on('end', () => r(b ? JSON.parse(b) : undefined));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const send = (body: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === `/rest/2.0/assets/${ASSET}`) return send(state.asset);
    if (req.method === 'GET' && url.pathname === '/rest/2.0/attributes') {
      const typeIds = url.searchParams.getAll('typeIds');
      const results = state.attributes.filter((a) => !typeIds.length || typeIds.includes(a.type.id));
      return send({ results, total: results.length });
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/rest/2.0/attributes/')) {
      const body = await readJson(req);
      const attr = state.attributes.find((a) => a.id === body.id)!;
      attr.value = body.value;
      return send(attr);
    }
    if (req.method === 'PUT' && url.pathname === `/rest/2.0/assets/${ASSET}/attributes`) {
      const body = await readJson(req);
      state.attributes = [
        ...state.attributes.filter((a) => a.type.id !== body.typeId),
        ...body.values.map((v: unknown, i: number) => ({ id: `restored-${i}`, type: { id: body.typeId }, value: v })),
      ];
      return send([]);
    }
    send({ statusCode: 404 }, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  dir = mkdtempSync(join(tmpdir(), 'woffles-e2e-'));
  const cfgPath = join(dir, 'config.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      readOnly: false,
      audit: { enabled: true },
      instances: [
        { name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'svc', password: 'mock-password' },
      ],
    }),
  );
  process.env.COLLIBRA_CONFIG_PATH = cfgPath;
  registry = await import('../src/tools/index.js');
  config = await import('../src/config.js');
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (name: string, args: object) => (await registry.executeTool(name, args)).structured as any;

describe('audited write + undo', () => {
  it('logs the audit file next to config.json by default', () => {
    expect(config.getAuditSettings().path).toBe(join(dir, 'logs', 'audit.jsonl'));
  });

  it('records a preview without a snapshot', async () => {
    await call('update_asset_description', { instance_name: 'Mock', asset_id: ASSET, new_description: 'new' });
    const log = await call('get_audit_log', { limit: 1 });
    expect(log.entries[0]).toMatchObject({ tool: 'update_asset_description', mode: 'preview', outcome: 'success', undoable: false });
  });

  it('snapshots, applies, and then undoes a confirmed write', async () => {
    const applied = await call('update_asset_description', { instance_name: 'Mock', asset_id: ASSET, new_description: 'changed by AI', confirm: true });
    expect(applied.mode).toBe('APPLIED');
    expect(state.attributes[0].value).toBe('changed by AI');

    const log = await call('get_audit_log', { writes_only: true, limit: 1 });
    const entry = log.entries[0];
    expect(entry).toMatchObject({ tool: 'update_asset_description', mode: 'apply', user: 'svc', instance: 'Mock', undoable: true, snapshotAssets: 1 });

    const preview = await call('undo_write', { seq: entry.seq });
    expect(preview.mode).toBe('PREVIEW');
    expect(preview.actions).toEqual([
      { assetId: ASSET, action: 'set_attribute_values', typeId: DESC, from: ['changed by AI'], to: ['original description'] },
    ]);
    expect(state.attributes[0].value).toBe('changed by AI');

    const done = await call('undo_write', { seq: entry.seq, confirm: true });
    expect(done).toMatchObject({ mode: 'APPLIED', applied: 1, errors: [] });
    expect(state.attributes.find((a) => a.type.id === DESC)!.value).toBe('original description');

    const again = await call('undo_write', { seq: entry.seq, confirm: true });
    expect(again.message).toMatch(/already undone/);
  });

  it('keeps a valid hash chain and never logs the password', async () => {
    const log = await call('get_audit_log', { verify: true, limit: 500 });
    expect(log.verification.ok).toBe(true);
    expect(JSON.stringify(log)).not.toContain('mock-password');
    expect(log.entries.some((e: any) => e.kind === 'undo' && e.mode === 'apply')).toBe(true);
  });

  it('does not log reads unless logReads is set', async () => {
    const before = (await call('get_audit_log', { limit: 500 })).total;
    await call('get_audit_log', { limit: 1 });
    expect((await call('get_audit_log', { limit: 500 })).total).toBe(before);
  });
});
