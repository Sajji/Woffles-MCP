import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findCommentsTool = {
  name: 'find_comments',
  description:
    'Find comments on Collibra resources (assets, domains, communities). ' +
    'Filter by the resource the comments are on (base_resource_id), the author (user_id), ' +
    'a parent comment (parent_id, to list replies), root-only, or resolved state. ' +
    'Sorted newest-first by default. Use add_comment to post a comment or reply.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      base_resource_id: {
        type: 'string',
        description: 'Optional: UUID of the asset/domain/community whose comments to fetch.',
      },
      user_id: {
        type: 'string',
        description: 'Optional: UUID of the author — only comments created by this user.',
      },
      parent_id: {
        type: 'string',
        description: 'Optional: UUID of a comment — returns its replies.',
      },
      root_only: {
        type: 'boolean',
        description: 'Optional: When true, only root comments (no replies) are returned.',
      },
      resolved: {
        type: 'boolean',
        description: 'Optional: Filter by resolved state.',
      },
      sort_order: {
        type: 'string',
        enum: ['ASC', 'DESC'],
        description: 'Sort on creation date (default: DESC — newest first).',
        default: 'DESC',
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
    description: 'Envelope with data.comments matching the filter.',
    additionalProperties: true,
  },
};

export async function executeFindComments(args: any): Promise<ToolResult> {
  const {
    instance_name,
    base_resource_id,
    user_id,
    parent_id,
    root_only,
    resolved,
    sort_order = 'DESC',
    limit = 100,
    offset = 0,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({
      limit: String(Math.min(limit, 1000)),
      offset: String(offset),
      sortOrder: sort_order,
    });
    if (base_resource_id) qp.set('baseResourceId', base_resource_id);
    if (user_id) qp.set('userId', user_id);
    if (parent_id) qp.set('parentId', parent_id);
    if (root_only !== undefined) qp.set('rootComment', String(root_only));
    if (resolved !== undefined) qp.set('resolved', String(resolved));

    const resp = await client.restCall<any>(`/rest/2.0/comments?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const comments = results.map((c) => ({
      id: c.id,
      content: c.content ?? null,
      createdOn: c.createdOn ?? null,
      createdBy: c.createdBy ?? null,
      user: c.user ? { id: c.user.id, name: c.user.fullName ?? c.user.userName ?? null } : null,
      baseResource: c.baseResource ?? null,
      parentId: c.parent?.id ?? null,
      resolved: c.resolved ?? null,
    }));

    return withEnvelope({
      instance: instance_name,
      operation: 'find_comments',
      data: { count: comments.length, total: resp.total ?? null, comments },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
      nextActions: comments.slice(0, 1).map((c) => ({
        tool: 'add_comment',
        args: { instance_name, parent_id: c.id, content: '<reply text>' },
        why: 'Reply to a comment thread.',
      })),
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_comments',
      message: (error as Error).message,
    });
  }
}
