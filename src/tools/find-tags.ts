import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findTagsTool = {
  name: 'find_tags',
  description:
    'List tags defined in a Collibra instance, optionally filtered by name. ' +
    'Set include_assets=true to also list the assets carrying each returned tag (capped per tag). ' +
    'Tags are free-text crowd-sourced labels — use edit_asset with an add_tag op to tag an asset.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter tags by name (partial match).',
      },
      include_assets: {
        type: 'boolean',
        description: 'When true, fetch the assets carrying each returned tag (default: false).',
        default: false,
      },
      assets_per_tag: {
        type: 'number',
        description: 'Max assets to list per tag when include_assets=true (default: 25).',
        default: 25,
      },
      limit: {
        type: 'number',
        description: 'Max tags to return (default: 100, max: 1000).',
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
    description: 'Envelope with data.tags (and per-tag assets when include_assets=true).',
    additionalProperties: true,
  },
};

export async function executeFindTags(args: any): Promise<ToolResult> {
  const { instance_name, name, include_assets = false, assets_per_tag = 25, limit = 100, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (name) qp.set('name', name);
    const resp = await client.restCall<any>(`/rest/2.0/tags?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const tags: any[] = results.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      assetsCount: t.assetsCount ?? null,
    }));

    if (include_assets) {
      for (const tag of tags) {
        try {
          const assetsResp = await client.restCall<any>(
            `/rest/2.0/assets?tagNames=${encodeURIComponent(tag.name)}&limit=${Math.min(assets_per_tag, 1000)}`,
          );
          tag.assets = (assetsResp.results || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type?.name ?? null,
            url: client.assetUrl(a.id),
          }));
        } catch (err) {
          tag.assetsError = (err as Error).message;
        }
      }
    }

    return withEnvelope({
      instance: instance_name,
      operation: 'find_tags',
      data: { count: tags.length, total: resp.total ?? null, tags },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_tags',
      message: (error as Error).message,
    });
  }
}
