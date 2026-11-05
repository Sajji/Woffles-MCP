import type { RequestInit, Response } from 'node-fetch';
import type { CollibraInstance } from '../types.js';
import { authFetch, getAuthProvider, resolveAuthType, type AuthProvider } from './auth.js';
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

/**
 * The lineage gateway answers 401 "Unauthorized User Token" when it accepts
 * the request but cannot map the user to a lineage-service token. Verified on
 * a 2026.10 tenant: Basic and session auth both fail, and Collibra's hosted
 * MCP fails identically, so the cause is instance provisioning, not the client.
 */
/**
 * Error thrown for a non-2xx Collibra response. Carries the HTTP status so
 * callers can distinguish "not found" (404) from permission/server failures
 * instead of parsing the message text.
 */
export class CollibraHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CollibraHttpError';
  }
}

/** True when the error is a Collibra 404 Not Found. */
export function isNotFound(error: unknown): boolean {
  return error instanceof CollibraHttpError && error.status === 404;
}

/** Re-wrap an error with a prefix, preserving the HTTP status when present. */
function wrapError(prefix: string, error: unknown): Error {
  const message = `${prefix}: ${(error as Error).message}`;
  return error instanceof CollibraHttpError ? new CollibraHttpError(message, error.status) : new Error(message);
}

export const LINEAGE_UNAVAILABLE_MESSAGE =
  'Technical lineage is not available for this user on this instance (lineage service returned 401 "Unauthorized User Token"). ' +
  'Credentials are valid; the lineage service rejected the user mapping. Ask a Collibra admin to confirm that technical lineage is ' +
  'provisioned for this environment (lineage harvester / Edge lineage capability has run and synced) and that this user has access ' +
  'to the lineage data sources. Collibra\'s own MCP server fails the same way in this situation. Business lineage via relations ' +
  '(get_asset_relations, find_traversal_path) still works.';

/** How long operating-model lookups (relation/attribute types) are reused. */
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Operating-model caches shared by every client of the same instance. Tools
 * construct a new CollibraClient per call, so per-object caches were always
 * empty; keeping them per instance (with a TTL) makes them effective.
 */
interface InstanceCaches {
  relationTypes: { at: number; map: Promise<Map<string, any>> } | null;
  attributeTypes: Map<string, { at: number; type: any | null }>;
}
const instanceCaches = new Map<string, InstanceCaches>();

function cachesFor(instance: CollibraInstance): InstanceCaches {
  const key = `${instance.name}|${instance.baseUrl}`;
  let c = instanceCaches.get(key);
  if (!c) {
    c = { relationTypes: null, attributeTypes: new Map() };
    instanceCaches.set(key, c);
  }
  return c;
}

/** Drop cached operating-model lookups (all instances, or one). Used after model writes and by tests. */
export function clearModelCaches(instance?: CollibraInstance): void {
  if (instance) instanceCaches.delete(`${instance.name}|${instance.baseUrl}`);
  else instanceCaches.clear();
}

/**
 * Build a descriptive error from a failed response. Uses Collibra's
 * `userMessage` when the body is JSON, and explains HTML bodies (typically a
 * login page or a feature that isn't available on this instance/version).
 */
async function errorFromResponse(response: Response, context: string): Promise<CollibraHttpError> {
  const body = await response.text().catch(() => '');
  const contentType = response.headers.get('content-type') ?? '';
  let detail = '';
  if (/json/i.test(contentType) || body.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(body);
      detail = parsed.userMessage ?? parsed.message ?? parsed.titleMessage ?? '';
    } catch {
      detail = body.slice(0, 300);
    }
  } else if (/html/i.test(contentType) || /^\s*</.test(body)) {
    detail = 'the server returned an HTML page instead of JSON — the endpoint may not exist on this Collibra version, or the session is not authorized';
  } else {
    detail = body.slice(0, 300);
  }
  const status = `${response.status} ${response.statusText}`.trim();
  if (response.status === 403) {
    return new CollibraHttpError(
      `${context}: 403 Forbidden — the authenticated user is likely missing a required Collibra permission or DGC scope for this operation.${detail ? ` ${detail}` : ''}`,
      403,
    );
  }
  return new CollibraHttpError(`${context}: ${status}${detail ? ` - ${detail}` : ''}`, response.status);
}

/**
 * Parse a successful response as JSON. A 200 with an HTML body (e.g. an SSO or
 * login page, or an app route that doesn't exist on this version) gets a clear
 * message instead of "Unexpected token '<'".
 */
