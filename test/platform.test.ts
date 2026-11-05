/**
 * Phase 1 platform tests: input validation, failure detection (isError),
 * alias-aware tool toggles, GraphQL variables (no query injection), and
 * descriptive HTTP errors. Uses an in-process mock; never touches a real instance.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { normalizeInputSchema, validateToolArgs, UUID_PATTERN } from '../src/utils/validation.js';
import { failureMessage } from '../src/utils/tool-result.js';

const ASSET = 'aaaaaaaa-0000-0000-0000-000000000001';
const graphqlBodies: any[] = [];

let server: Server;
let dir: string;
let cfgPath: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      const json = (body: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      };
      if (url.pathname === '/graphql/knowledgeGraph/v1') {
        graphqlBodies.push(JSON.parse(raw));
        return json({ data: { assets: [] } });
      }
      if (url.pathname === '/rest/2.0/html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html></html>');
      if (url.pathname === '/rest/2.0/denied') return json({ userMessage: 'You need the X permission' }, 403);
      json({ statusCode: 404, userMessage: 'Not here' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'woffles-platform-'));
  cfgPath = join(dir, 'config.json');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      readOnly: true,
      instances: [{ name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, username: 'svc', password: 'pw' }],
    }),
  );
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

/** Re-import the registry with fresh config state and the given env overrides. */
async function loadRegistry(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env.COLLIBRA_CONFIG_PATH = cfgPath;
  for (const k of ['COLLIBRA_ENABLED_TOOLS', 'COLLIBRA_DISABLED_TOOLS']) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/tools/index.js');
}

describe('schema normalization and argument validation', () => {
  const schema = normalizeInputSchema({
    type: 'object',
    properties: {
      asset_id: { type: 'string' },
      asset_ids: { type: 'array', items: { type: 'string' } },
      entity_id: { type: 'string' },
      limit: { type: 'number' },
      relation_offset: { type: 'number' },
      mode: { type: 'string', enum: ['a', 'b'] },
    },
    required: ['asset_id'],
  });

  it('adds UUID patterns only to known Core REST id parameters', () => {
    expect(schema.properties.asset_id.pattern).toBe(UUID_PATTERN);
    expect((schema.properties.asset_ids as any).items.pattern).toBe(UUID_PATTERN);
    expect((schema.properties.entity_id as any).pattern).toBeUndefined();
  });

  it('bounds limit and offset parameters', () => {
    expect(schema.properties.limit).toMatchObject({ minimum: 1, maximum: 1000 });
    expect(schema.properties.relation_offset).toMatchObject({ minimum: 0 });
  });

  it('coerces scalar types and returns a copy', () => {
    const input = { asset_id: ASSET, limit: '25' };
    const out = validateToolArgs('t1', schema, input);
    expect(out.limit).toBe(25);
    expect(input.limit).toBe('25');
  });

  it('rejects bad UUIDs, out-of-range limits and unknown enum values with readable messages', () => {
    expect(() => validateToolArgs('t2', schema, { asset_id: 'nope' })).toThrow(/asset_id must be a UUID/);
    expect(() => validateToolArgs('t3', schema, { asset_id: ASSET, limit: 5000 })).toThrow(/limit must be <= 1000/);
    expect(() => validateToolArgs('t4', schema, { asset_id: ASSET, mode: 'c' })).toThrow(/mode must be one of: a, b/);
    expect(() => validateToolArgs('t5', schema, {})).toThrow(/missing required argument "asset_id"/);
  });
});

