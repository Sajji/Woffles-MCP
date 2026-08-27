import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getAssetViewStatsTool = {
  name: 'get_asset_view_stats',
  description:
    'Navigation statistics: the most viewed assets across all users (mode="most_viewed"), ' +
    'or the assets most recently viewed by the authenticated service account (mode="recently_viewed"). ' +
    'A cheap signal for "which assets matter most" during discovery.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      mode: {
        type: 'string',
        enum: ['most_viewed', 'recently_viewed'],
        description: 'Which statistic to fetch (default: most_viewed).',
        default: 'most_viewed',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 25, max: 1000).',
        default: 25,
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
    description: 'Envelope with data.entries: assets with view statistics.',
    additionalProperties: true,
  },
};

export async function executeGetAssetViewStats(args: any): Promise<ToolResult> {
  const { instance_name, mode = 'most_viewed', limit = 25, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    const resp = await client.restCall<any>(`/rest/2.0/navigation/${mode}?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const entries = results.map((e) => {
      const asset = e.asset ?? e;
      return {
        assetId: asset?.id ?? null,
        name: asset?.name ?? null,
        type: asset?.type?.name ?? null,
        viewCount: e.numberOfViews ?? e.viewCount ?? null,
        lastViewedDate: e.lastViewedDate ?? null,
        url: asset?.id ? client.assetUrl(asset.id) : null,
      };
    });

    return withEnvelope({
      instance: instance_name,
      operation: 'get_asset_view_stats',
      data: { mode, count: entries.length, entries },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'get_asset_view_stats',
      message: (error as Error).message,
    });
  }
}