async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (/^\s*</.test(text)) {
      throw new CollibraHttpError(
        'The server returned an HTML page instead of JSON — the endpoint may not exist on this Collibra version, or the session is not authorized.',
        response.status,
      );
    }
    throw new CollibraHttpError(`Invalid JSON in response: ${text.slice(0, 200)}`, response.status);
  }
}

export class CollibraClient {
  private instance: CollibraInstance;
  private auth: AuthProvider;
  /** Set of endpoint prefixes already warned about, to avoid log spam. */
  private static clampWarned = new Set<string>();
  constructor(instance: CollibraInstance) {
    this.instance = instance;
    this.auth = getAuthProvider(instance, resolveAuthType(instance));
  }

  /** Send a request to this instance using its configured auth + TLS settings. */
  private send(url: string, init: RequestInit = {}, provider: AuthProvider = this.auth): Promise<Response> {
    return authFetch(this.instance, url, init, provider);
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
      const response = await this.send(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 401 && endpoint.startsWith('/technical_lineage_resource')) {
          const body = await response.clone().text().catch(() => '');
          if (body.includes('Unauthorized User Token')) {
            throw new CollibraHttpError(LINEAGE_UNAVAILABLE_MESSAGE, 401);
          }
        }
        throw await errorFromResponse(response, 'REST API call failed');
      }

      return await parseJson<T>(response);
    } catch (error) {
      throw wrapError(`Failed to call Collibra REST API at ${url}`, error);
    }
  }

  /**
   * GET using a browser-style session (cookie + X-CSRF-TOKEN) instead of Basic
   * auth. Required by internal app APIs such as Usage Analytics
   * (`/rest/usageAnalytics*`), which reject Basic auth with 403. Logs in
   * lazily, reuses the session, and re-authenticates once on 401/403.
   */
  async sessionRestCall<T>(endpoint: string): Promise<T> {
    const url = `${this.instance.baseUrl}${endpoint}`;
    try {
      // Always session auth (these APIs reject Basic); re-login on 401/403 is handled by authFetch.
      const response = await this.send(
        url,
        { method: 'GET', headers: { Accept: 'application/json' } },
        getAuthProvider(this.instance, 'session'),
      );
      if (!response.ok) {
        throw await errorFromResponse(response, 'Session API call failed');
      }
      return await parseJson<T>(response);
    } catch (error) {
      throw wrapError(`Failed to call Collibra session API at ${url}`, error);
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
      const response = await this.send(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw await errorFromResponse(response, 'REST API call failed');
      }

      const text = await response.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (error) {
      throw wrapError(`Failed to call Collibra REST API (${method}) at ${url}`, error);
    }
  }

  /**
   * Make a GraphQL query to Collibra
   */
  async graphqlQuery<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const url = `${this.instance.baseUrl}/graphql/knowledgeGraph/v1`;
    
    try {
      const response = await this.send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: variables || {},
        }),
      });

      if (!response.ok) {
        throw await errorFromResponse(response, 'GraphQL query failed');
      }

      const result = await parseJson<any>(response);
      
      if (result.errors) {
        throw new Error(
          `GraphQL errors: ${JSON.stringify(result.errors)}`
        );
      }

      return result as T;
    } catch (error) {
      throw wrapError(`Failed to execute GraphQL query at ${url}`, error);
    }
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
    const cache = cachesFor(this.instance).attributeTypes;
    const hit = cache.get(typeId);
    if (hit && Date.now() - hit.at < MODEL_CACHE_TTL_MS) return hit.type;
    try {
      const type = await this.restCall<any>(`/rest/2.0/attributeTypes/${encodeURIComponent(typeId)}`);
      cache.set(typeId, { at: Date.now(), type });
      return type;
    } catch (err) {
      // Cache a definitive "does not exist"; never cache transient/permission failures.
      if (isNotFound(err)) cache.set(typeId, { at: Date.now(), type: null });
      return null;
    }
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
    const caches = cachesFor(this.instance);
    if (caches.relationTypes && Date.now() - caches.relationTypes.at < MODEL_CACHE_TTL_MS) {
      return caches.relationTypes.map;
    }
    // Store the promise so concurrent callers share one fetch; drop it on failure.
    const map = this.restPaginate<any>('/rest/2.0/relationTypes', { sortField: 'ROLE', sortOrder: 'ASC' }).then(
      (types) => new Map(types.map((t) => [t.id, t])),
    );
    const entry = { at: Date.now(), map };
    caches.relationTypes = entry;
    map.catch(() => {
      if (caches.relationTypes === entry) caches.relationTypes = null;
    });
    return map;
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
