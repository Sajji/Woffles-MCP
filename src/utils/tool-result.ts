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
