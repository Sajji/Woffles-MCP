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
    'Attributes the asset type marks as required (minimum occurrences ≥ 1) are not enforced at creation, matching Collibra itself: ' +
    'the asset is created and any missing ones are listed in missingRequiredAttributes so they can be filled in afterwards. ' +
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
          'Optional: UUID of the status to set on the asset at creation time. Omit it unless the user asked for a ' +
          'specific status; Collibra then applies the asset type\'s default. ' +
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

    // Collibra does not enforce an assignment's minimumOccurrences when an asset
    // is created (it only flags incompleteness), so neither do we: report any
    // missing "required" attributes after creating instead of blocking.
    let missingRequired: { id: string; name: string }[] = [];
    try {
      const assignments = await fetchAssetTypeAssignments(instance_name, asset_type_id);
      const provided = new Set(Object.keys((attributes as Record<string, string>) || {}));
      missingRequired = assignments.attributeTypes
        .filter((a) => (a.minimumOccurrences ?? 0) >= 1 && !provided.has(a.id))
        .map((a) => ({ id: a.id, name: a.name }));
    } catch {
      // Assignment lookup unavailable (endpoint/permission): nothing to report.
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
        // Markdown → HTML for values targeting RICH_TEXT attribute types
        const { entries: bulkBody, convertedTypeIds } = await client.convertRichTextEntries(
          attrEntries.map(([typeId, value]) => ({ assetId, typeId, value })),
        );
        try {
          const bulkResp = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', bulkBody);
          (bulkResp || []).forEach((attrResp: any, idx: number) => {
            const { typeId, value } = bulkBody[idx];
            createdAttributes.push({
              typeId,
              value,
              attributeId: attrResp?.id,
              ...(convertedTypeIds.includes(typeId) ? { markdownConverted: true } : {}),
            });
          });
        } catch (bulkErr) {
          // If the bulk call fails outright, surface the error per requested attribute
          for (const { typeId, value } of bulkBody) {
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
    const warnings: string[] = [];
    if (attributeErrors.length > 0) {
      output.attributeErrors = attributeErrors;
      warnings.push('Asset was created successfully but some attributes could not be set. See attributeErrors for details.');
    }
    if (missingRequired.length > 0) {
      output.missingRequiredAttributes = missingRequired;
      warnings.push(
        `The asset type marks ${missingRequired.length} attribute(s) as required that were not supplied: ` +
        `${missingRequired.map((a) => a.name).join(', ')}. The asset was created anyway; fill them in with edit_asset when the values are known.`,
      );
    }
    if (warnings.length) output.warning = warnings.join(' ');

    return okWithNext(output, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id: assetId }, why: 'Verify the newly created asset.' },
      {
        tool: 'edit_asset',
        args: { instance_name, asset_id: assetId, operations: [{ op: 'update_attribute', attribute_type_id: missingRequired[0]?.id ?? '<from get_attribute_types>', value: '<value>' }] },
        why: missingRequired.length ? 'Fill in the attributes the asset type marks as required.' : 'Add or update attributes on the new asset.',
      },
      {
        tool: 'create_relation',
        args: { instance_name, source_asset_id: assetId, target_asset_id: '<business term UUID from search_assets_by_name>', relation_type_id: '<from get_relation_types>' },
        why: 'Link the new asset to a business term or other asset.',
      },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
