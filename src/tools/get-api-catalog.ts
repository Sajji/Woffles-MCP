import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { chunk, mapLimit } from '../utils/concurrency.js';
import { clientFor } from './_context.js';

export const getApiCatalogTool = {
  name: 'get_api_catalog',
  description:
    'Traverse the REST API catalog hierarchy: REST API → REST API Version → REST API Endpoint → REST API Operation. ' +
    'Returns a structured tree showing all cataloged APIs, their versioned releases, endpoint paths, and the HTTP operations on each path. ' +
    'Use this tool to discover what REST APIs exist, understand their endpoint surface area, find specific operations, ' +
    'and navigate to assets for cross-domain linking (governance, lineage, classification). ' +
    'Use include_operations=false for a compact summary when exploring large catalogs. ' +
    'Prerequisites: the REST API operating model must be configured in the target instance.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      api_name: {
        type: 'string',
        description: 'Optional: Filter to a specific REST API by name (partial match, case-insensitive). Omit to list all REST APIs.',
      },
      include_operations: {
        type: 'boolean',
        description: 'Whether to include REST API Operations in the response (default: true). ' +
          'Set to false for a compact API + Version + Endpoint summary when exploring large catalogs.',
        default: true,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of top-level REST API assets to return (default: 20, max 50).',
        default: 20,
        maximum: 50,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

// ── GraphQL queries ───────────────────────────────────────────────────────────
// Collibra rejects queries whose potential node count (the product of nested
// list limits) exceeds 100,000. One query nesting API → version → endpoint →
// operation can never fit, so the tree is fetched in stages, and relations are
// filtered by role server-side so unrelated relations don't consume the limits.
// Role names are fixed constants; all user input travels as variables.
// Every attribute counts twice (value + nested type), so ATTRS ≈ 60 nodes;
// batch sizes below keep each query at roughly 60K nodes or fewer.
const ATTRS = `
  stringAttributes(limit: 15)    { type { name } stringValue }
  multiValueAttributes(limit: 5) { type { name } stringValues }
  booleanAttributes(limit: 10)   { type { name } booleanValue }`;

const byRole = (role: string, limit: number) => `
  outgoingRelations(where: { type: { role: { eq: "${role}" } } }, limit: ${limit}) {
    type { role }
    target { id fullName displayName ${ATTRS} }
  }`;

/** Children (by relation role) of a batch of parent assets. */
const childrenQuery = (role: string, parents: number, children: number) => `
  query Children($ids: [UUID!]!) {
    assets(where: { id: { in: $ids } }, limit: ${parents}) {
      id
      ${byRole(role, children)}
    }
  }`;

/** Stage 1: the API assets themselves (≤ 50 × 60 nodes). */
const API_LIST_QUERY = `
  query ApiCatalog($where: AssetFilter!, $limit: Int!) {
    assets(where: $where, limit: $limit) { id fullName displayName ${ATTRS} }
  }`;

/** Stages 2–4: versions of ≤ 10 APIs, endpoints of 1 version, operations of ≤ 20 endpoints. */
const STAGES = {
  versions:   { role: 'has version',   batch: 10, children: 50 },   // 10 × 50 × 60  ≈ 30K
  endpoints:  { role: 'exposes',       batch: 1,  children: 500 },  //  1 × 500 × 60 ≈ 30K
  operations: { role: 'has operation', batch: 20, children: 50 },   // 20 × 50 × 60  ≈ 60K
} as const;

// ── Attribute extraction helpers ──────────────────────────────────────────────
// In Collibra's GraphQL: STRING and SINGLE_VALUE_LIST attributes both appear
// under stringAttributes. MULTI_VALUE_LIST appears under multiValueAttributes.
function extractStr(asset: any, name: string): string | null {
  const match = (asset.stringAttributes || []).find((a: any) => a.type?.name === name);
  return match?.stringValue ?? null;
}

function extractMulti(asset: any, name: string): string[] {
  const match = (asset.multiValueAttributes || []).find((a: any) => a.type?.name === name);
  return match?.stringValues ?? [];
}

function extractBool(asset: any, name: string): boolean | null {
  const match = (asset.booleanAttributes || []).find((a: any) => a.type?.name === name);
  return match != null ? match.booleanValue : null;
}

// ── Shape helpers ──────────────────────────────────────────────────────────────
function shapeOperation(opAsset: any) {
  return {
    id:          opAsset.id,
    name:        opAsset.fullName || opAsset.displayName,
    httpMethod:  extractStr(opAsset, 'HTTP Method'),
    operationId: extractStr(opAsset, 'Operation ID'),
    summary:     extractStr(opAsset, 'Summary'),
    isDeprecated:           extractBool(opAsset, 'Is Deprecated'),
    isIdempotent:           extractBool(opAsset, 'Is Idempotent'),
    requiresAuthentication: extractBool(opAsset, 'Requires Authentication'),
    responseFormat: extractStr(opAsset, 'Response Format'),
  };
}

function shapeEndpoint(endpointAsset: any, includeOperations: boolean) {
  const operations = (endpointAsset.outgoingRelations || [])
    .filter((r: any) => r.type?.role === 'has operation')
    .map((r: any) => r.target)
    .filter(Boolean);

  const shaped: any = {
    id:           endpointAsset.id,
    name:         endpointAsset.fullName || endpointAsset.displayName,
    pathTemplate: extractStr(endpointAsset, 'Path Template'),
    supportedMethods:       extractMulti(endpointAsset, 'Supported HTTP Methods'),
    requiresAuthentication: extractBool(endpointAsset, 'Requires Authentication'),
    operationCount:         operations.length,
  };
  if (includeOperations) {
    shaped.operations = operations.map(shapeOperation);
  }
  return shaped;
}

function shapeVersion(versionAsset: any, includeOperations: boolean) {
  const endpoints = (versionAsset.outgoingRelations || [])
    .filter((r: any) => r.type?.role === 'exposes')
    .map((r: any) => r.target)
    .filter(Boolean);

  return {
    id:             versionAsset.id,
    name:           versionAsset.fullName || versionAsset.displayName,
    versionNumber:  extractStr(versionAsset, 'Version Number'),
    oasSpecVersion: extractStr(versionAsset, 'OAS Spec Version'),
    endpointCount:  endpoints.length,
    endpoints:      endpoints.map((e: any) => shapeEndpoint(e, includeOperations)),
  };
}

function shapeApi(apiAsset: any, includeOperations: boolean, baseUrl: string) {
  const versions = (apiAsset.outgoingRelations || [])
    .filter((r: any) => r.type?.role === 'has version')
    .map((r: any) => r.target)
    .filter(Boolean);

  return {
    id:                  apiAsset.id,
    name:                apiAsset.fullName || apiAsset.displayName,
    url:                 `${baseUrl}/asset/${apiAsset.id}`,
    baseUrl:             extractStr(apiAsset, 'Base URL'),
    lifecycleStatus:     extractStr(apiAsset, 'Lifecycle Status'),
    classificationLevel: extractStr(apiAsset, 'Classification Level'),
    authType:            extractStr(apiAsset, 'Authentication Type'),
    apiCategory:         extractMulti(apiAsset, 'API Category'),
    contactEmail:        extractStr(apiAsset, 'Contact Email'),
    versionCount:        versions.length,
    versions:            versions.map((v: any) => shapeVersion(v, includeOperations)),
  };
}

// ── Tool executor ─────────────────────────────────────────────────────────────
export async function executeGetApiCatalog(args: any): Promise<ToolResult> {
  const { instance_name, api_name, include_operations = true, limit = 20 } = args;

  const { instance, client } = clientFor(instance_name);

  // Stage 1: API assets (name filter is a case-insensitive "contains" on the display name).
  const where: any = { type: { name: { eq: 'REST API' } } };
  if (api_name) where.displayName = { contains: api_name };
  const listResp = await client.graphqlQuery<{ data: { assets: any[] } }>(API_LIST_QUERY, { where, limit });
  const rawApis = listResp.data?.assets ?? [];

  /**
   * Attach each parent's role-filtered relations as `outgoingRelations`, in
   * node-budgeted batches. Returns the child assets for the next stage.
   */
  const expand = async (parents: any[], stage: (typeof STAGES)[keyof typeof STAGES]): Promise<any[]> => {
    const byId = new Map<string, any>(parents.map((p) => [p.id, p]));
    const query = childrenQuery(stage.role, stage.batch, stage.children);
    await mapLimit(chunk([...byId.keys()], stage.batch), 4, async (ids) => {
      const resp = await client.graphqlQuery<{ data: { assets: any[] } }>(query, { ids });
      for (const a of resp.data?.assets ?? []) {
        const parent = byId.get(a.id);
        if (parent) parent.outgoingRelations = a.outgoingRelations ?? [];
      }
    });
    return parents.flatMap((p) => (p.outgoingRelations ?? []).map((r: any) => r.target).filter(Boolean));
  };

  const versions = await expand(rawApis, STAGES.versions);
  const endpoints = await expand(versions, STAGES.endpoints);
  if (include_operations) await expand(endpoints, STAGES.operations);

  const apis = rawApis.map(a => shapeApi(a, include_operations, instance.baseUrl));

  const totalEndpoints  = apis.reduce((s, a) => s + a.versions.reduce((sv: number, v: any) => sv + v.endpointCount, 0), 0);
  const totalOperations = include_operations
    ? apis.reduce((s, a) => s + a.versions.reduce((sv: number, v: any) =>
        sv + v.endpoints.reduce((se: number, e: any) => se + (e.operations?.length ?? 0), 0), 0), 0)
    : null;

  return okWithNext({
    instance:          instance_name,
    filter:            api_name ?? null,
    include_operations,
    count:             apis.length,
    summary: {
      apis:       apis.length,
      endpoints:  totalEndpoints,
      ...(totalOperations != null ? { operations: totalOperations } : {}),
    },
    apis,
  }, [
    { tool: 'get_asset_by_id', args: { instance_name, asset_id: '<API or endpoint asset id from apis>' }, why: 'Drill into a specific API/endpoint asset.' },
    { tool: 'query_assets', args: { instance_name, asset_type_name: 'REST API' }, why: 'Browse all REST API assets generically.' },
  ], true);
}
