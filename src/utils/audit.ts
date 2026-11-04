/**
 * Tamper-evident audit trail (JSONL, SHA-256 hash chain).
 *
 * Every write tool call is recorded (reads optionally) with who / what /
 * where / outcome. Each entry stores the previous entry's hash and its own
 * hash over (prevHash + entry), so editing, deleting or reordering any line
 * breaks verification from that point on. The chain continues across rotated
 * files. Aligned with NIST SP 800-53 AU-2/AU-3 (content), AU-9 (protection)
 * and AU-11 (retention via rotation + SIEM file ingestion).
 *
 * One process should own an audit file: concurrent server processes writing
 * the same file would interleave chains. Give each deployment its own path.
 */
import { createHash } from 'crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';

export const GENESIS_HASH = '0'.repeat(64);
const MAX_STRING = 2000;

export interface AuditSettings {
  enabled: boolean;
  path: string;
  logReads: boolean;
  maxBytes: number;
}

export interface AuditEntry {
  v: 1;
  seq: number;
  ts: string;
  instance: string | null;
  user: string | null;
  tool: string;
  kind: 'read' | 'write' | 'undo';
  mode: 'apply' | 'preview';
  outcome: 'success' | 'error';
  durationMs: number;
  args: unknown;
  error?: string;
  /** Pre-write state of affected assets (enables undo). */
  before?: AssetSnapshot[];
  /** IDs of assets created by the call (enables undo). */
  createdAssetIds?: string[];
  /** For kind 'undo': the seq of the entry that was reverted. */
  undoes?: number;
  prevHash: string;
  hash: string;
}

export interface AssetSnapshot {
  id: string;
  name: string;
  displayName: string | null;
  statusId: string | null;
  typeId: string | null;
  domainId: string | null;
  attributes: { typeId: string; value: unknown }[];
  error?: string;
}

export function hashEntry(prevHash: string, body: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(prevHash).update(JSON.stringify(body)).digest('hex');
}

/** Copy args for the log: strings capped, secrets masked by the caller's redactor. */
export function sanitizeArgs(value: unknown, redact: (s: string) => string): unknown {
  if (typeof value === 'string') {
    const r = redact(value);
    return r.length > MAX_STRING ? `${r.slice(0, MAX_STRING)}…[truncated ${r.length - MAX_STRING} chars]` : r;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeArgs(v, redact));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeArgs(v, redact)]));
  }
  return value;
}

/** Read the last non-empty line of a file without loading all of it. */
function readLastLine(path: string): string | null {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  if (size === 0) return null;
  const fd = openSync(path, 'r');
  try {
    let chunk = 64 * 1024;
    while (true) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf-8').split('\n').filter((l) => l.trim());
      if (lines.length > 1 || start === 0) return lines.at(-1) ?? null;
      chunk *= 4;
    }
  } finally {
    closeSync(fd);
  }
}

export class AuditLog {
  private seq = 0;
  private prevHash = GENESIS_HASH;
  private initialized = false;

  constructor(readonly settings: AuditSettings) {}

  private init(): void {
    if (this.initialized) return;
    mkdirSync(dirname(this.settings.path), { recursive: true });
    const last = readLastLine(this.settings.path);
    if (last) {
      const entry = JSON.parse(last) as AuditEntry;
      this.seq = entry.seq;
      this.prevHash = entry.hash;
    }
    this.initialized = true;
  }

  private rotateIfNeeded(): void {
    const { path, maxBytes } = this.settings;
    if (maxBytes > 0 && existsSync(path) && statSync(path).size >= maxBytes) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      renameSync(path, join(dirname(path), `${basename(path, '.jsonl')}-${stamp}.jsonl`));
    }
  }

  /** Append an entry; seq / prevHash / hash are assigned here. Returns the stored entry. */
  record(fields: Omit<AuditEntry, 'v' | 'seq' | 'prevHash' | 'hash'>): AuditEntry {
    this.init();
    this.rotateIfNeeded();
    const body: Omit<AuditEntry, 'hash'> = { v: 1, seq: this.seq + 1, ...fields, prevHash: this.prevHash };
    const entry: AuditEntry = { ...body, hash: hashEntry(this.prevHash, body) };
    appendFileSync(this.settings.path, JSON.stringify(entry) + '\n', { encoding: 'utf-8', mode: 0o600 });
    this.seq = entry.seq;
    this.prevHash = entry.hash;
    return entry;
  }

  /** All entries in the current file (rotated files are not included). */
  readAll(): AuditEntry[] {
    if (!existsSync(this.settings.path)) return [];
    return readFileSync(this.settings.path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuditEntry);
  }

  find(seq: number): AuditEntry | undefined {
    return this.readAll().find((e) => e.seq === seq);
  }
}

export interface ChainVerification {
  ok: boolean;
  entries: number;
  firstSeq: number | null;
  lastSeq: number | null;
  /** First line (1-based) that fails verification. */
  brokenAtLine?: number;
  reason?: string;
}

/**
 * Verify a file's hash chain. The first entry's prevHash is trusted as the
 * anchor (genesis, or the tail of the previous rotated file).
 */
export function verifyChain(path: string): ChainVerification {
  if (!existsSync(path)) return { ok: true, entries: 0, firstSeq: null, lastSeq: null };
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim());
  let prev: AuditEntry | null = null;
  for (let i = 0; i < lines.length; i++) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      return { ok: false, entries: lines.length, firstSeq: null, lastSeq: null, brokenAtLine: i + 1, reason: 'unparseable line' };
    }
    const { hash, ...body } = entry;
    const fail = (reason: string): ChainVerification => ({
      ok: false,
      entries: lines.length,
      firstSeq: JSON.parse(lines[0]).seq ?? null,
      lastSeq: null,
      brokenAtLine: i + 1,
      reason,
    });
    if (prev && entry.prevHash !== prev.hash) return fail('prevHash does not match the previous entry');
    if (prev && entry.seq !== prev.seq + 1) return fail('sequence gap');
    if (hashEntry(entry.prevHash, body) !== hash) return fail('entry content does not match its hash');
    prev = entry;
  }
  return {
    ok: true,
    entries: lines.length,
    firstSeq: lines.length ? JSON.parse(lines[0]).seq : null,
    lastSeq: prev?.seq ?? null,
  };
}
