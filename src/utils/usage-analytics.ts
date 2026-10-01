import { CollibraClient } from './collibra-client.js';

/**
 * Helpers for Collibra's Usage Analytics APIs (`/rest/usageAnalyticsUsage/v1`
 * and `/rest/usageAnalyticsUsers/v1`). These are the undocumented internal APIs
 * behind the "Usage Analytics" app; they require session (cookie + CSRF) auth,
 * not Basic auth, so all calls go through `CollibraClient.sessionRestCall`.
 */

export type UaService = 'usage' | 'users';
export type Granularity = 'Day' | 'Week' | 'Month';
export const GRANULARITIES: Granularity[] = ['Day', 'Week', 'Month'];
export const VISIT_TYPES = ['Asset', 'Domain', 'Community', 'Dashboard', 'Diagram'] as const;
export const USER_TYPES = ['Active', 'Inactive', 'New'] as const;

const SERVICE_PATH: Record<UaService, string> = {
  usage: '/rest/usageAnalyticsUsage/v1',
  users: '/rest/usageAnalyticsUsers/v1',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueryValue = string | number | boolean | string[] | undefined | null;

/** JSON-schema properties shared by all usage analytics tools. */
export const COMMON_UA_PROPERTIES = {
  instance_name: {
    type: 'string',
    description: 'The name of the Collibra instance (as defined in config.json)',
  },
  start_date: {
    type: 'string',
    description: 'Start date (YYYY-MM-DD, inclusive). Default: 30 days before end_date.',
  },
  end_date: {
    type: 'string',
    description: 'End date (YYYY-MM-DD, inclusive). Default: yesterday.',
  },
  granularity: {
    type: 'string',
    enum: GRANULARITIES,
    description: 'Time bucket size for trends (default: Day).',
  },
  exclude_admin: {
    type: 'boolean',
    description: 'Exclude visits by administrators (default: false).',
  },
  exclude_disabled_users: {
    type: 'boolean',
    description: 'Exclude visits by disabled users (default: false).',
  },
  user_groups: {
    type: 'array',
    items: { type: 'string' },
    description: 'Filter to users in these groups (names or IDs).',
  },
  user_roles: {
    type: 'array',
    items: { type: 'string' },
    description: 'Filter to users holding these roles (names or IDs).',
  },
  license_types: {
    type: 'array',
    items: { type: 'string' },
    description: 'Filter to users with these license types (e.g. "Creator").',
  },
} as const;

/** Additional content-scoping filters (only valid on usageAnalyticsUsage). */
export const CONTENT_FILTER_PROPERTIES = {
  organizations: {
    type: 'array',
    items: { type: 'string' },
    description: 'Restrict to these communities/domains (names or IDs).',
  },
  asset_types: {
    type: 'array',
    items: { type: 'string' },
    description: 'Restrict to these asset types (names or IDs).',
  },
} as const;

export interface DateRange {
  startDate: string;
  endDate: string;
  granularity: Granularity;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string, field: string): Date {
  if (!DATE_RE.test(s)) throw new Error(`${field} must be in YYYY-MM-DD format (got "${s}").`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is not a valid date: "${s}".`);
  return d;
}

/**
 * Resolve the date range + granularity. Defaults to the previous 30 days
 * ending yesterday at Day granularity.
 */
export function resolveDateRange(args: { start_date?: string; end_date?: string; granularity?: string }): DateRange {
  const granularity = (args.granularity ?? 'Day') as Granularity;
  if (!GRANULARITIES.includes(granularity)) {
    throw new Error(`granularity must be one of ${GRANULARITIES.join(', ')} (got "${args.granularity}").`);
  }
  const end = args.end_date
    ? parseDate(args.end_date, 'end_date')
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1));
  const start = args.start_date
    ? parseDate(args.start_date, 'start_date')
    : new Date(end.getTime() - 29 * 86_400_000);
  if (start > end) throw new Error(`start_date (${fmt(start)}) must be on or before end_date (${fmt(end)}).`);
  return { startDate: fmt(start), endDate: fmt(end), granularity };
}

/** The equal-length period immediately before the given range. */
export function previousPeriod(range: { startDate: string; endDate: string }): { startDate: string; endDate: string } {
  const start = parseDate(range.startDate, 'start_date');
  const end = parseDate(range.endDate, 'end_date');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return { startDate: fmt(prevStart), endDate: fmt(prevEnd) };
}

/** Build a query string; arrays are serialized as repeated keys (comma-joined values are rejected by the API). */
export function buildQuery(params: Record<string, QueryValue>): string {
  const qp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qp.append(key, v);
    } else {
      qp.append(key, String(value));
    }
  }
  const s = qp.toString();
  return s ? `?${s}` : '';
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Pivot the API's flat time-series rows (one row per bucket × category) into
 * one row per bucket with a column per category. `categoryKey` is the field
 * holding the category (e.g. "visitType" or "category"); omit for a single
 * series (e.g. per-asset visits), which yields a `count` column.
 */
export function pivotTimeSeries(results: any[], categoryKey?: string): { categories: string[]; rows: any[] } {
  const rows = new Map<string, any>();
  const categories = new Set<string>();
  for (const r of results ?? []) {
    const key = `${r.bucketStartDate}|${r.bucketEndDate}`;
    let row = rows.get(key);
    if (!row) {
      row = { label: r.label, bucketStartDate: r.bucketStartDate, bucketEndDate: r.bucketEndDate, startDate: r.startDate, endDate: r.endDate };
      if (!categoryKey) row.count = 0;
      rows.set(key, row);
    }
    if (categoryKey) {
      const cat = String(r[categoryKey] ?? 'Unknown');
      categories.add(cat);
      row[cat] = (row[cat] ?? 0) + (r.count ?? 0);
    } else {
      row.count += r.count ?? 0;
    }
  }
  const cats = [...categories];
  const out = [...rows.values()].map((row) => {
    if (categoryKey) {
      for (const c of cats) row[c] ??= 0;
      row.total = cats.reduce((sum, c) => sum + row[c], 0);
    }
    return row;
  });
  return { categories: cats, rows: out };
}

export interface FilterArgs {
  exclude_admin?: boolean;
  exclude_disabled_users?: boolean;
  user_groups?: string[];
  user_roles?: string[];
  license_types?: string[];
  organizations?: string[];
  asset_types?: string[];
}

type FilterKind = 'groups' | 'roles' | 'licenseTypes' | 'organizations' | 'assetTypes';

const FILTER_SPECS: { arg: keyof FilterArgs; kind: FilterKind; param: string; services: UaService[] }[] = [
  { arg: 'user_groups', kind: 'groups', param: 'userGroupIds', services: ['usage', 'users'] },
  { arg: 'user_roles', kind: 'roles', param: 'userRoleIds', services: ['usage', 'users'] },
  { arg: 'license_types', kind: 'licenseTypes', param: 'userLicenseTypes', services: ['usage', 'users'] },
  { arg: 'organizations', kind: 'organizations', param: 'organizationIds', services: ['usage'] },
  { arg: 'asset_types', kind: 'assetTypes', param: 'assetTypeIds', services: ['usage'] },
];

export class UsageAnalyticsApi {
  constructor(private client: CollibraClient) {}

  get<T = any>(service: UaService, path: string, params: Record<string, QueryValue> = {}): Promise<T> {
    return this.client.sessionRestCall<T>(`${SERVICE_PATH[service]}/${path}${buildQuery(params)}`);
  }

  async lastRefreshed(): Promise<string | null> {
    try {
      const r = await this.get<{ lastRefreshDateTime?: string }>('usage', 'lastRefreshed');
      return r.lastRefreshDateTime ?? null;
    } catch {
      return null;
    }
  }

  /** Fetch all entries of a filter lookup list (`<kind>/list`), optionally matching a label. */
  async listFilter(service: UaService, kind: FilterKind, range: { startDate: string; endDate: string }, label?: string): Promise<any[]> {
    const pageSize = 100;
    const out: any[] = [];
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const resp = await this.get<{ results?: any[] }>(service, `${kind}/list`, {
        startDate: range.startDate,
        endDate: range.endDate,
        limit: pageSize,
        offset,
        label,
      });
      const page = resp.results ?? [];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  /** All available filter values for the given service and date range. */
  async listAllFilters(service: UaService, range: { startDate: string; endDate: string }): Promise<Record<string, any[]>> {
    const specs = FILTER_SPECS.filter((s) => s.services.includes(service));
    const lists = await Promise.all(specs.map((s) => this.listFilter(service, s.kind, range)));
    return Object.fromEntries(specs.map((s, i) => [s.arg, lists[i]]));
  }

  /**
   * Convert tool filter args (names or IDs) into API query params. Names are
   * matched case-insensitively against the `<kind>/list` endpoints; unknown
   * names throw with the closest available values. Filters that the target
   * service does not support produce a warning instead of an error.
   */
  async resolveFilters(
    service: UaService,
    args: FilterArgs,
    range: { startDate: string; endDate: string },
    warnings: string[],
  ): Promise<{ params: Record<string, QueryValue>; applied: Record<string, any> }> {
    const params: Record<string, QueryValue> = {
      excludeAdmin: args.exclude_admin ?? false,
      excludeDisabledUser: args.exclude_disabled_users ?? false,
    };
    const applied: Record<string, any> = {
      excludeAdmin: params.excludeAdmin,
      excludeDisabledUser: params.excludeDisabledUser,
    };

    for (const spec of FILTER_SPECS) {
      const values = (args[spec.arg] as string[] | undefined)?.filter((v) => typeof v === 'string' && v.trim());
      if (!values?.length) continue;
      if (!spec.services.includes(service)) {
        warnings.push(`Filter "${spec.arg}" is not supported for this view and was ignored.`);
        continue;
      }

      const resolved: { id: string; label: string }[] = [];
      for (const raw of values) {
        const v = raw.trim();
        // License types are identified by label only.
        if (spec.kind === 'licenseTypes') {
          resolved.push({ id: v, label: v });
          continue;
        }
        if (UUID_RE.test(v)) {
          resolved.push({ id: v, label: v });
          continue;
        }
        const candidates = await this.listFilter(service, spec.kind, range, v);
        const ciExact = candidates.filter((c) => String(c.label).toLowerCase() === v.toLowerCase());
        const csExact = ciExact.filter((c) => c.label === v);
        const exact = csExact.length === 1 ? csExact : ciExact;
        const match = exact.length ? exact : candidates.length === 1 ? candidates : [];
        if (!match.length) {
          const hint = candidates.slice(0, 10).map((c) => c.label);
          throw new Error(
            `Could not resolve ${spec.arg} value "${v}".` +
              (hint.length ? ` Did you mean one of: ${hint.join(', ')}?` : ' No matching values found for this date range.'),
          );
        }
        if (exact.length > 1) {
          warnings.push(`${spec.arg} "${v}" matched ${exact.length} entries; all were applied.`);
        }
        resolved.push(...match.map((m) => ({ id: m.id, label: m.label })));
      }
      params[spec.param] = resolved.map((r) => r.id);
      applied[spec.arg] = resolved;
    }

    return { params, applied };
  }
}

export interface AssetContext {
  id: string;
  name: string | null;
  assetType: string | null;
  domain: { id: string; name: string } | null;
  community: { id: string; name: string } | null;
}

/** Batch-fetch name, type, domain and community for assets via GraphQL. Missing/deleted assets are omitted. */
export async function fetchAssetContext(client: CollibraClient, ids: string[]): Promise<Map<string, AssetContext>> {
  const out = new Map<string, AssetContext>();
  const unique = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const query = `{ assets(limit: ${batch.length}, where: { id: { in: ${JSON.stringify(batch)} } }) {
      id displayName type { name } domain { id name parent { id name } } } }`;
    const resp = await client.graphqlQuery<{ data: { assets: any[] } }>(query);
    for (const a of resp.data?.assets ?? []) {
      out.set(a.id, {
        id: a.id,
        name: a.displayName ?? null,
        assetType: a.type?.name ?? null,
        domain: a.domain ? { id: a.domain.id, name: a.domain.name } : null,
        community: a.domain?.parent ? { id: a.domain.parent.id, name: a.domain.parent.name } : null,
      });
    }
  }
  return out;
}

/** Resolve user IDs to display names via Core REST (in parallel). Unresolvable users map to null. */
export async function fetchUserNames(
  client: CollibraClient,
  ids: string[],
): Promise<Map<string, { fullName: string | null; userName: string | null } | null>> {
  const unique = [...new Set(ids)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const u = await client.restCall<any>(`/rest/2.0/users/${id}`);
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || null;
        return [id, { fullName, userName: u.userName ?? null }] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}
