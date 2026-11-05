/**
 * Wraps a tool execution with audit logging and, for applied writes, a
 * pre-write snapshot of the affected assets (used by undo_write).
 */
import type { ToolResult } from '../types.js';
import { getAuditLog, getConfiguredSecrets, getInstance } from '../config.js';
import { CollibraClient } from './collibra-client.js';
import { redactSecrets } from './secrets.js';
import { failureMessage } from './tool-result.js';
import { sanitizeArgs, type AssetSnapshot } from './audit.js';
import { affectedAssetIds, createdAssetIds, isApplyCall, MAX_SNAPSHOT_ASSETS, snapshotAssets } from './write-snapshots.js';

export async function auditedExecute(
  tool: string,
  args: any,
  inputSchema: any,
  isWrite: boolean,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const log = getAuditLog();
  if (!log || (!isWrite && !log.settings.logReads)) return run();

  const apply = isWrite && isApplyCall(inputSchema, args);
  let instanceName: string | null = typeof args?.instance_name === 'string' ? args.instance_name : null;
  const userFor = (name: string | null) => {
    try {
      return name ? getInstance(name).username : null;
    } catch {
      return null;
    }
  };

  let before: AssetSnapshot[] | undefined;
  if (apply && instanceName) {
    const ids = affectedAssetIds(tool, args);
    if (ids.length && ids.length <= MAX_SNAPSHOT_ASSETS) {
      try {
        before = await snapshotAssets(new CollibraClient(getInstance(instanceName)), ids);
      } catch {
        before = undefined;
      }
    }
  }

  const secrets = getConfiguredSecrets();
  const redact = (s: string) => redactSecrets(s, secrets);
  const started = Date.now();
  const base = () => ({
    ts: new Date(started).toISOString(),
    tool,
    kind: (tool === 'undo_write' ? 'undo' : isWrite ? 'write' : 'read') as 'undo' | 'write' | 'read',
    mode: (apply || !isWrite ? 'apply' : 'preview') as 'apply' | 'preview',
    durationMs: Date.now() - started,
    args: sanitizeArgs(args ?? {}, redact),
  });

  let result: ToolResult;
  try {
    result = await run();
  } catch (error) {
    safeRecord(() =>
      log.record({
        ...base(),
        instance: instanceName,
        user: userFor(instanceName),
        outcome: 'error',
        error: redact((error as Error).message).slice(0, 1000),
        ...(before ? { before } : {}),
      }),
    );
    throw error;
  }

  const failure = failureMessage(result);
  const structured = result.structured as any;
  instanceName ??= typeof structured?.instance === 'string' ? structured.instance : null;
  const created = apply && !failure ? createdAssetIds(tool, structured) : [];
  const auditError = safeRecord(() =>
    log.record({
      ...base(),
      instance: instanceName,
      user: userFor(instanceName),
      outcome: failure ? 'error' : 'success',
      ...(failure ? { error: redact(failure).slice(0, 1000) } : {}),
      ...(before ? { before } : {}),
      ...(created.length ? { createdAssetIds: created } : {}),
      ...(tool === 'undo_write' && typeof args?.seq === 'number' ? { undoes: args.seq } : {}),
    }),
  );
  // The Collibra call already happened, so never turn it into a tool error (the agent might
  // retry a write); surface the audit failure alongside the real result instead.
  if (auditError && structured && typeof structured === 'object' && !Array.isArray(structured)) {
    const withWarning = { ...structured, auditWarning: `This call was NOT recorded in the audit log: ${auditError}` };
    return { text: JSON.stringify(withWarning), structured: withWarning };
  }
  return result;
}

/** Run an audit write; on failure report to stderr and return the message instead of throwing. */
function safeRecord(write: () => unknown): string | undefined {
  try {
    write();
    return undefined;
  } catch (error) {
    const message = (error as Error).message;
    console.error(`✗ AUDIT FAILURE: ${message}`);
    return message;
  }
}
