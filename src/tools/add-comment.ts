import { okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { looksLikeMarkdown, markdownToHtml } from '../utils/markdown.js';

export const addCommentTool = {
  name: 'add_comment',
  description:
    'Add a comment to a Collibra resource (asset, domain, or community), or reply to an existing comment. ' +
    'For a new comment, provide resource_id (+ resource_type, default Asset). ' +
    'For a reply, provide parent_id instead. Markdown content is converted to HTML automatically. ' +
    'Comments are visible to all users who can view the resource.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      content: {
        type: 'string',
        description: 'The comment text (Markdown or HTML).',
      },
      resource_id: {
        type: 'string',
        description: 'UUID of the asset/domain/community to comment on (for a new root comment).',
      },
      resource_type: {
        type: 'string',
        enum: ['Asset', 'Domain', 'Community'],
        description: 'Type of the resource being commented on (default: Asset).',
        default: 'Asset',
      },
      parent_id: {
        type: 'string',
        description: 'UUID of an existing comment to reply to (mutually exclusive with resource_id).',
      },
    },
    required: ['instance_name', 'content'],
  },
  outputSchema: {
    type: 'object',
    description: 'The created comment (id, content, resource).',
    additionalProperties: true,
  },
};

export async function executeAddComment(args: any): Promise<ToolResult> {
  const { instance_name, content, resource_id, resource_type = 'Asset', parent_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    if (!resource_id && !parent_id) {
      return ok({
        error: true,
        message: 'Provide resource_id (new comment) or parent_id (reply).',
        instance: instance_name,
      });
    }

    const html = looksLikeMarkdown(content) ? markdownToHtml(content) : content;
    const body: any = { content: html };
    if (parent_id) {
      body.parentId = parent_id;
    } else {
      body.commentableResourceId = resource_id;
      body.commentableResourceDiscriminator = resource_type;
    }

    const created = await client.restCallWithBody<any>('/rest/2.0/comments', 'POST', body);

    return okWithNext(
      {
        success: true,
        comment: {
          id: created.id,
          content: created.content ?? html,
          baseResource: created.baseResource ?? null,
          parentId: created.parent?.id ?? parent_id ?? null,
        },
      },
      [
        {
          tool: 'find_comments',
          args: parent_id
            ? { instance_name, parent_id }
            : { instance_name, base_resource_id: resource_id },
          why: 'View the comment thread.',
        },
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
