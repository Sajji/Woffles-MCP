import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuditLog, GENESIS_HASH, sanitizeArgs, verifyChain } from '../src/utils/audit.js';
import { affectedAssetIds, createdAssetIds, isApplyCall, isUndoable, planRestore } from '../src/utils/write-snapshots.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'woffles-audit-'));
  path = join(dir, 'audit.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fields = (tool: string, extra: object = {}) => ({
  ts: new Date().toISOString(),
  instance: 'Prod',
  user: 'svc',
  tool,
  kind: 'write' as const,
  mode: 'apply' as const,
  outcome: 'success' as const,
  durationMs: 5,
  args: { instance_name: 'Prod' },
  ...extra,
});

describe('AuditLog hash chain', () => {
  it('chains entries from the genesis hash and verifies', () => {
    const log = new AuditLog({ enabled: true, path, logReads: false, maxBytes: 0 });
    const a = log.record(fields('edit_asset'));
    const b = log.record(fields('create_asset'));
    expect(a.seq).toBe(1);
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(verifyChain(path)).toMatchObject({ ok: true, entries: 2, firstSeq: 1, lastSeq: 2 });
  });

  it('detects an edited entry', () => {
    const log = new AuditLog({ enabled: true, path, logReads: false, maxBytes: 0 });
    log.record(fields('edit_asset'));
    log.record(fields('create_asset'));
    writeFileSync(path, readFileSync(path, 'utf-8').replace('"user":"svc"', '"user":"someone-else"'));
    const v = verifyChain(path);
    expect(v.ok).toBe(false);
    expect(v.brokenAtLine).toBe(1);
  });

  it('detects a deleted entry', () => {
    const log = new AuditLog({ enabled: true, path, logReads: false, maxBytes: 0 });
    for (const t of ['a', 'b', 'c']) log.record(fields(t));
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n');
    expect(verifyChain(path)).toMatchObject({ ok: false, brokenAtLine: 2 });
  });

  it('resumes the chain after a restart', () => {
    new AuditLog({ enabled: true, path, logReads: false, maxBytes: 0 }).record(fields('a'));
    const second = new AuditLog({ enabled: true, path, logReads: false, maxBytes: 0 }).record(fields('b'));
    expect(second.seq).toBe(2);
    expect(verifyChain(path).ok).toBe(true);
  });

  it('rotates when the file exceeds maxBytes and continues the chain', () => {
    const log = new AuditLog({ enabled: true, path, logReads: false, maxBytes: 200 });
    const first = log.record(fields('a'));
    const second = log.record(fields('b'));
    expect(readdirSync(dir).length).toBe(2);
    expect(second.prevHash).toBe(first.hash);
    expect(verifyChain(path).ok).toBe(true);
  });
});

describe('sanitizeArgs', () => {
  it('masks secrets and truncates very long strings', () => {
    const out: any = sanitizeArgs({ note: 'pw=hunter22', manifest: 'x'.repeat(5000), n: 3 }, (s) => s.replace('hunter22', '***'));
    expect(out.note).toBe('pw=***');
    expect(out.manifest.length).toBeLessThan(2100);
    expect(out.manifest).toMatch(/truncated 3000 chars/);
    expect(out.n).toBe(3);
  });
});

describe('planRestore', () => {
  const fakeClient = (now: { attributes: { typeId: string; value: unknown }[] }) =>
    ({
      restCall: async () => ({ id: 'a1', name: 'A', displayName: 'A', status: { id: 's' }, type: { id: 't' }, domain: { id: 'd' } }),
      getAssetAttributes: async () => now.attributes.map((a, i) => ({ id: `x${i}`, typeName: null, kind: null, ...a })),
    }) as any;

  it('flattens multi-value list attributes instead of nesting arrays', async () => {
    const entry: any = {
      tool: 'edit_asset',
      before: [{ id: 'a1', name: 'A', displayName: 'A', statusId: 's', typeId: 't', domainId: 'd', attributes: [{ typeId: 'mv', value: ['Passing', 'Reviewed'] }] }],
    };
    const { actions } = await planRestore(fakeClient({ attributes: [{ typeId: 'mv', value: ['Failing'] }] }), entry);
    expect(actions).toEqual([{ assetId: 'a1', action: 'set_attribute_values', typeId: 'mv', from: ['Failing'], to: ['Passing', 'Reviewed'] }]);
  });

  it('treats a reordered multi-value list as unchanged and clears added attribute types', async () => {
    const entry: any = {
      tool: 'edit_asset',
      before: [{ id: 'a1', name: 'A', displayName: 'A', statusId: 's', typeId: 't', domainId: 'd', attributes: [{ typeId: 'mv', value: ['x', 'y'] }] }],
    };
    const { actions } = await planRestore(
      fakeClient({ attributes: [{ typeId: 'mv', value: ['y', 'x'] }, { typeId: 'note', value: 'added later' }] }),
      entry,
    );
    expect(actions).toEqual([{ assetId: 'a1', action: 'set_attribute_values', typeId: 'note', from: ['added later'], to: [] }]);
  });
});

describe('write snapshot helpers', () => {
  it('finds affected assets for single and bulk updates', () => {
    expect(affectedAssetIds('edit_asset', { asset_id: 'a1' })).toEqual(['a1']);
    expect(affectedAssetIds('bulk_update_asset_descriptions', { updates: [{ asset_id: 'a1' }, { asset_id: 'a2' }, { asset_id: 'a1' }] })).toEqual([
      'a1',
      'a2',
    ]);
    expect(affectedAssetIds('create_asset', { name: 'x' })).toEqual([]);
  });

  it('extracts created asset IDs from create tool results', () => {
    expect(createdAssetIds('create_asset', { asset: { id: 'n1' } })).toEqual(['n1']);
    expect(createdAssetIds('add_business_term', { businessTerm: { id: 'n2' } })).toEqual(['n2']);
    expect(
      createdAssetIds('bulk_create_assets', { details: [{ action: 'CREATED', assetId: 'n3' }, { action: 'SKIPPED (existing)', existingAssetId: 'x' }] }),
    ).toEqual(['n3']);
  });

  it('treats confirm-gated tools as preview unless confirm is true', () => {
    const schema = { properties: { confirm: {} } };
    expect(isApplyCall(schema, {})).toBe(false);
    expect(isApplyCall(schema, { confirm: true })).toBe(true);
    expect(isApplyCall({ properties: { dry_run: {} } }, { dry_run: true })).toBe(false);
    expect(isApplyCall({ properties: {} }, {})).toBe(true);
  });

  it('marks only successful applied writes with a snapshot or created IDs as undoable', () => {
    const e: any = { ...fields('edit_asset'), v: 1, seq: 1, prevHash: '', hash: '' };
    expect(isUndoable({ ...e, before: [{ id: 'a' }] })).toBe(true);
    expect(isUndoable({ ...e, before: [] })).toBe(false);
    expect(isUndoable({ ...e, mode: 'preview', before: [{ id: 'a' }] })).toBe(false);
    expect(isUndoable({ ...e, tool: 'bulk_delete_assets', before: [{ id: 'a' }] })).toBe(false);
    expect(isUndoable({ ...e, tool: 'create_asset', createdAssetIds: ['n'] })).toBe(true);
  });
});
