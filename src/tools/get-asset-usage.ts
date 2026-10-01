import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import {
  COMMON_UA_PROPERTIES,
  UsageAnalyticsApi,
  fetchAssetContext,
  fetchUserNames,
  pivotTimeSeries,
  resolveDateRange,
} from '../utils/usage-analytics.js';

const OPERATION = 'get_asset_usage';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getAssetUsageTool = {
  name: OPERATION,
  description:
    'Usage Analytics for a single asset: all-time totals (visits, unique visitors, first visit date), ' +
    'visit trend per Day/Week/Month over the date range, and the top visitors with their names. ' +
    'Identify the asset by asset_id, or by exact asset_name (fails if ambiguous). ' +
    'Defaults to the previous 30 days ending yesterday at Day granularity. ' +
    'Uses undocumented internal APIs and requires Usage Analytics (Insights) permission.',
  inputSchema: {
    type: 'object',
    properties: {
      ...COMMON_UA_PROPERTIES,
      asset_id: { type: 'string', description: 'UUID of the asset.' },
      asset_name: {
        type: 'string',
        description: 'Exact asset name (used when asset_id is not given).',
      },
      visitor_limit: {
        type: 'number',
        description: 'Max top visitors to return (default: 10, max: 100).',
        default: 10,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Envelope with data: { asset, period, filters, lastRefreshed, allTime, trend, topVisitors }.',
    additionalProperties: true,
  },
};

async function resolveAssetId(client: CollibraClient, assetId?: string, assetName?: string): Promise<string> {
  if (assetId) {
    if (!UUID_RE.test(assetId)) throw new Error(`asset_id must be a UUID (got "${assetId}").`);
    return assetId;
  }
  if (!assetName) throw new Error('Provide asset_id or asset_name.');
  const qp = new URLSearchParams({ name: assetName, nameMatchMode: 'EXACT', limit: '10' });
  const resp = await client.restCall<{ results?: any[] }>(`/rest/2.0/assets?${qp.toString()}`);
  const results = resp.results ?? [];
  if (!results.length) throw new Error(`No asset found with exact name "${assetName}".`);
  if (results.length > 1) {
    const list = results
      .map((a) => `${a.id} (${a.type?.name ?? '?'} in ${a.domain?.name ?? '?'})`)
      .join('; ');
    throw new Error(`Asset name "${assetName}" is ambiguous; pass asset_id. Candidates: ${list}`);
  }
  return results[0].id;
}

export async function executeGetAssetUsage(args: any): Promise<ToolResult> {
  const { instance_name, asset_id, asset_name, visitor_limit = 10 } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);
    const api = new UsageAnalyticsApi(client);
    const range = resolveDateRange(args);
    const warnings: string[] = [];
    const id = await resolveAssetId(client, asset_id, asset_name);
    const lastRefreshedP = api.lastRefreshed();

    const { params: filterParams, applied } = await api.resolveFilters('usage', args, range, warnings);
    const dateParams = { startDate: range.startDate, endDate: range.endDate };
    const cappedLimit = Math.max(1, Math.min(Number(visitor_limit) || 10, 100));

    const [contextMap, summary, series, visitors] = await Promise.all([
      fetchAssetContext(client, [id]).catch((e) => {
        warnings.push(`Asset lookup failed: ${(e as Error).message}`);
        return new Map();
      }),
      api.get(`usage`, `assets/${id}/summary`, { ...dateParams, ...filterParams }),
      api.get(`usage`, `assets/${id}/visits/timeseries`, { ...dateParams, granularity: range.granularity, ...filterParams }),
      api.get(`usage`, `assets/${id}/visitors/top`, { ...dateParams, limit: cappedLimit, ...filterParams }),
    ]);

    const visitorRows: any[] = visitors.results ?? [];
    const names = await fetchUserNames(client, visitorRows.map((v) => v.userId));
    const topVisitors = visitorRows.map((v, i) => {
      const n = names.get(v.userId);
      return {
        rank: i + 1,
        userId: v.userId,
        fullName: n?.fullName ?? null,
        userName: n?.userName ?? null,
        visits: v.visits ?? 0,
      };
    });

    const { rows } = pivotTimeSeries(series.results);
    const ctx = contextMap.get(id);
    if (!ctx) warnings.push('Asset metadata not found (the asset may have been deleted).');

    return withEnvelope({
      instance: instance_name,
      operation: OPERATION,
      data: {
        asset: {
          id,
          name: ctx?.name ?? null,
          assetType: ctx?.assetType ?? null,
          domain: ctx?.domain ?? null,
          community: ctx?.community ?? null,
          url: client.assetUrl(id),
        },
        period: { startDate: range.startDate, endDate: range.endDate, granularity: range.granularity },
        filters: applied,
        lastRefreshed: await lastRefreshedP,
        allTime: {
          totalVisits: summary.totalVisitCount ?? 0,
          uniqueVisitors: summary.uniqueVisitorCount ?? 0,
          firstVisitDate: summary.firstVisitDate ?? null,
        },
        trend: {
          totalVisitsInPeriod: rows.reduce((sum, r) => sum + (r.count ?? 0), 0),
          buckets: rows,
        },
        topVisitors,
      },
      warnings,
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation: OPERATION, message: (error as Error).message });
  }
}
