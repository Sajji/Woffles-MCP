import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const createAssetTool = {
  name: 'create_asset',
  description:
    'Create a new asset in Collibra with optional attribute values. ' +
    'Use prepare_create_asset first to resolve the assetTypeId and domainId and check for duplicates. ' +
    'Optionally supply a map of attribute type UUID → value to set attributes at creation time. ' +
    'Use get_attribute_types to find attribute type UUIDs.',
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
  const { instance_name, name, asset_type_id, domain_id, display_name, status_id, attributes } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

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

    // Create attributes if provided
    const createdAttributes: any[] = [];
    const attributeErrors: any[] = [];

    if (attributes && typeof attributes === 'object') {
      const attrEntries = Object.entries(attributes as Record<string, string>);
      await Promise.all(
        attrEntries.map(async ([typeId, value]) => {
          try {
            const attrResp = await client.restCallWithBody<any>('/rest/2.0/attributes', 'POST', {
              assetId,
              typeId,
              value,
            });
            createdAttributes.push({ typeId, value, attributeId: attrResp.id });
          } catch (attrErr) {
            attributeErrors.push({ typeId, value, error: (attrErr as Error).message });
          }
        }),
      );
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

    return okPretty(output);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
