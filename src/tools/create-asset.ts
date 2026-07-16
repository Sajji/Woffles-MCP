import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';
import { fetchAssetTypeAssignments } from '../utils/operating-model-cache.js';

export const createAssetTool = {
  name: 'create_asset',
  description:
    'Create a new asset in Collibra with optional attribute values. ' +
    'Use prepare_create_asset first to resolve the assetTypeId and domainId and check for duplicates. ' +
    'Optionally supply a map of attribute type UUID → value to set attributes at creation time. ' +
    'Use get_attribute_types to find attribute type UUIDs. ' +
    'Enforces required attributes: if the asset type\'s own assignment declares mandatory attributes ' +
    'that are not supplied, the call is rejected (with the list of missing attributes) before anything is created. ' +
    'Gates on duplicate name: by default a same-name asset in the same domain+type blocks creation; pass allow_duplicate=true to override. ' +
    'For creating 2 or more assets at once, prefer bulk_create_assets — it uses /assets/bulk and /attributes/bulk for far fewer round trips. ' +
    'Call plan_write_operation if unsure which tool to use.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the asset to create',
      },
      asset_type_id: {
        type: 'string',
        description: 'UUID of the asset type (from prepare_create_asset resolved.assetTypeId)',
      },
      domain_id: {
        type: 'string',
        description: 'UUID of the target domain (from prepare_create_asset resolved.domainId)',
      },
      display_name: {
        type: 'string',
        description: 'Optional: Display name for the asset (if different from name)',
      },
      status_id: {
        type: 'string',
        description:
          'Optional: UUID of the workflow status to set on the asset at creation time ' +
          '(e.g. Accepted, Candidate, Deprecated). ' +
          'Use get_asset_statuses to find valid status UUIDs for the target instance.',
      },
      attributes: {
        type: 'object',
        description:
          'Optional: Map of attribute type UUID to string value. ' +
          'For BOOLEAN: "true"/"false". For NUMERIC: number as string. ' +
          'For MULTI_VALUE_LIST: comma-separated values. ' +
          'Use get_attribute_types to find attribute type UUIDs.',
        additionalProperties: { type: 'string' },
      },
      allow_duplicate: {
        type: 'boolean',
        description:
          'Optional: When false (default), creation is blocked if an asset with the same name already exists ' +
          'in the same domain and asset type. Set true to create anyway.',
        default: false,
      },
    },
    required: ['instance_name', 'name', 'asset_type_id', 'domain_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateAsset(args: any): Promise<ToolResult> {
  const { instance_name, name, asset_type_id, domain_id, display_name, status_id, attributes, allow_duplicate = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Pre-flight: enforce required attributes declared by the asset type's
    // own assignment. If any mandatory attribute is missing from `attributes`,
    // reject before creating anything so we never leave an invalid asset.
    try {
      const assignments = await fetchAssetTypeAssignments(instance_name, asset_type_id);
      const provided = new Set(Object.keys((attributes as Record<string, string>) || {}));
      const missingRequired = assignments.attributeTypes
        .filter((a) => (a.minimumOccurrences ?? 0) >= 1 && !provided.has(a.id))
        .map((a) => ({ id: a.id, name: a.name }));
      if (missingRequired.length > 0) {
        return okWithNext(
          {
            error: true,
            instance: instance_name,
            message:
              `Cannot create asset "${name}": the asset type requires ${missingRequired.length} attribute(s) that were not supplied. ` +
              `Provide values for the missing attributes (keyed by their type UUID) in "attributes", then retry.`,
            missingRequiredAttributes: missingRequired,
          },
          [
            { tool: 'describe_asset_type', args: { instance_name, asset_type_id }, why: 'Inspect required/optional attributes and eligible statuses for this asset type.' },
            { tool: 'get_attribute_types', args: { instance_name }, why: 'Look up attribute type UUIDs to fill in the required values.' },
          ],
          true,
        );
      }
    } catch {
      // Assignment surface unavailable (e.g. endpoint/permission) — skip
      // enforcement rather than block a legitimate create.
    }

    // ── Pre-flight: duplicate-name gate (unless allow_duplicate=true).
    if (!allow_duplicate) {
      const dupUrl =
        `/rest/2.0/assets?name=${encodeURIComponent(name)}&nameMatchMode=EXACT` +
        `&domainId=${encodeURIComponent(domain_id)}&typeId=${encodeURIComponent(asset_type_id)}&limit=5`;
      const dup = await client.restCall<any>(dupUrl).catch(() => ({ results: [] }));
      const existing: any[] = dup.results || [];
      if (existing.length > 0) {
        return okWithNext(
          {
            error: true,
            instance: instance_name,
            message:
              `An asset named "${name}" already exists in this domain for this asset type. ` +
              `Pass allow_duplicate=true to create anyway, or edit the existing asset instead.`,
            existing: existing.map((a) => ({ id: a.id, name: a.name, url: client.assetUrl(a.id) })),
          },
          [
            { tool: 'get_asset_by_id', args: { instance_name, asset_id: existing[0].id }, why: 'Inspect the existing asset before duplicating.' },
            { tool: 'edit_asset', args: { instance_name, asset_id: existing[0].id, operations: [] }, why: 'Edit the existing asset instead of creating a duplicate.' },
          ],
          true,
        );
      }
    }

    // Create the asset
    const assetBody: any = {
      name,
      typeId: asset_type_id,
      domainId: domain_id,
    };
    if (display_name) {
      assetBody.displayName = display_name;
    }
    if (status_id) {
      assetBody.statusId = status_id;
    }

    const assetResp = await client.restCallWithBody<any>('/rest/2.0/assets', 'POST', assetBody);
    const assetId: string = assetResp.id;

    // Create attributes (if any) via a single bulk POST instead of N round trips
    const createdAttributes: any[] = [];
    const attributeErrors: any[] = [];

    if (attributes && typeof attributes === 'object') {
      const attrEntries = Object.entries(attributes as Record<string, string>);
      if (attrEntries.length > 0) {
        const bulkBody = attrEntries.map(([typeId, value]) => ({ assetId, typeId, value }));
        try {
          const bulkResp = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', bulkBody);
          (bulkResp || []).forEach((attrResp: any, idx: number) => {
            const [typeId, value] = attrEntries[idx];
            createdAttributes.push({ typeId, value, attributeId: attrResp?.id });
          });
        } catch (bulkErr) {
          // If the bulk call fails outright, surface the error per requested attribute
          for (const [typeId, value] of attrEntries) {
            attributeErrors.push({ typeId, value, error: (bulkErr as Error).message });
          }
        }
      }
    }

    const output: any = {
      success: true,
      asset: {
        id: assetId,
        name: assetResp.name,
        displayName: assetResp.displayName || null,
        type: assetResp.type,
        domain: assetResp.domain,
        url: client.assetUrl(assetId),
      },
    };

    if (createdAttributes.length > 0) {
      output.attributesCreated = createdAttributes;
    }
    if (attributeErrors.length > 0) {
      output.attributeErrors = attributeErrors;
      output.warning =
        'Asset was created successfully but some attributes could not be set. See attributeErrors for details.';
    }

    return okWithNext(output, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id: assetId }, why: 'Verify the newly created asset.' },
      { tool: 'update_asset_attribute', args: { instance_name, asset_id: assetId, attribute_type_id: '<from get_attribute_types>', value: '<value>' }, why: 'Add or update attributes on the new asset.' },
      { tool: 'add_business_term', args: { instance_name, asset_id: assetId, business_term_id: '<from search_assets_by_name>' }, why: 'Link a business term to the new asset.' },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
