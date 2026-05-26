import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

// The fixed public ID for the Business Term asset type in Collibra
const BUSINESS_TERM_TYPE_PUBLIC_ID = 'BusinessTerm';
// The fixed attribute type UUID for the Definition attribute
const DEFINITION_ATTR_TYPE_ID = '00000000-0000-0000-0000-000000000202';

export const prepareAddBusinessTermTool = {
  name: 'prepare_add_business_term',
  description:
    'Pre-flight check before calling add_business_term. ' +
    'Resolves the target domain (by name or UUID), checks for duplicate business terms with the same name, ' +
    'and returns the available attribute schema (e.g., Definition, Note, Example). ' +
    'Returns a status of "ready" when domain is resolved and no duplicate found, ' +
    '"incomplete" when required information is missing, ' +
    '"needs_clarification" when the domain name matches multiple candidates (returns up to 20 options), ' +
    'or "duplicate_found" when a business term with the same name already exists in that domain. ' +
    'Pass the resolved domainId from this response to add_business_term.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the business term to create',
      },
      domain_id: {
        type: 'string',
        description: 'Optional: UUID of the target Glossary domain. Provide this or domain_name.',
      },
      domain_name: {
        type: 'string',
        description: 'Optional: Name of the target Glossary domain to search for. Provide this or domain_id.',
      },
    },
    required: ['instance_name', 'name'],
  },
};

export async function executePrepareAddBusinessTerm(args: any): Promise<string> {
  const { instance_name, name, domain_id, domain_name } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const result: any = {
      instance: instance_name,
      termName: name,
      status: 'incomplete',
      resolved: {},
      instructions: '',
    };

    // --- Resolve domain ---
    let resolvedDomainId: string | null = domain_id || null;
    let resolvedDomainName: string | null = null;

    if (!resolvedDomainId && domain_name) {
      const domainsResp = await client.restCall<any>(
        `/rest/2.0/domains?name=${encodeURIComponent(domain_name)}&nameMatchMode=ANYWHERE&limit=20&offset=0`,
      );
      const domainMatches: any[] = domainsResp.results || [];
      if (domainMatches.length === 0) {
        result.status = 'incomplete';
        result.instructions = `No domain found matching "${domain_name}". Use get_domains to list available domains.`;
        return JSON.stringify(result, null, 2);
      }
      if (domainMatches.length === 1) {
        resolvedDomainId = domainMatches[0].id;
        resolvedDomainName = domainMatches[0].name;
      } else {
        result.status = 'needs_clarification';
        result.instructions = `Multiple domains match "${domain_name}". Specify one of the options below as domain_id.`;
        result.domainOptions = domainMatches.map((d: any) => ({
          id: d.id,
          name: d.name,
          community: d.community?.name,
        }));
        return JSON.stringify(result, null, 2);
      }
    } else if (resolvedDomainId) {
      try {
        const domainResp = await client.restCall<any>(`/rest/2.0/domains/${resolvedDomainId}`);
        resolvedDomainName = domainResp.name;
      } catch {
        result.status = 'incomplete';
        result.instructions = `Domain with id "${resolvedDomainId}" was not found.`;
        return JSON.stringify(result, null, 2);
      }
    } else {
      result.status = 'incomplete';
      result.instructions = 'Provide domain_id or domain_name to proceed.';
      return JSON.stringify(result, null, 2);
    }

    // --- Resolve the Business Term asset type ID ---
    let businessTermTypeId: string | null = null;
    try {
      const typeResp = await client.restCall<any>(
        `/rest/2.0/assetTypes?name=Business+Term&nameMatchMode=EXACT&limit=5&offset=0`,
      );
      const typeMatches: any[] = typeResp.results || [];
      if (typeMatches.length > 0) {
        businessTermTypeId = typeMatches[0].id;
      }
    } catch {
      // Non-critical — we can still proceed with duplicate check using name alone
    }

    // --- Duplicate check ---
    const dupParams = new URLSearchParams({
      name: name,
      nameMatchMode: 'EXACT',
      domainId: resolvedDomainId!,
      limit: '5',
      offset: '0',
    });
    if (businessTermTypeId) {
      dupParams.append('typeId', businessTermTypeId);
    }
    const dupResp = await client.restCall<any>(`/rest/2.0/assets?${dupParams.toString()}`);
    const duplicates: any[] = dupResp.results || [];

    if (duplicates.length > 0) {
      result.status = 'duplicate_found';
      result.instructions = `A business term named "${name}" already exists in this domain. Review the existing terms below or choose a different name.`;
      result.duplicates = duplicates.map((a: any) => ({
        id: a.id,
        name: a.name,
        url: client.assetUrl(a.id),
      }));
      result.resolved = { domainId: resolvedDomainId, domainName: resolvedDomainName };
      return JSON.stringify(result, null, 2);
    }

    // --- Hydrate attribute schema ---
    let attributeSchema: any[] = [];
    try {
      const attrTypesResp = await client.restCall<any>(
        `/rest/2.0/attributeTypes?limit=50&offset=0`,
      );
      const relevantNames = ['Definition', 'Note', 'Example', 'Short Description'];
      attributeSchema = (attrTypesResp.results || [])
        .filter((t: any) => relevantNames.some(n => t.name?.toLowerCase().includes(n.toLowerCase())))
        .map((t: any) => ({ id: t.id, name: t.name, kind: t.kind }));
    } catch {
      // Non-critical
    }

    // --- All good ---
    result.status = 'ready';
    result.instructions =
      'Call add_business_term with the resolved domainId. ' +
      'Optionally include a definition and/or additional attributes from attributeSchema.';
    result.resolved = {
      domainId: resolvedDomainId,
      domainName: resolvedDomainName,
      definitionAttributeTypeId: DEFINITION_ATTR_TYPE_ID,
    };
    if (attributeSchema.length > 0) {
      result.attributeSchema = attributeSchema;
    }

    return JSON.stringify(result, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
