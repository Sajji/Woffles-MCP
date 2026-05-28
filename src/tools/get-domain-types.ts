import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

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

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams({ limit: '200', offset: '0', sortField: 'NAME', sortOrder: 'ASC' });
    if (name) {
      params.set('name', name);
      params.set('nameMatchMode', 'ANYWHERE');
    }

    const response = await client.restCall<any>(`/rest/2.0/domainTypes?${params.toString()}`);

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

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