describe('failureMessage (drives MCP isError)', () => {
  const r = (structured: unknown) => ({ text: '', structured });
  it('detects every failure shape', () => {
    expect(failureMessage(r({ error: true, message: 'boom' }))).toBe('boom');
    expect(failureMessage(r({ error: 'bad input' }))).toBe('bad input');
    expect(failureMessage(r({ success: false, message: 'nope' }))).toBe('nope');
    expect(failureMessage(r({ data: null, errors: ['env failure'] }))).toBe('env failure');
    expect(failureMessage(r({ mode: 'APPLIED', appliedActions: [], errors: [{ error: 'all ops failed' }] }))).toBe('all ops failed');
  });
  it('treats successes and partial applies as non-failures', () => {
    expect(failureMessage(r({ data: { x: 1 }, errors: ['source down'] }))).toBeUndefined();
    expect(failureMessage(r({ status: 'partial', error: true }))).toBeUndefined();
    expect(failureMessage(r({ mode: 'APPLIED', appliedActions: [{}], errors: [{ error: 'one failed' }] }))).toBeUndefined();
    expect(failureMessage(r({ results: [] }))).toBeUndefined();
  });
});

describe('alias-aware tool toggles', () => {
  it('denylisting the canonical tool hides and blocks its alias', async () => {
    const reg = await loadRegistry({ COLLIBRA_DISABLED_TOOLS: 'get_asset_by_id' });
    const names = reg.tools.map((t) => t.name);
    expect(names).not.toContain('get_asset_by_id');
    expect(names).not.toContain('get_asset_details');
    await expect(reg.executeTool('get_asset_details', { instance_name: 'Mock', asset_id: ASSET })).rejects.toThrow(/disabled/);
  });

  it('denylisting only the alias keeps the canonical tool', async () => {
    const reg = await loadRegistry({ COLLIBRA_DISABLED_TOOLS: 'get_asset_details' });
    const names = reg.tools.map((t) => t.name);
    expect(names).toContain('get_asset_by_id');
    expect(names).not.toContain('get_asset_details');
  });

  it('allowlisting the canonical tool also allows its alias', async () => {
    const reg = await loadRegistry({ COLLIBRA_ENABLED_TOOLS: 'get_asset_by_id' });
    expect(reg.tools.map((t) => t.name).sort()).toEqual(['get_asset_by_id', 'get_asset_details']);
  });

  it('advertises the central constraints in tools/list', async () => {
    const reg = await loadRegistry();
    const tool: any = reg.tools.find((t) => t.name === 'get_asset_by_id');
    expect(tool.inputSchema.properties.asset_id.pattern).toBe(UUID_PATTERN);
  });
});

describe('GraphQL inputs travel as variables', () => {
  it('query_assets never splices the asset type name into the query', async () => {
    const reg = await loadRegistry();
    const evil = 'Business Term") { id } }';
    await reg.executeTool('query_assets', { instance_name: 'Mock', asset_type_name: evil, limit: 5 });
    const body = graphqlBodies.at(-1);
    expect(body.query).not.toContain(evil);
    expect(body.variables).toEqual({ limit: 5, offset: 0, where: { type: { name: { eq: evil } } } });
  });

  it('get_asset_by_id passes the id as a variable', async () => {
    const reg = await loadRegistry();
    await reg.executeTool('get_asset_by_id', { instance_name: 'Mock', asset_id: ASSET });
    const body = graphqlBodies.find((b) => b.query.includes('AssetDetails'));
    expect(body.query).not.toContain(ASSET);
    expect(body.variables.id).toBe(ASSET);
  });
});

describe('descriptive HTTP errors', () => {
  it('keeps the HTTP status and Collibra userMessage, and explains HTML bodies', async () => {
    await loadRegistry();
    const { CollibraClient, CollibraHttpError } = await import('../src/utils/collibra-client.js');
    const { getInstance } = await import('../src/config.js');
    const client = new CollibraClient(getInstance('Mock'));

    const denied = await client.restCall('/rest/2.0/denied').catch((e) => e);
    expect(denied).toBeInstanceOf(CollibraHttpError);
    expect(denied.status).toBe(403);
    expect(denied.message).toMatch(/You need the X permission/);

    const missing = await client.restCall('/rest/2.0/missing').catch((e) => e);
    expect(missing.status).toBe(404);
    expect(missing.message).toMatch(/Not here/);

    const html = await client.restCall('/rest/2.0/html').catch((e) => e);
    expect(html.message).toMatch(/HTML page instead of JSON/);
  });
});
