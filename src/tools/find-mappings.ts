import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findMappingsTool = {
  name: 'find_mappings',
  description:
    'Find external-system mappings: links between an external entity ID (in a source system like a BI tool, ' +
    'ETL platform, or another Collibra instance) and the corresponding Collibra resource (asset/domain/community). ' +
    'Filter by external_system_id, external_entity_id, or mapped_resource_id. ' +
    'Mappings power idempotent integrations and cross-instance migrations — use add_mapping / remove_mapping to maintain them.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      external_system_id: {
        type: 'string',
        description: 'Optional: The external system identifier (e.g. "EXT_BI_SYS").',
      },
      external_entity_id: {
        type: 'string',
        description: 'Optional: The entity identifier inside the external system.',
      },
      mapped_resource_id: {
        type: 'string',
        description: 'Optional: UUID of the mapped Collibra resource.',
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
    description: 'Envelope with data.mappings matching the filter.',
    additionalProperties: true,
  },
};

export async function executeFindMappings(args: any): Promise<ToolResult> {
  const { instance_name, external_system_id, external_entity_id, mapped_resource_id, limit = 100, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (external_system_id) qp.set('externalSystemId', external_system_id);
    if (external_entity_id) qp.set('externalEntityId', external_entity_id);
    if (mapped_resource_id) qp.set('mappedResourceId', mapped_resource_id);

    const resp = await client.restCall<any>(`/rest/2.0/mappings?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const mappings = results.map((m) => ({
      id: m.id,
      externalSystemId: m.externalSystemId ?? null,
      externalEntityId: m.externalEntityId ?? null,
      externalEntityUrl: m.externalEntityUrl ?? null,
      mappedResource: m.mappedResource ?? (m.mappedResourceId ? { id: m.mappedResourceId } : null),
      description: m.description ?? null,
      lastSyncDate: m.lastSyncDate ?? null,
      syncAction: m.syncAction ?? null,
    }));

    return withEnvelope({
      instance: instance_name,
      operation: 'find_mappings',
      data: { count: mappings.length, total: resp.total ?? null, mappings },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_mappings',
      message: (error as Error).message,
    });
  }
}
