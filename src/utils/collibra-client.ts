import fetch from 'node-fetch';
import https from 'https';
import type { CollibraInstance } from '../types.js';

export class CollibraClient {
  private instance: CollibraInstance;
  private authHeader: string;
  private httpsAgent: https.Agent | undefined;

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
   * Make a REST API call to Collibra
   */
  async restCall<T>(endpoint: string): Promise<T> {
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
   * Make a REST API call with a request body (POST, PATCH, PUT)
   */
  async restCallWithBody<T>(endpoint: string, method: 'POST' | 'PATCH' | 'PUT', body: any): Promise<T> {
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
