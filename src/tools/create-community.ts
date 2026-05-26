import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createCommunityTool = {
  name: 'create_community',
  description:
    'Create a community (or sub-community) in a Collibra instance. ' +
    'This tool is idempotent: if a community with the same name already exists under the same parent, ' +
    'the existing community is returned without creating a duplicate. ' +
    'Use get_communities first to retrieve parent community IDs when creating sub-communities. ' +
    'Returns the community id regardless of whether it was newly created or already existed.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the community to create',
      },
      description: {
        type: 'string',
        description: 'Optional: A description for the community',
      },
      parent_id: {
        type: 'string',
        description:
          'Optional: UUID of the parent community. Omit to create a top-level community. ' +
          'Provide to create a sub-community under the specified parent.',
      },
    },
    required: ['instance_name', 'name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateCommunity(args: any): Promise<ToolResult> {
  const { instance_name, name, description, parent_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    const checkParams = new URLSearchParams({
      name,
      nameMatchMode: 'EXACT',
      excludeMeta: 'true',
      limit: '5',
    });
    if (parent_id) checkParams.set('parentId', parent_id);

    const existing = await client.restCall<any>(`/rest/2.0/communities?${checkParams.toString()}`);
    const match = (existing.results || []).find((c: any) => c.name === name);

    if (match) {
      return okPretty({
        action: 'existing',
        community: {
          id: match.id,
          name: match.name,
          description: match.description || null,
          parent: match.parent ? { id: match.parent.id, name: match.parent.name } : null,
        },
        message: `Community "${name}" already exists — no changes made.`,
      });
    }

    // ── Create ────────────────────────────────────────────────────────
    const body: any = { name };
    if (description) body.description = description;
    if (parent_id) body.parentId = parent_id;

    const created = await client.restCallWithBody<any>('/rest/2.0/communities', 'POST', body);

    return okPretty({
      action: 'created',
      community: {
        id: created.id,
        name: created.name,
        description: created.description || null,
        parent: created.parent ? { id: created.parent.id, name: created.parent.name } : null,
      },
    });

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
