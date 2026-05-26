import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createDomainTool = {
  name: 'create_domain',
  description:
    'Create a domain inside a community in a Collibra instance. ' +
    'This tool is idempotent: if a domain with the same name already exists in the same community, ' +
    'the existing domain is returned without creating a duplicate. ' +
    'Use get_domain_types to find the correct type_id for the target instance before calling this tool. ' +
    'Use get_communities or create_community to resolve the community_id. ' +
    'Returns the domain id regardless of whether it was newly created or already existed.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the domain to create',
      },
      community_id: {
        type: 'string',
        description: 'UUID of the community that will own this domain',
      },
      type_id: {
        type: 'string',
        description:
          'UUID of the domain type (from get_domain_types). ' +
          'Determines the kind of content the domain holds (e.g. Glossary, Physical Data Dictionary).',
      },
      description: {
        type: 'string',
        description: 'Optional: A description for the domain',
      },
    },
    required: ['instance_name', 'name', 'community_id', 'type_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateDomain(args: any): Promise<ToolResult> {
  const { instance_name, name, community_id, type_id, description } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    const checkParams = new URLSearchParams({
      name,
      communityId: community_id,
      nameMatchMode: 'EXACT',
      limit: '5',
    });

    const existing = await client.restCall<any>(`/rest/2.0/domains?${checkParams.toString()}`);
    const match = (existing.results || []).find((d: any) => d.name === name);

    if (match) {
      return okPretty({
        action: 'existing',
        domain: {
          id: match.id,
          name: match.name,
          description: match.description || null,
          community: match.community ? { id: match.community.id, name: match.community.name } : null,
          type: match.type ? { id: match.type.id, name: match.type.name } : null,
        },
        message: `Domain "${name}" already exists in community "${match.community?.name}" — no changes made.`,
      });
    }

    // ── Create ────────────────────────────────────────────────────────
    const body: any = { name, communityId: community_id, typeId: type_id };
    if (description) body.description = description;

    const created = await client.restCallWithBody<any>('/rest/2.0/domains', 'POST', body);

    return okPretty({
      action: 'created',
      domain: {
        id: created.id,
        name: created.name,
        description: created.description || null,
        community: created.community ? { id: created.community.id, name: created.community.name } : null,
        type: created.type ? { id: created.type.id, name: created.type.name } : null,
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
