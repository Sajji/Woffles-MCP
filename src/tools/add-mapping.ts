import { okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const addMappingTool = {
  name: 'add_mapping',
  description:
    'Create an external-system mapping linking an external entity ID to a Collibra resource (asset/domain/community). ' +
    'Idempotent: if a mapping for the same (external_system_id, external_entity_id) pair already exists, ' +
    'it is returned unchanged instead of erroring. ' +
    'Use mappings to make integrations and cross-instance migrations idempotent (find_mappings to look them up).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      external_system_id: {
        type: 'string',
        description: 'The external system identifier (e.g. "EXT_BI_SYS" or "woffles-mcp-migration").',
      },
      external_entity_id: {
        type: 'string',
        description: 'The entity identifier inside the external system.',
      },
      mapped_resource_id: {
        type: 'string',
        description: 'UUID of the Collibra resource to map to.',
      },
      description: {
        type: 'string',
        description: 'Optional: Description of the mapping.',
      },
      external_entity_url: {
        type: 'string',
        description: 'Optional: URL of the entity in the external system.',
      },
    },
    required: ['instance_name', 'external_system_id', 'external_entity_id', 'mapped_resource_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'The created (or pre-existing) mapping.',
    additionalProperties: true,
  },
};

export async function executeAddMapping(args: any): Promise<ToolResult> {
  const { instance_name, external_system_id, external_entity_id, mapped_resource_id, description, external_entity_url } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Idempotency: return the existing mapping for this external pair if present
    const existing = await client
      .restCall<any>(
        `/rest/2.0/mappings/externalSystem/${encodeURIComponent(external_system_id)}/externalEntity/${encodeURIComponent(external_entity_id)}`,
      )
      .catch(() => null);
    if (existing?.id) {
      return okWithNext(
        {
          success: true,
          alreadyExisted: true,
          mapping: existing,
        },
        [
          { tool: 'find_mappings', args: { instance_name, external_system_id }, why: 'List all mappings for this external system.' },
        ],
        true,
      );
    }

    const body: any = {
      externalSystemId: external_system_id,
      externalEntityId: external_entity_id,
      mappedResourceId: mapped_resource_id,
    };
    if (description) body.description = description;
    if (external_entity_url) body.externalEntityUrl = external_entity_url;

    const created = await client.restCallWithBody<any>('/rest/2.0/mappings', 'POST', body);

    return okWithNext(
      {
        success: true,
        alreadyExisted: false,
        mapping: created,
      },
      [
        { tool: 'find_mappings', args: { instance_name, external_system_id }, why: 'List all mappings for this external system.' },
      ],
      true,
    );
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
