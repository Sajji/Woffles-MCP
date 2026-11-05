import { withEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

export const findUsersTool = {
  name: 'find_users',
  description:
    'Find Collibra users by name fragment (searched across username, first name, last name, and email by default). ' +
    'Returns each user\'s UUID, username, full name, email, and enabled state. ' +
    'Use this to resolve the user UUIDs needed by edit_asset set_responsibility, edit_assessment set_owner/set_assignees, ' +
    'and get_activities performed_by_user_id.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Name fragment to search for.',
      },
      name_search_fields: {
        type: 'array',
        items: { type: 'string', enum: ['USERNAME', 'FIRSTNAME', 'LASTNAME', 'EMAIL'] },
        description: 'Optional: Which fields the name fragment is matched against (default: all four).',
      },
      group_id: {
        type: 'string',
        description: 'Optional: UUID of a user group — only members of that group.',
      },
      only_enabled: {
        type: 'boolean',
        description: 'Optional: true (default — Collibra excludes disabled users) returns only enabled users; false also includes disabled users.',
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
    description: 'Envelope with data.users matching the filter.',
    additionalProperties: true,
  },
};

export async function executeFindUsers(args: any): Promise<ToolResult> {
  const { instance_name, name, name_search_fields, group_id, only_enabled, limit = 50, offset = 0 } = args;

  const { client } = clientFor(instance_name);

  const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
  if (name) qp.set('name', name);
  for (const f of name_search_fields ?? []) qp.append('nameSearchFields', f);
  if (group_id) qp.set('groupId', group_id);
  // The API parameter is includeDisabled (default false); onlyEnabledUsers does not exist.
  if (only_enabled === false) qp.set('includeDisabled', 'true');

  const resp = await client.restCall<any>(`/rest/2.0/users?${qp.toString()}`);
  const results: any[] = resp.results || [];

  const users = results.map((u) => ({
    id: u.id,
    userName: u.userName ?? null,
    fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
    email: u.emailAddress ?? null,
    enabled: u.enabled ?? null,
    ldapUser: u.ldapUser ?? undefined,
  }));

  return withEnvelope({
    instance: instance_name,
    operation: 'find_users',
    data: { count: users.length, total: resp.total ?? null, users },
    pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
  });
}
