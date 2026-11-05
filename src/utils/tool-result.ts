import type { ToolResult } from '../types.js';

/**
 * Wrap a structured payload as a {@link ToolResult}: serializes JSON for the
 * human-readable text block and forwards the same object to MCP
 * `structuredContent`. Use this for compact, single-line JSON output.
 */
export function ok(structured: unknown): ToolResult {
  return { text: JSON.stringify(structured), structured };
}

/**
 * Same as {@link ok} but pretty-prints the text block (2-space indent).
 * Use for write tools / previews where readability matters.
 */
export function okPretty(structured: unknown): ToolResult {
  return { text: JSON.stringify(structured, null, 2), structured };
}

/**
 * Attach `nextActions` to an existing structured payload without otherwise
 * changing its shape. Use this to retrofit legacy tools incrementally so the
 * agent gets workflow guidance while existing clients keep working.
 */
export function okWithNext(structured: Record<string, unknown>, nextActions: NextAction[], pretty = false): ToolResult {
  const merged = { ...structured, nextActions };
  return pretty
    ? { text: JSON.stringify(merged, null, 2), structured: merged }
    : { text: JSON.stringify(merged), structured: merged };
}

/**
 * Standard envelope shape that all model-aware tools should emit so the
 * agent can reason about responses uniformly: instance + operation context,
 * the actual data, optional pagination/summary, and a list of suggested
 * `nextActions` describing legal follow-up tool calls.
 *
 * `nextActions` is computed from the live model and never hardcoded with
 * customer-specific names/UUIDs — this keeps the contract portable across
 * Collibra deployments.
 */
export interface NextAction {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

export interface ToolEnvelope<T> {
  instance: string;
  operation: string;
  model?: { snapshotHash?: string; stale?: boolean; refreshedAt?: string };
  data: T;
  summary?: Record<string, unknown>;
  pagination?: { offset?: number; limit?: number; nextOffset?: number; total?: number };
  nextActions?: NextAction[];
  warnings?: string[];
  errors?: string[];
}

export interface EnvelopeOptions<T> {
  instance: string;
  operation: string;
  data: T;
  model?: ToolEnvelope<T>['model'];
  summary?: Record<string, unknown>;
  pagination?: ToolEnvelope<T>['pagination'];
  nextActions?: NextAction[];
  warnings?: string[];
  errors?: string[];
  pretty?: boolean;
}

/**
 * Build a standardized envelope and return it as a {@link ToolResult}.
 * New tools should prefer this over {@link ok}/{@link okPretty} so that
 * downstream agents see a consistent shape including `nextActions`.
 */
export function withEnvelope<T>(opts: EnvelopeOptions<T>): ToolResult {
  const envelope: ToolEnvelope<T> = {
    instance: opts.instance,
    operation: opts.operation,
    data: opts.data,
  };
  if (opts.model) envelope.model = opts.model;
  if (opts.summary) envelope.summary = opts.summary;
  if (opts.pagination) envelope.pagination = opts.pagination;
  if (opts.nextActions && opts.nextActions.length) envelope.nextActions = opts.nextActions;
  if (opts.warnings && opts.warnings.length) envelope.warnings = opts.warnings;
  if (opts.errors && opts.errors.length) envelope.errors = opts.errors;
  return opts.pretty
    ? { text: JSON.stringify(envelope, null, 2), structured: envelope }
    : { text: JSON.stringify(envelope), structured: envelope };
}

/**
 * Standard error envelope: same shape as {@link withEnvelope} but with
 * `errors` populated and an empty `data`.
 */
export function errorEnvelope(opts: {
  instance: string;
  operation: string;
  message: string;
  data?: unknown;
}): ToolResult {
  return withEnvelope({
    instance: opts.instance,
    operation: opts.operation,
    data: opts.data ?? null,
    errors: [opts.message],
    pretty: true,
  });
}
