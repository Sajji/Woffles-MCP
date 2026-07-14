import fetch from 'node-fetch';

/** Star Wars API resource types that can be searched by name/title. */
export type SwapiResource =
  | 'people'
  | 'planets'
  | 'starships'
  | 'vehicles'
  | 'species'
  | 'films';

export const SWAPI_RESOURCES: SwapiResource[] = [
  'people',
  'planets',
  'starships',
  'vehicles',
  'species',
  'films',
];

/** A normalized Star Wars API hit, decoupled from swapi.tech's envelope shape. */
export interface SwapiHit {
  /** Resource type this hit belongs to (e.g. "people"). */
  resource: SwapiResource;
  /** Stable id assigned by the Star Wars API. */
  uid: string;
  /** Display label (person/planet name, or film title). */
  name: string;
  /** Canonical URL of the resource in the Star Wars API. */
  url: string;
  /** Short human-readable description supplied by the API. */
  description?: string;
  /** Full property bag returned by the API for this resource. */
  properties: Record<string, unknown>;
}

/**
 * Minimal client for the public Star Wars API (swapi.tech). No authentication
 * is required. This mirrors the shape of {@link CollibraClient} so external and
 * Collibra sources can be treated uniformly by federated tools.
 */
export class SwapiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Search a single Star Wars resource by name (or title, for films). Returns a
   * normalized list of hits. Empty results (including the API's 404 for
   * no-match) resolve to an empty array rather than throwing.
   */
  async search(resource: SwapiResource, term: string, limit = 10): Promise<SwapiHit[]> {
    // Films are searched by `title`; every other resource is searched by `name`.
    const queryField = resource === 'films' ? 'title' : 'name';
    const url = `${this.baseUrl}/${resource}/?${queryField}=${encodeURIComponent(term)}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new Error(`Failed to call Star Wars API at ${url}: ${(error as Error).message}`);
    }

    // The API returns 404 when a search yields no matches — treat as empty.
    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`Star Wars API call failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as {
      result?: Array<{ uid?: string; description?: string; properties?: Record<string, unknown> }>;
    };

    const results = Array.isArray(body.result) ? body.result : [];
    return results.slice(0, limit).map((entry) => {
      const properties = entry.properties || {};
      const name =
        (properties.name as string | undefined) ||
        (properties.title as string | undefined) ||
        '(unnamed)';
      return {
        resource,
        uid: entry.uid || String(properties.uid ?? ''),
        name,
        url: (properties.url as string | undefined) || `${this.baseUrl}/${resource}/${entry.uid ?? ''}`,
        description: entry.description,
        properties,
      };
    });
  }
}
