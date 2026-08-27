import fetch from 'node-fetch';
import https from 'https';
import type { CollibraInstance } from '../types.js';
import { toRichTextValue } from './markdown.js';

/**
 * Maximum page size accepted by Collibra Core REST 2.0 list endpoints.
 * Requests with `limit` above this return HTTP 400. Verified on prod v17.259.
 */
export const MAX_REST_PAGE_SIZE = 1000;

/**
 * Map a Collibra attribute-type discriminator (e.g. "StringAttributeType",
 * found in `resourceType` / `attributeTypeDiscriminator` / `resourceDiscriminator`)
 * to the `kind` enum used by write endpoints (POST /attributeTypes). The REST
 * read responses do NOT carry a `kind` field — only the discriminator — so
 * callers that need the kind must derive it via this helper.
 */
export function attrKindFromDiscriminator(discriminator?: string | null): string | null {
  switch (discriminator) {
    case 'StringAttributeType':         return 'STRING';
    case 'SingleValueListAttributeType': return 'SINGLE_VALUE_LIST';
    case 'MultiValueListAttributeType':  return 'MULTI_VALUE_LIST';
    case 'NumericAttributeType':        return 'NUMERIC';
    case 'DateAttributeType':           return 'DATE';
    case 'BooleanAttributeType':        return 'BOOLEAN';
    case 'ScriptAttributeType':         return 'SCRIPT';
    default:                            return null;
  }
}

/**
 * Core REST list endpoints that support cursor pagination. Collibra deprecated
 * `offset` on these; everything else still requires offset paging.
 */
const CURSOR_CAPABLE_PATHS = new Set([
  '/rest/2.0/assets',
  '/rest/2.0/attributes',
  '/rest/2.0/communities',
  '/rest/2.0/domains',
  '/rest/2.0/complexRelations',
]);

export class CollibraClient {
  private instance: CollibraInstance;
  private authHeader: string;
  private httpsAgent: https.Agent | undefined;
  /** Set of endpoint prefixes already warned about, to avoid log spam. */
  private static clampWarned = new Set<string>();
  /** Lazily-built relation-type-by-id cache, used by getAssetRelations. */
  private relationTypesById: Map<string, any> | null = null;
  /** Lazily-built attribute-type cache, used for RICH_TEXT detection. */
  private attributeTypesById = new Map<string, any>();

