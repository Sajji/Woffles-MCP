import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const prepareCreateAssetTool = {
  name: 'prepare_create_asset',
  description:
    'Pre-flight check before calling create_asset. ' +
    'Resolves the asset type (by name or UUID) and domain (by name or UUID), hydrates the available attribute schema, ' +
    'and checks for duplicate asset names. ' +
    'Returns a status of "ready" when both assetTypeId and domainId are resolved, ' +
    '"incomplete" when required information is missing, ' +
    '"needs_clarification" when the type or domain name matches multiple candidates (returns up to 20 options), ' +
    'or "duplicate_found" when an asset with the same name already exists in that domain. ' +
    'Pass the resolved assetTypeId and domainId from this response to create_asset.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_name: {
        type: 'string',
        description: 'The name of the asset to create',
      },
      asset_type_id: {
        type: 'string',
        description: 'Optional: UUID of the asset type. Provide this or asset_type_name.',
      },
      asset_type_name: {
        type: 'string',
        description: 'Optional: Name of the asset type to search for. Provide this or asset_type_id.',
      },
      domain_id: {
        type: 'string',
        description: 'Optional: UUID of the target domain. Provide this or domain_name.',
      },
      domain_name: {
        type: 'string',
        description: 'Optional: Name of the target domain to search for. Provide this or domain_id.',
      },
    },
    required: ['instance_name', 'asset_name'],
  },
};

export async function executePrepareCreateAsset(args: any): Promise<string> {
  const { instance_name, asset_name, asset_type_id, asset_type_name, domain_id, domain_name } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const result: any = {
      instance: instance_name,
      assetName: asset_name,
      status: 'incomplete',
      resolved: {},
      instructions: '',
    };

    // --- Resolve asset type ---
    let resolvedTypeId: string | null = asset_type_id || null;
    let resolvedTypeName: string | null = null;

    if (!resolvedTypeId && asset_type_name) {
      const typesResp = await client.restCall<any>(
        `/rest/2.0/assetTypes?name=${encodeURIComponent(asset_type_name)}&nameMatchMode=ANYWHERE&limit=20&offset=0`,
      );
      const matches: any[] = typesResp.results || [];
      if (matches.length === 0) {
        result.status = 'incomplete';
        result.instructions = `No asset type found matching "${asset_type_name}". Use get_asset_types to list available types.`;
        return JSON.stringify(result, null, 2);
      }
      if (matches.length === 1) {
        resolvedTypeId = matches[0].id;
        resolvedTypeName = matches[0].name;
      } else {
        result.status = 'needs_clarification';
        result.instructions = `Multiple asset types match "${asset_type_name}". Specify one of the options below as asset_type_id.`;
        result.assetTypeOptions = matches.map((t: any) => ({ id: t.id, name: t.name, publicId: t.publicId }));
        return JSON.stringify(result, null, 2);
      }
    } else if (resolvedTypeId) {
      try {
        const typeResp = await client.restCall<any>(`/rest/2.0/assetTypes/${resolvedTypeId}`);
        resolvedTypeName = typeResp.name;
      } catch {
        result.status = 'incomplete';
        result.instructions = `Asset type with id "${resolvedTypeId}" was not found.`;
        return JSON.stringify(result, null, 2);
      }
    }

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
    }

    // --- Missing type or domain ---
    if (!resolvedTypeId && !resolvedDomainId) {
      result.status = 'incomplete';
      result.instructions = 'Provide asset_type_id (or asset_type_name) and domain_id (or domain_name) to proceed.';
      return JSON.stringify(result, null, 2);
    }
    if (!resolvedTypeId) {
      result.status = 'incomplete';
      result.instructions = 'Provide asset_type_id or asset_type_name to proceed.';
      return JSON.stringify(result, null, 2);
    }
    if (!resolvedDomainId) {
      result.status = 'incomplete';
      result.instructions = 'Provide domain_id or domain_name to proceed.';
      return JSON.stringify(result, null, 2);
    }

    // --- Duplicate check ---
    const dupResp = await client.restCall<any>(
      `/rest/2.0/assets?name=${encodeURIComponent(asset_name)}&nameMatchMode=EXACT&domainId=${resolvedDomainId}&typeId=${resolvedTypeId}&limit=5&offset=0`,
    );
    const duplicates: any[] = dupResp.results || [];
    if (duplicates.length > 0) {
      result.status = 'duplicate_found';
      result.instructions = `An asset named "${asset_name}" of this type already exists in this domain. Review the existing assets below or choose a different name.`;
      result.duplicates = duplicates.map((a: any) => ({
        id: a.id,
        name: a.name,
        url: client.assetUrl(a.id),
      }));
      result.resolved = { assetTypeId: resolvedTypeId, assetTypeName: resolvedTypeName, domainId: resolvedDomainId, domainName: resolvedDomainName };
      return JSON.stringify(result, null, 2);
    }

    // --- All good ---
    result.status = 'ready';
    result.instructions = 'Call create_asset with the resolved assetTypeId and domainId below.';
    result.resolved = {
      assetTypeId: resolvedTypeId,
      assetTypeName: resolvedTypeName,
      domainId: resolvedDomainId,
      domainName: resolvedDomainName,
    };

    return JSON.stringify(result, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
