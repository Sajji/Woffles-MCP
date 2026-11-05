import { withEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

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

  const { client } = clientFor(instance_name);

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

  // The average must cover ALL of the asset's ratings, not just this page.
  let summary: { averageRating: number | null; ratingCount: number } | undefined;
  if (asset_id) {
    const all = results.length < Math.min(limit, 1000) && offset === 0
      ? results
      : await client.restPaginate<any>('/rest/2.0/ratings', { assetId: asset_id });
    const values = all.map((r) => r.rating).filter((v): v is number => typeof v === 'number');
    summary = {
      averageRating: values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null,
      ratingCount: values.length,
    };
  }

  return withEnvelope({
    instance: instance_name,
    operation: 'find_ratings',
    data: { count: ratings.length, ...(summary ?? {}), ratings },
    pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
  });
}
