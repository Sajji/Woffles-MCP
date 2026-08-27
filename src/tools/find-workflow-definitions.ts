import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findWorkflowDefinitionsTool = {
  name: 'find_workflow_definitions',
  description:
    'List workflow definitions deployed in a Collibra instance (e.g. approval, review, onboarding processes). ' +
    'Returns each definition\'s UUID, name, process ID, description, and enablement flags. ' +
    'Use this before start_workflow_instance to find the workflow_definition_id.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter by workflow definition name (partial match, case-insensitive).',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 100, max: 1000).',
        default: 100,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset (default: 0).',
        default: 0,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Envelope with data.definitions: workflow definitions matching the filter.',
    additionalProperties: true,
  },
};

export async function executeFindWorkflowDefinitions(args: any): Promise<ToolResult> {
  const { instance_name, name, limit = 100, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (name) qp.set('name', name);
    const resp = await client.restCall<any>(`/rest/2.0/workflowDefinitions?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const definitions = results.map((d) => ({
      id: d.id,
      name: d.name,
      processId: d.processId ?? null,
      description: d.description ?? null,
      enabled: d.enabled ?? null,
      global: d.global ?? null,
      startEvents: d.startEvents ?? undefined,
      startLabel: d.startLabel ?? null,
    }));

    return withEnvelope({
      instance: instance_name,
      operation: 'find_workflow_definitions',
      data: { count: definitions.length, total: resp.total ?? null, definitions },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
      nextActions: definitions.slice(0, 1).map((d) => ({
        tool: 'start_workflow_instance',
        args: { instance_name, workflow_definition_id: d.id },
        why: 'Start an instance of a workflow definition (preview first).',
      })),
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_workflow_definitions',
      message: (error as Error).message,
    });
  }
}
