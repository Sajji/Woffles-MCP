import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getAuditLog, getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { applyRestore, isUndoable, planRestore } from '../utils/write-snapshots.js';

export const undoWriteTool = {
  name: 'undo_write',
  description:
    'Revert a write that this MCP server made earlier, using the pre-write snapshot stored in its audit log (see get_audit_log). ' +
    'Supported: restoring asset names, display names, statuses and attribute values changed by update_asset_description, ' +
    'update_asset_attribute, bulk_update_asset_descriptions, bulk_update_asset_attributes and edit_asset; and deleting assets ' +
    'created by create_asset, add_business_term and bulk_create_assets. Not reverted: relations, tags, responsibilities, ' +
    'deletions, workflows, assessments and operating-model changes. ' +
    'The restore is computed against the CURRENT state, so later edits made by anyone to the same attributes are overwritten ' +
    'with the snapshot values. Review the preview with the user first. ' +
    'Two-step safety: confirm=false (default) returns the exact list of changes without writing; confirm=true applies them. ' +
    'Example requests: "undo the last bulk description update", "revert audit entry 42". ' +
    'Requires auditing to be enabled and edit/delete permission on the affected assets.',
  inputSchema: {
    type: 'object',
    properties: {
      seq: { type: 'number', description: 'Required. Sequence number of the audit entry to revert (from get_audit_log).' },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview of the restore actions. Set true to apply them.',
        default: false,
      },
    },
    required: ['seq'],
  },
  outputSchema: {
    type: 'object',
    description: 'PREVIEW: planned restore actions. APPLIED: count applied plus any per-action errors.',
    additionalProperties: true,
  },
};

export async function executeUndoWrite(args: any): Promise<ToolResult> {
  const log = getAuditLog();
  if (!log) {
    return ok({ error: true, status: 'validation_error', message: 'Auditing is disabled, so there are no snapshots to undo from. Enable "audit" in config.json.' });
  }
  if (typeof args.seq !== 'number') {
    return ok({ error: true, status: 'validation_error', message: 'seq is required: the audit entry number to revert (see get_audit_log).' });
  }

  const entry = log.find(args.seq);
  if (!entry) {
    return ok({ error: true, status: 'not_found', message: `No audit entry with seq ${args.seq} in the current audit file.` });
  }
  if (!isUndoable(entry)) {
    return ok({
      error: true,
      status: 'validation_error',
      message:
        `Audit entry ${args.seq} (${entry.tool}, ${entry.mode}, ${entry.outcome}) cannot be undone. Only successful applied writes ` +
        'from update/edit tools with a pre-write snapshot, or create tools that recorded created asset IDs, are undoable.',
    });
  }
  const alreadyUndone = log.readAll().find((e) => e.kind === 'undo' && e.undoes === entry.seq && e.mode === 'apply' && e.outcome === 'success');
  if (alreadyUndone) {
    return ok({ error: true, status: 'validation_error', message: `Audit entry ${entry.seq} was already undone by entry ${alreadyUndone.seq}.` });
  }
  if (!entry.instance) {
    return ok({ error: true, status: 'validation_error', message: `Audit entry ${entry.seq} has no instance recorded.` });
  }

  const client = new CollibraClient(getInstance(entry.instance));
  const { actions, notes } = await planRestore(client, entry);

  if (args.confirm !== true) {
    return okPretty({
      mode: 'PREVIEW',
      undoes: entry.seq,
      originalTool: entry.tool,
      originalTimestamp: entry.ts,
      instance: entry.instance,
      actions,
      notes,
      instructions: actions.length
        ? 'Review these changes with the user. Call undo_write again with confirm=true to apply them.'
        : 'Nothing to restore: the assets already match the snapshot.',
    });
  }

  const { applied, errors } = await applyRestore(client, actions);
  return okPretty({
    mode: 'APPLIED',
    undoes: entry.seq,
    instance: entry.instance,
    planned: actions.length,
    applied,
    errors,
    notes,
    ...(errors.length ? { error: applied === 0, status: applied === 0 ? 'error' : 'partial' } : {}),
  });
}
