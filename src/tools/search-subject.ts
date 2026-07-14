import { getInstances, getInstance, getStarWarsSource } from '../config.js';
import { CollibraClient, enrichResponseUrls } from '../utils/collibra-client.js';
import { SwapiClient, SWAPI_RESOURCES, type SwapiResource, type SwapiHit } from '../utils/swapi-client.js';
import { withEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';

export const searchSubjectTool = {
  name: 'search_subject',
  description:
    'Federated search: look up a subject (e.g. "Luke Skywalker") across EVERY configured ' +
    'Collibra instance AND the public Star Wars API in a single call. Results are grouped by ' +
    'source so you can see, side by side, what each catalog and the external API knows about ' +
    'the subject. Demonstrates that the MCP server can fan out across Collibra and non-Collibra ' +
    'sources at once. A failure in one source never blocks the others.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'The subject to look up across all sources, e.g. "Luke Skywalker".',
      },
      instance_names: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: restrict the Collibra fan-out to these instance names (as defined in ' +
          'config.json). Default: all configured instances.',
      },
      include_star_wars: {
        type: 'boolean',
        description: 'Optional: include the Star Wars API source. Default: true.',
        default: true,
      },
      star_wars_resources: {
        type: 'array',
        items: { type: 'string', enum: SWAPI_RESOURCES },
        description:
          'Optional: which Star Wars resource types to include. Default: all ' +
          '(people, planets, starships, vehicles, species, films).',
      },
      limit: {
        type: 'number',
        description: 'Optional: maximum hits per source (default: 10).',
        default: 10,
      },
    },
    required: ['subject'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      instance: { type: 'string' },
      operation: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                kind: { type: 'string', enum: ['collibra', 'starwars'] },
                total: { type: 'number' },
                hits: { type: 'array', items: { type: 'object', additionalProperties: true } },
                error: { type: 'string' },
              },
              required: ['source', 'kind'],
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

interface SourceResult {
  source: string;
  kind: 'collibra' | 'starwars';
  total: number;
  hits: unknown[];
  error?: string;
}

async function searchCollibraInstance(
  instanceName: string,
  subject: string,
  limit: number,
): Promise<SourceResult> {
  const instance = getInstance(instanceName);
  const client = new CollibraClient(instance);

  // Wrap the subject in wildcards (chip pattern) as the other search tools do.
  const keywords = subject.includes('*') ? subject : `*${subject}*`;
  const response = await client.restCallWithBody<any>('/rest/2.0/search', 'POST', {
    keywords,
    limit: Math.min(limit, 1000),
    offset: 0,
  });

  const results = (response.results || []) as unknown[];
  const enriched = enrichResponseUrls(instance.baseUrl, { results }) as { results: unknown[] };
  return {
    source: instanceName,
    kind: 'collibra',
    total: response.total || enriched.results.length,
    hits: enriched.results,
  };
}

async function searchStarWars(
  subject: string,
  resources: SwapiResource[],
  limit: number,
): Promise<SourceResult> {
  const source = getStarWarsSource();
  const client = new SwapiClient(source.baseUrl);

  const settled = await Promise.allSettled(
    resources.map(async (resource) => client.search(resource, subject, limit)),
  );

  const hits: SwapiHit[] = [];
  const failedResources: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      hits.push(...outcome.value);
    } else {
      failedResources.push(resources[index]);
    }
  });

  return {
    source: 'star-wars',
    kind: 'starwars',
    total: hits.length,
    hits,
    error: failedResources.length ? `Failed resources: ${failedResources.join(', ')}` : undefined,
  };
}

export async function executeSearchSubject(args: any): Promise<ToolResult> {
  const {
    subject,
    instance_names,
    include_star_wars = true,
    star_wars_resources,
    limit = 10,
  } = args;

  // Resolve which Collibra instances to fan out to.
  const allInstanceNames = getInstances().map((i) => i.name);
  const targetInstances =
    Array.isArray(instance_names) && instance_names.length > 0
      ? instance_names
      : allInstanceNames;

  const starWarsSource = getStarWarsSource();
  const includeStarWars = include_star_wars && starWarsSource.enabled;
  const swResources: SwapiResource[] =
    Array.isArray(star_wars_resources) && star_wars_resources.length > 0
      ? star_wars_resources.filter((r: string): r is SwapiResource =>
          (SWAPI_RESOURCES as string[]).includes(r),
        )
      : SWAPI_RESOURCES;

  // Fan out to every source in parallel; isolate per-source failures so one
  // unreachable Collibra instance never blocks the Star Wars results (or vice versa).
  const tasks: Array<Promise<SourceResult>> = targetInstances.map((name: string) =>
    searchCollibraInstance(name, subject, limit),
  );
  if (includeStarWars) {
    tasks.push(searchStarWars(subject, swResources, limit));
  }

  const settled = await Promise.allSettled(tasks);

  const sources: SourceResult[] = [];
  const warnings: string[] = [];
  let totalHits = 0;

  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      sources.push(outcome.value);
      totalHits += outcome.value.total;
      if (outcome.value.error) {
        warnings.push(`${outcome.value.source}: ${outcome.value.error}`);
      }
    } else {
      // index maps to targetInstances first, then the optional Star Wars task.
      const sourceName =
        index < targetInstances.length ? targetInstances[index] : 'star-wars';
      const kind: SourceResult['kind'] =
        index < targetInstances.length ? 'collibra' : 'starwars';
      const message = outcome.reason?.message || String(outcome.reason);
      sources.push({ source: sourceName, kind, total: 0, hits: [], error: message });
      warnings.push(`${sourceName}: ${message}`);
    }
  });

  return withEnvelope({
    instance: 'federated',
    operation: 'search_subject',
    data: { subject, sources },
    summary: {
      subject,
      collibraInstances: targetInstances,
      starWarsIncluded: includeStarWars,
      sourcesQueried: sources.length,
      totalHits,
    },
    warnings,
    nextActions: [
      {
        tool: 'search_star_wars',
        args: { search_term: subject },
        why: 'Drill into only the Star Wars API results for this subject.',
      },
      {
        tool: 'search_assets_by_name',
        args: { instance_name: '<instance from sources>', search_term: subject },
        why: 'Run a richer, filterable search against a single Collibra instance.',
      },
    ],
    pretty: true,
  });
}
