import { okPretty, okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const removeMappingTool = {
  name: 'remove_mapping',
  description:
    'Remove an external-system mapping, identified either by its mapping UUID (mapping_id) ' +
    'or by the (external_system_id, external_entity_id) pair. ' +
    'Removing a mapping does NOT delete the mapped Collibra resource — only the link. ' +
    'Two-step safety: confirm=false (default) previews the mapping to be removed; confirm=true removes it.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      mapping_id: {
        type: 'string',
        description: 'UUID of the mapping to remove.',
      },
      external_system_id: {
        type: 'string',
        description: 'External system ID (used with external_entity_id when mapping_id is not known).',
      },
      external_entity_id: {
        type: 'string',
        description: 'External entity ID (used with external_system_id).',
      },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview. Set true to remove.',
        default: false,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'PREVIEW: the mapping that would be removed. APPLIED: removal confirmation.',
    additionalProperties: true,
  },
};

export async function executeRemoveMapping(args: any): Promise<ToolResult> {
  const { instance_name, mapping_id, external_system_id, external_entity_id, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const byPair = external_system_id && external_entity_id;
    if (!mapping_id && !byPair) {
      return ok({
        error: true,
        message: 'Provide mapping_id, or both external_system_id and external_entity_id.',
        instance: instance_name,
      });
    }

    const lookupPath = mapping_id
      ? `/rest/2.0/mappings/${encodeURIComponent(mapping_id)}`
      : `/rest/2.0/mappings/externalSystem/${encodeURIComponent(external_system_id)}/externalEntity/${encodeURIComponent(external_entity_id)}`;

    const mapping = await client.restCall<any>(lookupPath).catch(() => null);
    if (!mapping?.id) {
      return ok({
        error: true,
        message: 'No mapping found for the given identifier(s).',
        instance: instance_name,
      });
    }

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — mapping NOT removed',
        mapping,
        note: 'Removing the mapping only deletes the external link, not the mapped Collibra resource.',
        instructions: 'To remove, call again with confirm=true.',
      });
    }

    await client.restCallWithBody<void>(`/rest/2.0/mappings/${encodeURIComponent(mapping.id)}`, 'DELETE', undefined as any);

    return okWithNext(
      {
        mode: 'APPLIED',
        removedMappingId: mapping.id,
        externalSystemId: mapping.externalSystemId ?? null,
        externalEntityId: mapping.externalEntityId ?? null,
      },
      [
        { tool: 'find_mappings', args: { instance_name, external_system_id: mapping.externalSystemId }, why: 'Verify the remaining mappings for this system.' },
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
