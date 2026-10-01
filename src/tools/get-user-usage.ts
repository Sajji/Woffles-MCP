import { withEnvelope, errorEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import {
  COMMON_UA_PROPERTIES,
  USER_TYPES,
  UsageAnalyticsApi,
  pctChange,
  pivotTimeSeries,
  previousPeriod,
  resolveDateRange,
} from '../utils/usage-analytics.js';

const OPERATION = 'get_user_usage';

export const getUserUsageTool = {
  name: OPERATION,
  description:
    'Usage Analytics for users / adoption (same data as the Collibra "Usage Analytics > Users" page). Views: ' +
    '"summary" = Active / Inactive / New user counts with previous-period comparison; ' +
    '"top" = most active users by visit count; ' +
    '"usage_rate" = users per bucket by usage intensity (High/Medium/Low); ' +
    '"retention" = users per bucket that were Acquired / Retained / Returning; ' +
    '"license_types" = users per bucket by license type, for user_type Active|Inactive|New. ' +
    'Defaults to the previous 30 days ending yesterday at Day granularity. ' +
    'Use get_content_usage view="filters" to list valid group/role/license values. ' +
    'Uses undocumented internal APIs and requires Usage Analytics (Insights) permission.',
  inputSchema: {
    type: 'object',
    properties: {
      ...COMMON_UA_PROPERTIES,
      view: {
        type: 'string',
        enum: ['summary', 'top', 'usage_rate', 'retention', 'license_types'],
        description: 'Which report to return (default: summary).',
        default: 'summary',
      },
      user_type: {
        type: 'string',
        enum: USER_TYPES,
        description: 'For view="license_types": which user population to break down (default: Active).',
        default: 'Active',
      },
      limit: {
        type: 'number',
        description: 'Max users for view="top" (default: 10, max: 100).',
        default: 10,
      },
      compare_previous_period: {
        type: 'boolean',
        description: 'For view="summary": also fetch the equal-length previous period and compute % change (default: true).',
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

const TREND_VIEWS: Record<string, string> = {
  usage_rate: 'usageRate/timeSeries',
  retention: 'userRetention/timeSeries',
  license_types: 'licenseTypes/timeSeries',
};

export async function executeGetUserUsage(args: any): Promise<ToolResult> {
  const { instance_name, view = 'summary', user_type = 'Active', limit = 10, compare_previous_period = true } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);
    const api = new UsageAnalyticsApi(client);
    const range = resolveDateRange(args);
    const warnings: string[] = [];
    const period = { startDate: range.startDate, endDate: range.endDate, granularity: range.granularity };
    const lastRefreshedP = api.lastRefreshed();

    const { params: filterParams, applied } = await api.resolveFilters('users', args, range, warnings);
    const dateParams = { startDate: range.startDate, endDate: range.endDate };
    const base = { view, period, filters: applied };

    if (view === 'summary') {
      const fetchCounts = async (dates: { startDate: string; endDate: string }) => {
        const results = await Promise.all(
          USER_TYPES.map((t) => api.get<{ count?: number }>('users', 'summary', { ...dates, summaryUserType: t, ...filterParams })),
        );
        return Object.fromEntries(USER_TYPES.map((t, i) => [t, results[i].count ?? 0])) as Record<string, number>;
      };
      const prev = compare_previous_period ? previousPeriod(range) : null;
      const [cur, before] = await Promise.all([fetchCounts(dateParams), prev ? fetchCounts(prev) : Promise.resolve(null)]);
      const data: any = { ...base, lastRefreshed: await lastRefreshedP, users: cur };
      if (prev && before) {
        data.previousPeriod = {
          ...prev,
          users: before,
          changePct: Object.fromEntries(USER_TYPES.map((t) => [t, pctChange(cur[t], before[t])])),
        };
      }
      return withEnvelope({ instance: instance_name, operation: OPERATION, data, warnings });
    }

    if (view === 'top') {
      const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
      const resp = await api.get('users', 'top', { ...dateParams, limit: cappedLimit, ...filterParams });
      const users = (resp.results ?? []).map((u: any, i: number) => ({
        rank: i + 1,
        userId: u.id,
        fullName: u.fullName ?? null,
        visits: u.count ?? 0,
      }));
      return withEnvelope({
        instance: instance_name,
        operation: OPERATION,
        data: { ...base, lastRefreshed: await lastRefreshedP, count: users.length, users },
        warnings,
      });
    }

    const path = TREND_VIEWS[view];
    if (path) {
      if (view === 'license_types' && !USER_TYPES.includes(user_type)) {
        throw new Error(`user_type must be one of ${USER_TYPES.join(', ')} (got "${user_type}").`);
      }
      const resp = await api.get('users', path, {
        ...dateParams,
        granularity: range.granularity,
        ...(view === 'license_types' ? { userType: user_type } : {}),
        ...filterParams,
      });
      const { categories, rows } = pivotTimeSeries(resp.results, 'category');
      return withEnvelope({
        instance: instance_name,
        operation: OPERATION,
        data: {
          ...base,
          ...(view === 'license_types' ? { userType: user_type } : {}),
          lastRefreshed: await lastRefreshedP,
          categories,
          buckets: rows,
        },
        warnings,
      });
    }

    throw new Error(`view must be one of summary, top, usage_rate, retention, license_types (got "${view}").`);
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation: OPERATION, message: (error as Error).message });
  }
}
