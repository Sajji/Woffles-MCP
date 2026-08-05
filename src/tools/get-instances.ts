import { getInstances, isReadOnly } from '../config.js';
import { ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';

export const getInstancesTool = {
  name: 'get_instances',
  description: 'List the Collibra instances configured in this server\'s config.json. Every other tool requires an ' +
    '"instance_name" argument — call this tool first (no arguments needed) to discover the valid values before ' +
    'calling any other tool.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetInstances(): Promise<ToolResult> {
  const instances = getInstances().map(instance => ({
    name: instance.name,
    baseUrl: instance.baseUrl,
    insecure: !!instance.insecure,
  }));

  return ok({ instances, readOnly: isReadOnly() });
}
