import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

export const getDomainTypesTool = {
  name: 'get_domain_types',
  description:
    'Retrieve all domain types from a Collibra instance. ' +
    'Domain types define the kind of content a domain holds (e.g. Glossary, Physical Data Dictionary, ' +
    'Report Catalog, Data Product Catalog, Technology Asset Domain, Policy Domain). ' +
    'Use this tool before creating domains to find the correct type_id for the target instance. ' +
    'Useful for operating model comparison and cross-instance migration where the same type may ' +
    'have a different UUID in each instance.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter by name (partial match supported)',
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

export async function executeGetDomainTypes(args: any): Promise<ToolResult> {
  const { instance_name, name } = args;

  const { client } = clientFor(instance_name);

  // Small, fixed set: fetch every page instead of silently truncating at one.
  const params: Record<string, string> = { sortField: 'NAME', sortOrder: 'ASC' };
  if (name) {
    params.name = name;
    params.nameMatchMode = 'ANYWHERE';
  }
  const results = await client.restPaginate<any>('/rest/2.0/domainTypes', params);
  const response = { results, total: results.length };

  return okWithNext({
    instance: instance_name,
    total: response.total ?? (response.results || []).length,
    domainTypes: (response.results || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description || undefined,
      publicId: t.publicId || undefined,
    })),
  }, [
    { tool: 'describe_domain_type', args: { instance_name, name: '<pick from domainTypes>' }, why: 'See likely asset types for this domain type.' },
    { tool: 'create_domain', args: { instance_name, name: '<domain name>', community_id: '<community uuid>', type_id: '<pick from domainTypes>' }, why: 'Create a domain of this type once a community is chosen.' },
  ], true);
}
