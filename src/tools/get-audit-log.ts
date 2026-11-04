import { ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getAuditLog, getAuditSettings } from '../config.js';
import { verifyChain, type AuditEntry } from '../utils/audit.js';
import { isUndoable } from '../utils/write-snapshots.js';

export const getAuditLogTool = {
  name: 'get_audit_log',
  description:
    "Read this MCP server's own audit trail: a local, tamper-evident log of the tool calls it has made against Collibra. " +
    'Each entry records who (the Collibra user), which tool, which instance, the arguments (secrets masked), whether it was a ' +
    'preview or a real write, the outcome, and timing. Entries are hash-chained, so editing or deleting a line is detectable: ' +
    'pass verify=true to check the chain. ' +
    'Use it to answer "what did the assistant change today?", "which writes failed?", or "can I undo that bulk update?". ' +
    'Entries marked undoable can be reverted with undo_write by their seq number. ' +
    'This is NOT the Collibra activity stream (use get_activities for changes made by anyone through any channel). ' +
    'Returns an error when auditing is disabled (enable it with "audit": {"enabled": true} in config.json, or complianceMode). ' +
    'Read-only; does not call Collibra.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum entries to return, newest first. Default 20, max 500.', default: 20 },
      tool: { type: 'string', description: 'Only entries for this tool name, e.g. "edit_asset".' },
      instance_name: { type: 'string', description: 'Only entries for this configured Collibra instance name.' },
      writes_only: { type: 'boolean', description: 'Only applied writes and undos (skip previews and reads). Default false.', default: false },
      seq: { type: 'number', description: 'Return just the entry with this sequence number, including its full pre-write snapshot.' },
      verify: { type: 'boolean', description: 'Also verify the hash chain of the current audit file. Default false.', default: false },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    description: 'Audit entries (newest first) plus optional chain verification.',
    additionalProperties: true,
  },
};

/** Summarize an entry for listing: snapshots are reduced to counts to keep output small. */
function summarize(e: AuditEntry) {
  const { before, prevHash: _p, hash, ...rest } = e;
  return {
    ...rest,
    snapshotAssets: before?.length ?? 0,
    undoable: isUndoable(e),
    hash: hash.slice(0, 16),
  };
}

export async function executeGetAuditLog(args: any): Promise<ToolResult> {
  const log = getAuditLog();
  if (!log) {
    return ok({
      error: true,
      status: 'validation_error',
      message:
        'Auditing is disabled on this server. Enable it with "audit": {"enabled": true} in config.json ' +
        '(it is always on when complianceMode is set).',
    });
  }

  const entries = log.readAll();
  const verification = args.verify ? verifyChain(getAuditSettings().path) : undefined;

  if (typeof args.seq === 'number') {
    const entry = entries.find((e) => e.seq === args.seq);
    if (!entry) {
      return ok({ error: true, status: 'not_found', message: `No audit entry with seq ${args.seq} in the current audit file.` });
    }
    return ok({ entry: { ...entry, undoable: isUndoable(entry) }, verification });
  }

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 500);
  const filtered = entries
    .filter((e) => !args.tool || e.tool === args.tool)
    .filter((e) => !args.instance_name || e.instance === args.instance_name)
    .filter((e) => !args.writes_only || ((e.kind === 'write' || e.kind === 'undo') && e.mode === 'apply'))
    .reverse();

  return ok({
    path: getAuditSettings().path,
    total: filtered.length,
    returned: Math.min(limit, filtered.length),
    entries: filtered.slice(0, limit).map(summarize),
    verification,
  });
}