  constructor(instance: CollibraInstance) {
    this.instance = instance;
    // Create Basic Auth header
    const credentials = Buffer.from(`${instance.username}:${instance.password}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
    // Allow self-signed certs for explicitly insecure instances
    if (instance.insecure) {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Clamp any `limit=<n>` query parameter in an endpoint to MAX_REST_PAGE_SIZE.
   * Collibra rejects larger page sizes with HTTP 400, so this prevents a whole
   * class of avoidable failures. Warns once per endpoint path when it clamps.
   */
  private clampLimit(endpoint: string): string {
    return endpoint.replace(/([?&]limit=)(\d+)/gi, (_m, prefix: string, n: string) => {
      const requested = Number(n);
      if (requested <= MAX_REST_PAGE_SIZE) return `${prefix}${n}`;
      const pathKey = endpoint.split('?')[0];
      if (!CollibraClient.clampWarned.has(pathKey)) {
        CollibraClient.clampWarned.add(pathKey);
        console.warn(
          `[CollibraClient] limit=${requested} exceeds max ${MAX_REST_PAGE_SIZE}; clamped for ${pathKey}. Use restPaginate() to fetch all pages.`,
        );
      }
      return `${prefix}${MAX_REST_PAGE_SIZE}`;
    });
  }

  /**
   * Make a REST API call to Collibra
   */
  async restCall<T>(endpoint: string): Promise<T> {
    endpoint = this.clampLimit(endpoint);
    const url = `${this.instance.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(
            `REST API call failed: 403 Forbidden — the authenticated user is likely missing a required Collibra permission or DGC scope for this operation.`,
          );
        }
        throw new Error(
          `REST API call failed: ${response.status} ${response.statusText}`
        );
      }

      return await response.json() as T;
    } catch (error) {
      throw new Error(
        `Failed to call Collibra REST API at ${url}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Make a REST API call with a request body (POST, PATCH, PUT, DELETE).
   * DELETE with a body is required by Collibra's `/.../bulk` endpoints which
   * accept an array of UUIDs to remove in a single round trip.
   */
  async restCallWithBody<T>(endpoint: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: any): Promise<T> {
    endpoint = this.clampLimit(endpoint);
    const url = `${this.instance.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (response.status === 403) {
          throw new Error(
            `REST API call failed: 403 Forbidden — the authenticated user is likely missing a required Collibra permission or DGC scope for this operation.${errorBody ? ` - ${errorBody}` : ''}`,
          );
        }
        throw new Error(
          `REST API call failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`
        );
      }

      const text = await response.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `Failed to call Collibra REST API (${method}) at ${url}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Make a GraphQL query to Collibra
   */
  async graphqlQuery<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const url = `${this.instance.baseUrl}/graphql/knowledgeGraph/v1`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: variables || {},
        }),
        agent: this.httpsAgent,
      });

      if (!response.ok) {
        throw new Error(
          `GraphQL query failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json() as any;
      
      if (result.errors) {
        throw new Error(
          `GraphQL errors: ${JSON.stringify(result.errors)}`
        );
      }

      return result as T;
    } catch (error) {
      throw new Error(
        `Failed to execute GraphQL query at ${url}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Execute a paginated GraphQL query and return all results
   */
  async graphqlQueryPaginated<T extends { data: { assets: any[] } }>(
    query: string,
    limit: number = 100
  ): Promise<any[]> {
    let offset = 0;
    let allAssets: any[] = [];
    let hasMore = true;

    while (hasMore) {
      // Replace the limit and offset in the query
      const paginatedQuery = query
        .replace(/limit:\s*\d+/i, `limit: ${limit}`)
        .replace(/offset:\s*null/i, `offset: ${offset}`);

      const response = await this.graphqlQuery<T>(paginatedQuery);
      const assets = response.data.assets;

      allAssets = allAssets.concat(assets);

      // Check if there are more results
      if (assets.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    return allAssets;
  }

  /**
   * Fetch every page of a Core REST list endpoint and return the concatenated
   * `results`. Page size is clamped to MAX_REST_PAGE_SIZE. Pass query params as
   * an object (do NOT include limit/offset — they are managed here).
   *
   * @example
   *   const domains = await client.restPaginate('/rest/2.0/domains', { communityId });
   */
  async restPaginate<T = any>(
    path: string,
    params: Record<string, string> = {},
    pageSize: number = MAX_REST_PAGE_SIZE,
  ): Promise<T[]> {
    const size = Math.min(pageSize, MAX_REST_PAGE_SIZE);
    if (CURSOR_CAPABLE_PATHS.has(path)) {
      return this.restPaginateCursor<T>(path, params, size);
    }
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const qp = new URLSearchParams({ ...params, limit: String(size), offset: String(offset) });
      const resp = await this.restCall<{ results?: T[] }>(`${path}?${qp.toString()}`);
      const page = resp.results ?? [];
      out.push(...page);
      if (page.length < size) break;
      offset += size;
    }
    return out;
  }

  /**
   * Cursor-based variant of {@link restPaginate} for endpoints where Collibra
   * deprecated `offset` (assets, attributes, communities, domains,
   * complexRelations). Falls back to offset paging if the first cursor request
   * fails (older Collibra versions).
   */
  async restPaginateCursor<T = any>(
    path: string,
    params: Record<string, string> = {},
    pageSize: number = MAX_REST_PAGE_SIZE,
  ): Promise<T[]> {
    const size = Math.min(pageSize, MAX_REST_PAGE_SIZE);
    const out: T[] = [];
    let cursor = '';
    for (;;) {
      const qp = new URLSearchParams({ ...params, limit: String(size), cursor });
      let resp: { results?: T[]; nextCursor?: string };
      try {
        resp = await this.restCall<{ results?: T[]; nextCursor?: string }>(`${path}?${qp.toString()}`);
      } catch (err) {
        if (out.length === 0) {
          // Cursor unsupported on this instance — fall back to offset paging.
          return this.restPaginateOffset<T>(path, params, size);
        }
        throw err;
      }
      const page = resp.results ?? [];
      out.push(...page);
      if (!resp.nextCursor || page.length === 0) break;
      cursor = resp.nextCursor;
    }
    return out;
  }

  /** Offset paging without the cursor upgrade — fallback for old instances. */
  private async restPaginateOffset<T = any>(
    path: string,
    params: Record<string, string>,
    size: number,
  ): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const qp = new URLSearchParams({ ...params, limit: String(size), offset: String(offset) });
      const resp = await this.restCall<{ results?: T[] }>(`${path}?${qp.toString()}`);
      const page = resp.results ?? [];
      out.push(...page);
      if (page.length < size) break;
      offset += size;
    }
    return out;
  }

  /**
   * Read all attribute values for an asset via Core REST and return them in a
   * normalized shape.
   *
   * IMPORTANT: the Core REST endpoint `/rest/2.0/attributes` returns each value
   * in a single, already-typed `value` field (string | number | boolean |
   * epoch-ms). Multi-value list attributes come back as SEPARATE records, each
   * with one `value`. This differs from the GraphQL API, which exposes
   * stringValue / numericValue / booleanValue / dateValue / stringValues.
   * Reading the GraphQL field names off a REST record yields silent nulls.
   */
  async getAssetAttributes(
    assetId: string,
  ): Promise<Array<{ id: string; typeId: string; typeName: string | null; kind: string | null; value: any }>> {
    const records = await this.restPaginate<any>('/rest/2.0/attributes', { assetId });
    return records.map((a) => ({
      id: a.id,
      typeId: a.type?.id,
      typeName: a.type?.name ?? null,
      kind: attrKindFromDiscriminator(a.type?.resourceDiscriminator ?? a.type?.resourceType),
      value: a.value ?? null,
    }));
  }

  /**
   * Read all OUTGOING relations for an asset via Core REST, enriched with the
   * relation type's role / co-role / source-type / target-type names.
   *
   * IMPORTANT: `/rest/2.0/relations` embeds only `{ id }` on the `type` object —
   * it does NOT carry role/coRole/sourceType/targetType. This helper joins each
   * relation against a lazily-built (once per client) relation-type map so
   * callers get the full context without a second lookup.
   */
  async getAssetRelations(
    assetId: string,
  ): Promise<Array<{
    id: string;
    relTypeId: string;
    role: string | null;
    corole: string | null;
    srcTypeName: string | null;
    tgtTypeName: string | null;
    sourceId: string;
    targetId: string;
  }>> {
    const relTypes = await this.getRelationTypeMap();
    const rels = await this.restPaginate<any>('/rest/2.0/relations', { sourceId: assetId });
    return rels.map((r) => {
      const rt = relTypes.get(r.type?.id);
      return {
        id: r.id,
        relTypeId: r.type?.id,
        role: rt?.role ?? null,
        corole: rt?.coRole ?? rt?.corole ?? null,
        srcTypeName: rt?.sourceType?.name ?? null,
        tgtTypeName: rt?.targetType?.name ?? null,
        sourceId: r.source?.id,
        targetId: r.target?.id,
      };
    });
  }

  /**
   * Fetch (and cache per-client) a single attribute type by UUID. Returns null
   * on 404/permission errors so callers can degrade gracefully.
   */
  async getAttributeType(typeId: string): Promise<any | null> {
    if (this.attributeTypesById.has(typeId)) return this.attributeTypesById.get(typeId);
    let type: any | null = null;
    try {
      type = await this.restCall<any>(`/rest/2.0/attributeTypes/${encodeURIComponent(typeId)}`);
    } catch {
      type = null;
    }
    this.attributeTypesById.set(typeId, type);
    return type;
  }

  /** True when the attribute type is a RICH_TEXT string attribute. */
  async isRichTextAttributeType(typeId: string): Promise<boolean> {
    const type = await this.getAttributeType(typeId);
    return type?.stringType === 'RICH_TEXT';
  }

  /**
   * Convert Markdown values targeting RICH_TEXT attribute types into HTML.
   * Non-rich-text targets, already-HTML values, and plain prose pass through
   * unchanged. Returns the (possibly rewritten) entries plus which typeIds
   * were converted, so tools can surface the conversion in their output.
   */
  async convertRichTextEntries<T extends { typeId: string; value: string }>(
    entries: T[],
  ): Promise<{ entries: T[]; convertedTypeIds: string[] }> {
    const convertedTypeIds: string[] = [];
    const out: T[] = [];
    for (const entry of entries) {
      const isRich = await this.isRichTextAttributeType(entry.typeId);
      const { value, converted } = toRichTextValue(entry.value, isRich);
      if (converted) convertedTypeIds.push(entry.typeId);
      out.push(converted ? { ...entry, value } : entry);
    }
    return { entries: out, convertedTypeIds };
  }

  /**
   * Lazily fetch and cache all relation types keyed by id. Cached for the life
   * of this client instance since the operating model rarely changes mid-run.
   */
  async getRelationTypeMap(): Promise<Map<string, any>> {
    if (this.relationTypesById) return this.relationTypesById;
    const types = await this.restPaginate<any>('/rest/2.0/relationTypes', {
      sortField: 'ROLE',
      sortOrder: 'ASC',
    });
    this.relationTypesById = new Map(types.map((t) => [t.id, t]));
    return this.relationTypesById;
  }

  /** Generate the Collibra UI URL for an asset */
  assetUrl(id: string): string {
    return `${this.instance.baseUrl}/asset/${id}`;
  }

  /** Generate the Collibra UI URL for a community */
  communityUrl(id: string): string {
    return `${this.instance.baseUrl}/community/${id}`;
  }

  /** Generate the Collibra UI URL for a domain */
  domainUrl(id: string): string {
    return `${this.instance.baseUrl}/domain/${id}`;
  }
}

/**
 * Recursively enrich REST API response objects with Collibra URLs.
 * Adds a `url` field to any object that has both `id` and a `resourceType`
 * matching Asset, Community, or Domain.
 */
export function enrichResponseUrls(baseUrl: string, obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const urlPaths: Record<string, string> = {
    Asset: 'asset',
    Community: 'community',
    Domain: 'domain',
  };

  if (Array.isArray(obj)) {
    return obj.map(item => enrichResponseUrls(baseUrl, item));
  }

  const result = { ...obj };

  if (result.id && result.resourceType && urlPaths[result.resourceType]) {
    result.url = `${baseUrl}/${urlPaths[result.resourceType]}/${result.id}`;
  }

  for (const key of Object.keys(result)) {
    const val = result[key];
    if (val && typeof val === 'object') {
      result[key] = enrichResponseUrls(baseUrl, val);
    }
  }

  return result;
}
