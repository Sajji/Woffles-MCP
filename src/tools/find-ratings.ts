import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const findRatingsTool = {
  name: 'find_ratings',
  description:
    'Find user ratings (1–5 stars plus optional review text) on Collibra assets. ' +
    'Filter by asset (asset_id) and/or the rating author (user_id). ' +
    'Useful as a crowd-sourced quality/trust signal during data discovery.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of the asset whose ratings to fetch.',
      },
      user_id: {
        type: 'string',
        description: 'Optional: UUID of the rating author.',
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
    description: 'Envelope with data.ratings (and an average when filtered to one asset).',
    additionalProperties: true,
  },
};

export async function executeFindRatings(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, user_id, limit = 100, offset = 0 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
    if (asset_id) qp.set('assetId', asset_id);
    if (user_id) qp.set('userId', user_id);

    const resp = await client.restCall<any>(`/rest/2.0/ratings?${qp.toString()}`);
    const results: any[] = resp.results || [];

    const ratings = results.map((r) => ({
      id: r.id,
      rating: r.rating ?? null,
      review: r.review ?? null,
      asset: r.asset ? { id: r.asset.id, name: r.asset.name } : null,
      createdBy: r.createdBy ?? null,
      createdOn: r.createdOn ?? null,
    }));

    const values = ratings.map((r) => r.rating).filter((v): v is number => typeof v === 'number');
    const average = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;

    return withEnvelope({
      instance: instance_name,
      operation: 'find_ratings',
      data: { count: ratings.length, ...(asset_id ? { averageRating: average } : {}), ratings },
      pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
    });
  } catch (error) {
    return errorEnvelope({
      instance: instance_name,
      operation: 'find_ratings',
      message: (error as Error).message,
    });
  }
}
