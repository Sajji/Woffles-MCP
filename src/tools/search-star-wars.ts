import { getStarWarsSource } from '../config.js';
import { SwapiClient, SWAPI_RESOURCES, type SwapiResource, type SwapiHit } from '../utils/swapi-client.js';
import { withEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';

export const searchStarWarsTool = {
  name: 'search_star_wars',
  description:
    'Search the public Star Wars API (SWAPI) for characters, planets, starships, vehicles, ' +
    'species, and films by name. This demonstrates how the MCP server federates non-Collibra, ' +
    'external REST sources alongside Collibra instances. Example: search_term "Luke Skywalker" ' +
    'returns the matching person and related resource links.',
  inputSchema: {
    type: 'object',
    properties: {
      search_term: {
        type: 'string',
        description: 'The subject to search for, e.g. "Luke Skywalker", "Tatooine", "X-wing".',
      },
      resources: {
        type: 'array',
        items: {
          type: 'string',
          enum: SWAPI_RESOURCES,
        },
        description:
          'Optional: which Star Wars resource types to search. Default: all ' +
          '(people, planets, starships, vehicles, species, films).',
      },
      limit: {
        type: 'number',
        description: 'Optional: maximum hits to return per resource type (default: 10).',
        default: 10,
      },
    },
    required: ['search_term'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      instance: { type: 'string' },
      operation: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          searchTerm: { type: 'string' },
          byResource: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      summary: { type: 'object', additionalProperties: true },
      warnings: { type: 'array', items: { type: 'string' } },
      nextActions: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    required: ['instance', 'operation', 'data'],
  },
};

export async function executeSearchStarWars(args: any): Promise<ToolResult> {
  const { search_term, resources, limit = 10 } = args;

  const source = getStarWarsSource();
  if (!source.enabled) {
    return withEnvelope({
      instance: 'star-wars',
      operation: 'search_star_wars',
      data: { searchTerm: search_term, byResource: {} },
      warnings: ['The Star Wars source is disabled in config.json (externalSources.starWars.enabled = false).'],
      pretty: true,
    });
  }

  const requested: SwapiResource[] =
    Array.isArray(resources) && resources.length > 0
      ? resources.filter((r: string): r is SwapiResource => (SWAPI_RESOURCES as string[]).includes(r))
      : SWAPI_RESOURCES;

  const client = new SwapiClient(source.baseUrl);

  // Query every requested resource in parallel; isolate per-resource failures.
  const settled = await Promise.allSettled(
    requested.map(async (resource) => ({
      resource,
      hits: await client.search(resource, search_term, limit),
    })),
  );

  const byResource: Record<string, SwapiHit[]> = {};
  const warnings: string[] = [];
  let totalHits = 0;

  settled.forEach((outcome, index) => {
    const resource = requested[index];
    if (outcome.status === 'fulfilled') {
      if (outcome.value.hits.length > 0) {
        byResource[resource] = outcome.value.hits;
        totalHits += outcome.value.hits.length;
      }
    } else {
      warnings.push(`Star Wars "${resource}" search failed: ${outcome.reason?.message || outcome.reason}`);
    }
  });

  return withEnvelope({
    instance: 'star-wars',
    operation: 'search_star_wars',
    data: { searchTerm: search_term, byResource },
    summary: {
      source: source.baseUrl,
      resourcesSearched: requested,
      totalHits,
    },
    warnings,
    nextActions: [
      {
        tool: 'search_subject',
        args: { subject: search_term },
        why: 'Search this subject across every Collibra instance AND the Star Wars API at once.',
      },
    ],
    pretty: true,
  });
}
