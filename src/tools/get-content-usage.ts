import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import {
  COMMON_UA_PROPERTIES,
  CONTENT_FILTER_PROPERTIES,
  UsageAnalyticsApi,
  VISIT_TYPES,
  fetchAssetContext,
  pctChange,
  pivotTimeSeries,
  previousPeriod,
  resolveDateRange,
} from '../utils/usage-analytics.js';

const OPERATION = 'get_content_usage';

export const getContentUsageTool = {
  name: OPERATION,
  description:
    'Usage Analytics for catalog content: how often assets, domains, communities, dashboards and diagrams were visited ' +
    'over a date range (same data as the Collibra "Usage Analytics > Usage" page). Views: ' +
    '"summary" = visit totals per content type with previous-period comparison; ' +
    '"trend" = visits per Day/Week/Month/Quarter bucket per content type; ' +
    '"top" = most visited items of one visit_type (assets are enriched with type/domain/community); ' +
    '"filters" = valid values for user_groups/user_roles/license_types/organizations/asset_types. ' +
    'Defaults to the previous 30 days ending yesterday at Day granularity. ' +
    'Uses undocumented internal APIs and requires Usage Analytics (Insights) permission.',
  inputSchema: {
    type: 'object',
    properties: {
      ...COMMON_UA_PROPERTIES,
      ...CONTENT_FILTER_PROPERTIES,
      view: {
        type: 'string',
        enum: ['summary', 'trend', 'top', 'filters'],
        description: 'Which report to return (default: summary).',
        default: 'summary',
      },
      visit_type: {
        type: 'string',
        enum: VISIT_TYPES,
        description: 'Content type for view="top" (default: Asset).',
        default: 'Asset',
      },
      limit: {
        type: 'number',
        description: 'Max items for view="top" (default: 10, max: 100).',
        default: 10,
      },
      compare_previous_period: {
        type: 'boolean',
        description: 'For view="summary": also fetch the equal-length previous period and compute % change (default: true).',
        default: true,
      },
      enrich: {
        type: 'boolean',
        description: 'For view="top" with visit_type=Asset: add asset type, domain and community (default: true).',
        default: true,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Envelope with data: { view, period, filters, lastRefreshed, ...view-specific fields }.',
    additionalProperties: true,
  },
};

export async function executeGetContentUsage(args: any): Promise<ToolResult> {
  const {
    instance_name,
    view = 'summary',
    visit_type = 'Asset',
    limit = 10,
    compare_previous_period = true,
    enrich = true,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);
    const api = new UsageAnalyticsApi(client);
    const range = resolveDateRange(args);
    const warnings: string[] = [];
    const period = { startDate: range.startDate, endDate: range.endDate, granularity: range.granularity };
    const lastRefreshedP = api.lastRefreshed();

    if (view === 'filters') {
      const filters = await api.listAllFilters('usage', range);
      return withEnvelope({
        instance: instance_name,
        operation: OPERATION,
        data: { view, period, lastRefreshed: await lastRefreshedP, filters },
      });
    }

    const { params: filterParams, applied } = await api.resolveFilters('usage', args, range, warnings);
    const dateParams = { startDate: range.startDate, endDate: range.endDate };
    const base = { view, period, filters: applied };

    if (view === 'summary') {
      const toCounts = (results: any[] = []) => {
        const counts: Record<string, number> = Object.fromEntries(VISIT_TYPES.map((t) => [t, 0]));
        for (const r of results) counts[r.visitType] = (counts[r.visitType] ?? 0) + (r.count ?? 0);
        return counts;
      };
      const prev = compare_previous_period ? previousPeriod(range) : null;
      const [cur, before] = await Promise.all([
        api.get('usage', 'visits/summary', { ...dateParams, ...filterParams }),
        prev ? api.get('usage', 'visits/summary', { ...prev, ...filterParams }) : Promise.resolve(null),
      ]);
      const counts = toCounts(cur.results);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const data: any = { ...base, lastRefreshed: await lastRefreshedP, visits: counts, totalVisits: total };
      if (prev && before) {
        const prevCounts = toCounts(before.results);
        const prevTotal = Object.values(prevCounts).reduce((a, b) => a + b, 0);
        data.previousPeriod = {
          ...prev,
          visits: prevCounts,
          totalVisits: prevTotal,
          changePct: {
            total: pctChange(total, prevTotal),
            ...Object.fromEntries(Object.keys(counts).map((k) => [k, pctChange(counts[k], prevCounts[k] ?? 0)])),
          },
        };
      }
      return withEnvelope({ instance: instance_name, operation: OPERATION, data, warnings });
    }

    if (view === 'trend') {
      const resp = await api.get('usage', 'visits/timeSeries', {
        ...dateParams,
        granularity: range.granularity,
        ...filterParams,
      });
      const { categories, rows } = pivotTimeSeries(resp.results, 'visitType');
      return withEnvelope({
        instance: instance_name,
        operation: OPERATION,
        data: { ...base, lastRefreshed: await lastRefreshedP, visitTypes: categories, buckets: rows },
        warnings,
      });
    }

    if (view === 'top') {
      if (!VISIT_TYPES.includes(visit_type)) {
        throw new Error(`visit_type must be one of ${VISIT_TYPES.join(', ')} (got "${visit_type}").`);
      }
      const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
      const resp = await api.get('usage', 'visits/top', {
        ...dateParams,
        granularity: range.granularity,
        visitType: visit_type,
        limit: cappedLimit,
        ...filterParams,
      });
      const results: any[] = resp.results ?? [];

      let context = new Map<string, any>();
      if (visit_type === 'Asset' && enrich && results.length) {
        try {
          context = await fetchAssetContext(client, results.map((r) => r.id));
        } catch (e) {
          warnings.push(`Asset enrichment failed: ${(e as Error).message}`);
        }
      }

      const items = results.map((r, i) => {
        const item: any = { rank: i + 1, id: r.id, name: r.label, visits: r.count ?? 0 };
        if (visit_type === 'Asset') {
          const c = context.get(r.id);
          if (c) {
            item.assetType = c.assetType;
            item.domain = c.domain;
            item.community = c.community;
          }
          item.url = client.assetUrl(r.id);
        } else if (visit_type === 'Domain') {
          item.url = client.domainUrl(r.id);
        } else if (visit_type === 'Community') {
          item.url = client.communityUrl(r.id);
        }
        return item;
      });

      return withEnvelope({
        instance: instance_name,
        operation: OPERATION,
        data: { ...base, visitType: visit_type, lastRefreshed: await lastRefreshedP, count: items.length, items },
        warnings,
        nextActions:
          visit_type === 'Asset' && items.length
            ? [
                {
                  tool: 'get_asset_usage',
                  args: { instance_name, asset_id: items[0].id, start_date: range.startDate, end_date: range.endDate },
                  why: 'Drill into visit trend and top visitors for the most visited asset.',
                },
              ]
            : undefined,
      });
    }

    throw new Error(`view must be one of summary, trend, top, filters (got "${view}").`);
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation: OPERATION, message: (error as Error).message });
  }
}
