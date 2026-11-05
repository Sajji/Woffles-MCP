import { getInstance } from '../config.js';
import type { CollibraInstance, ToolResult } from '../types.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * Resolve a configured instance by name and a client for it. Throws for an
 * unknown instance; the dispatcher turns that into a standard error result.
 */
export function clientFor(instanceName: string): { instance: CollibraInstance; client: CollibraClient } {
  const instance = getInstance(instanceName);
  return { instance, client: new CollibraClient(instance) };
}

/**
 * The standard error result for an exception thrown by a tool executor. Tools
 * don't need their own try/catch: the dispatcher (executeTool) converts any
 * thrown error into this shape, which is flagged as MCP isError.
 */
export function errorResult(error: unknown, args: any): ToolResult {
  const structured = {
    error: true,
    message: (error as Error)?.message ?? String(error),
    ...(typeof args?.instance_name === 'string' ? { instance: args.instance_name } : {}),
  };
  return { text: JSON.stringify(structured), structured };
}
