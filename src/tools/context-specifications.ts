import { withEnvelope, errorEnvelope, okPretty, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const SB_BASE = '/rest/semanticBlueprint/v1';

export const listContextSpecificationsTool = {
  name: 'list_context_specifications',
  description:
    'List the Context Specifications available in a Collibra instance (Semantic Blueprint API). ' +
    'A Context Specification defines how to extract governed metadata starting from an asset ' +
    '(which relations to traverse, which fields to pull, and the output shape) for a target system ' +
    '(Snowflake, Databricks, or custom shapes for AI agents). ' +
    'Filter by asset_id (only specs applicable to that asset\'s type) or asset_type_public_id. ' +
    'Use get_asset_by_id with context_specification_id to generate the actual context YAML for an asset. ' +
    'NOTE: requires the Semantic Blueprint capability on the instance.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of an asset — only specs whose source asset type matches (or is a parent of) its type.',
      },
      asset_type_public_id: {
        type: 'string',
        description: 'Optional: Filter by asset type public ID (e.g. "Table").',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 50, max: 1000).',
        default: 50,
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
    description: 'Envelope with data.contextSpecifications.',
    additionalProperties: true,
  },
};

export async function executeListContextSpecifications(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, asset_type_public_id, limit = 50, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (asset_id) qp.set('assetId', asset_id);
    if (asset_type_public_id) qp.set('assetTypePublicId', asset_type_public_id);

    const resp = await client.restCall<any>(`${SB_BASE}/contextSpecifications?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const contextSpecifications = results.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      assetType: s.assetType ?? null,
    }));

    return withEnvelope({
      instance: instance_name,
      operation: 'list_context_specifications',
      data: { total: resp.total ?? contextSpecifications.length, contextSpecifications },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
      nextActions: contextSpecifications.slice(0, 1).map((s) => ({
        tool: 'get_context_specification',
        args: { instance_name, context_specification_id: s.id },
        why: 'Inspect the spec\'s full mapping YAML.',
      })),
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'list_context_specifications',
      message: `${(error as Error).message} — the Semantic Blueprint API may not be enabled on this instance.`,
    });
  }
}

export const getContextSpecificationTool = {
  name: 'get_context_specification',
  description:
    'Retrieve a single Context Specification (Semantic Blueprint API) by UUID, ' +
    'including its full mapping YAML — the definition of which relations are traversed and which fields are extracted. ' +
    'Use list_context_specifications to find the UUID.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      context_specification_id: {
        type: 'string',
        description: 'UUID of the Context Specification.',
      },
    },
    required: ['instance_name', 'context_specification_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'The full context specification including mappingYaml.',
    additionalProperties: true,
  },
};

export async function executeGetContextSpecification(args: any): Promise<ToolResult> {
  const { instance_name, context_specification_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const spec = await client.restCall<any>(
      `${SB_BASE}/contextSpecifications/${encodeURIComponent(context_specification_id)}`,
    );

    return okPretty({
      instance: instance_name,
      contextSpecification: spec,
    });
  } catch (error) {
    return ok({
      error: true,
      message: `${(error as Error).message} — the Semantic Blueprint API may not be enabled on this instance.`,
      instance: instance_name,
      context_specification_id,
    });
  }
}
