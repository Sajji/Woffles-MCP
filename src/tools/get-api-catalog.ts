import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getApiCatalogTool = {
  name: 'get_api_catalog',
  description:
    'Traverse the Army REST API catalog hierarchy: REST API → REST API Version → REST API Endpoint → REST API Operation. ' +
    'Returns a structured tree showing all cataloged APIs, their versioned releases, endpoint paths, and the HTTP operations on each path. ' +
    'Use this tool to discover what REST APIs exist, understand their endpoint surface area, find specific operations, ' +
    'and navigate to assets for cross-domain linking (governance, lineage, classification). ' +
    'Use include_operations=false for a compact summary when exploring large catalogs. ' +
    'Prerequisites: the REST API operating model must be configured (run setupArmyRestApiModel.mjs first).',
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
        description: 'Maximum number of top-level REST API assets to return (default: 50).',
        default: 50,
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

// ── GraphQL query builder ─────────────────────────────────────────────────────
function buildApiCatalogQuery(nameFilter: string | undefined, limit: number): string {
  const nameCondition = nameFilter
    ? `, name: { contains: "${nameFilter.replace(/"/g, '')}" }`
    : '';
  const whereClause = `where: { type: { name: { eq: "REST API" } }${nameCondition} }`;

  return `
    {
      assets(limit: ${limit}, ${whereClause}) {
        id
        fullName
        displayName
        stringAttributes     { type { name } stringValue }
        multiValueAttributes { type { name } stringValues }
        outgoingRelations(limit: 50) {
          type { role }
          target {
            id fullName displayName
            stringAttributes { type { name } stringValue }
            outgoingRelations(limit: 100) {
              type { role }
              target {
                id fullName displayName
                stringAttributes     { type { name } stringValue }
                multiValueAttributes { type { name } stringValues }
                booleanAttributes    { type { name } booleanValue }
                outgoingRelations(limit: 200) {
                  type { role }
                  target {
                    id fullName displayName
                    stringAttributes  { type { name } stringValue }
                    booleanAttributes { type { name } booleanValue }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

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
  const { instance_name, api_name, include_operations = true, limit = 50 } = args;

  try {
    const instance = getInstance(instance_name);
    const client   = new CollibraClient(instance);

    const query    = buildApiCatalogQuery(api_name, limit);
    const response = await client.graphqlQuery<{ data: { assets: any[] } }>(query);
    const rawApis  = response.data?.assets ?? [];

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
      { tool: 'query_assets', args: { instance_name, asset_type_name: 'API' }, why: 'Browse all API assets generically.' },
    ], true);

  } catch (error) {
    return ok({
      error:    true,
      message:  (error as Error).message,
      instance: instance_name,
    });
  }
}
