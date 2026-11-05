import { okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { narrowToExact } from '../utils/resolve.js';
import { clientFor } from './_context.js';
import { attrKindFromDiscriminator } from '../utils/collibra-client.js';
import { fetchApplicableAssignment } from '../utils/operating-model-cache.js';

export const prepareCreateAssetTool = {
  name: 'prepare_create_asset',
  description:
    'Pre-flight check and creation plan before calling bulk_create_assets (works for any asset type, including Business Terms). ' +
    'Resolves the asset type (by name or UUID) and domain (by name or UUID), checks for duplicate asset names, and — from the ' +
    'operating-model assignment that applies in that domain — returns requiredAttributes, assignableAttributes, eligibleStatuses ' +
    'and a suggestedStatus, plus a ready-to-fill bulk_create_assets call. ' +
    'Returns a status of "ready" when both assetTypeId and domainId are resolved, ' +
    '"incomplete" when required information is missing, ' +
    '"needs_clarification" when the type or domain name matches multiple candidates (returns up to 20 options), ' +
    'or "duplicate_found" when an asset with the same name already exists in that domain. ' +
    'Pass the resolved assetTypeId and domainId from this response to bulk_create_assets.',
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
      preferred_status_name: {
        type: 'string',
        description: 'Optional: status to suggest if eligible (otherwise the type\'s default / a Candidate status).',
      },
    },
    required: ['instance_name', 'asset_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executePrepareCreateAsset(args: any): Promise<ToolResult> {
  const { instance_name, asset_name, asset_type_id, asset_type_name, domain_id, domain_name, preferred_status_name } = args;

  const { client } = clientFor(instance_name);

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
    // An exact name ("Table") wins over partial hits ("Table View", "Database Table").
    const matches: any[] = narrowToExact(typesResp.results || [], asset_type_name, (t: any) => t.name);
    if (matches.length === 0) {
      result.status = 'incomplete';
      result.instructions = `No asset type found matching "${asset_type_name}". Use get_asset_types to list available types.`;
      return okPretty(result);
    }
    if (matches.length === 1) {
      resolvedTypeId = matches[0].id;
      resolvedTypeName = matches[0].name;
    } else {
      result.status = 'needs_clarification';
      result.instructions = `Multiple asset types match "${asset_type_name}". Specify one of the options below as asset_type_id.`;
      result.assetTypeOptions = matches.map((t: any) => ({ id: t.id, name: t.name, publicId: t.publicId }));
      return okPretty(result);
    }
  } else if (resolvedTypeId) {
    try {
      const typeResp = await client.restCall<any>(`/rest/2.0/assetTypes/${encodeURIComponent(resolvedTypeId)}`);
      resolvedTypeName = typeResp.name;
    } catch {
      result.status = 'incomplete';
      result.instructions = `Asset type with id "${resolvedTypeId}" was not found.`;
      return okPretty(result);
    }
  }

  // --- Resolve domain ---
  let resolvedDomainId: string | null = domain_id || null;
  let resolvedDomainName: string | null = null;

  if (!resolvedDomainId && domain_name) {
    const domainsResp = await client.restCall<any>(
      `/rest/2.0/domains?name=${encodeURIComponent(domain_name)}&nameMatchMode=ANYWHERE&limit=20&offset=0`,
    );
    const domainMatches: any[] = narrowToExact(domainsResp.results || [], domain_name, (d: any) => d.name);
    if (domainMatches.length === 0) {
      result.status = 'incomplete';
      result.instructions = `No domain found matching "${domain_name}". Use get_domains to list available domains.`;
      return okPretty(result);
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
      return okPretty(result);
    }
  } else if (resolvedDomainId) {
    try {
      const domainResp = await client.restCall<any>(`/rest/2.0/domains/${encodeURIComponent(resolvedDomainId)}`);
      resolvedDomainName = domainResp.name;
    } catch {
      result.status = 'incomplete';
      result.instructions = `Domain with id "${resolvedDomainId}" was not found.`;
      return okPretty(result);
    }
  }

  // --- Missing type or domain ---
  if (!resolvedTypeId && !resolvedDomainId) {
    result.status = 'incomplete';
    result.instructions = 'Provide asset_type_id (or asset_type_name) and domain_id (or domain_name) to proceed.';
    return okPretty(result);
  }
  if (!resolvedTypeId) {
    result.status = 'incomplete';
    result.instructions = 'Provide asset_type_id or asset_type_name to proceed.';
    return okPretty(result);
  }
  if (!resolvedDomainId) {
    result.status = 'incomplete';
    result.instructions = 'Provide domain_id or domain_name to proceed.';
    return okPretty(result);
  }

  // --- Duplicate check ---
  const dupResp = await client.restCall<any>(
    `/rest/2.0/assets?name=${encodeURIComponent(asset_name)}&nameMatchMode=EXACT&domainId=${encodeURIComponent(resolvedDomainId)}&typeId=${encodeURIComponent(resolvedTypeId)}&limit=5&offset=0`,
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
    return okPretty(result);
  }

  // --- All good ---
  result.status = 'ready';
  result.resolved = {
    assetTypeId: resolvedTypeId,
    assetTypeName: resolvedTypeName,
    domainId: resolvedDomainId,
    domainName: resolvedDomainName,
  };

  // Creation plan from the assignment that applies in this domain (live — no
  // cached model needed): assignable/required attributes and a status to use.
  const assignment = await fetchApplicableAssignment(instance_name, resolvedTypeId, resolvedDomainId).catch(() => null);
  const exampleAttributes: Record<string, string> = {};
  if (assignment) {
    const attrs = assignment.attributeTypes.map((t) => ({
      id: t.id,
      name: t.name,
      kind: attrKindFromDiscriminator(t.kind) ?? t.kind,
      required: (t.minimumOccurrences ?? 0) >= 1,
    }));
    result.requiredAttributes = attrs.filter((a) => a.required);
    result.assignableAttributes = attrs;
    const statuses = assignment.eligibleStatuses;
    const status =
      (preferred_status_name && statuses.find((s) => s.name.toLowerCase() === String(preferred_status_name).toLowerCase())) ||
      statuses.find((s) => s.id === assignment.defaultStatusId) ||
      statuses.find((s) => /candidate/i.test(s.name)) ||
      statuses[0];
    result.suggestedStatus = status ?? null;
    result.eligibleStatuses = statuses;
    for (const a of result.requiredAttributes) exampleAttributes[a.id] = `<${a.name}>`;
  } else {
    result.warnings = ['Could not determine the applicable assignment; attribute and status guidance is unavailable.'];
  }
  result.instructions =
    'Call bulk_create_assets with the resolved assetTypeId and domainId' +
    (result.requiredAttributes?.length ? ', and values for every requiredAttributes entry (keyed by attribute type UUID)' : '') +
    '. Pass a single-element array for one asset, or extend the array for a batch.';

  return okWithNext(result, [
    {
      tool: 'bulk_create_assets',
      args: {
        instance_name,
        assets: [{
          name: asset_name,
          asset_type_id: resolvedTypeId,
          domain_id: resolvedDomainId,
          ...(result.suggestedStatus ? { status_id: result.suggestedStatus.id } : {}),
          ...(Object.keys(exampleAttributes).length ? { attributes: exampleAttributes } : {}),
        }],
        confirm: false,
      },
      why: 'Preview then confirm the create with bulk_create_assets (works for single or multiple assets).',
    },
  ], true);
}
