import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const BUSINESS_TERM_TYPE_NAME = 'Business Term';
const DEFINITION_ATTR_TYPE_ID = '00000000-0000-0000-0000-000000000202';

export const addBusinessTermTool = {
  name: 'add_business_term',
  description:
    'Create a Business Term asset in Collibra with an optional definition and additional attributes. ' +
    'Use prepare_add_business_term first to resolve the domainId and check for duplicates. ' +
    'Use get_attribute_types to find attribute type UUIDs for additional attributes. ' +
    'For creating 2 or more business terms at once, prefer bulk_create_assets with the Business Term asset type and the Definition attribute type id (00000000-0000-0000-0000-000000000202). ' +
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
        description: 'The name of the business term to create',
      },
      domain_id: {
        type: 'string',
        description: 'UUID of the target Glossary domain (from prepare_add_business_term resolved.domainId)',
      },
      definition: {
        type: 'string',
        description: 'Optional: The definition text for the business term',
      },
      attributes: {
        type: 'array',
        description: 'Optional: Additional attributes to set on the business term',
        items: {
          type: 'object',
          properties: {
            type_id: {
              type: 'string',
              description: 'UUID of the attribute type (from get_attribute_types or prepare_add_business_term attributeSchema)',
            },
            value: {
              type: 'string',
              description: 'Value for the attribute',
            },
          },
          required: ['type_id', 'value'],
        },
      },
    },
    required: ['instance_name', 'name', 'domain_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeAddBusinessTerm(args: any): Promise<ToolResult> {
  const { instance_name, name, domain_id, definition, attributes } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Resolve the Business Term asset type ID
    let businessTermTypeId: string | null = null;
    const typeResp = await client.restCall<any>(
      `/rest/2.0/assetTypes?name=${encodeURIComponent(BUSINESS_TERM_TYPE_NAME)}&nameMatchMode=EXACT&limit=5&offset=0`,
    );
    const typeMatches: any[] = typeResp.results || [];
    if (typeMatches.length > 0) {
      businessTermTypeId = typeMatches[0].id;
    }

    if (!businessTermTypeId) {
      return ok({
        error: true,
        message: `Could not resolve the "${BUSINESS_TERM_TYPE_NAME}" asset type. Use get_asset_types to verify it exists in this instance.`,
        instance: instance_name,
      });
    }

    // Create the asset
    const assetResp = await client.restCallWithBody<any>('/rest/2.0/assets', 'POST', {
      name,
      typeId: businessTermTypeId,
      domainId: domain_id,
    });
    const assetId: string = assetResp.id;

    const createdAttributes: any[] = [];
    const attributeErrors: any[] = [];

    // Build a single bulk POST body covering the definition (if provided) and any extra attributes
    const bulkEntries: { typeId: string; value: string; label?: string }[] = [];
    if (definition) {
      bulkEntries.push({ typeId: DEFINITION_ATTR_TYPE_ID, value: definition, label: 'Definition' });
    }
    if (Array.isArray(attributes)) {
      for (const attr of attributes) {
        bulkEntries.push({ typeId: attr.type_id, value: attr.value });
      }
    }

    if (bulkEntries.length > 0) {
      const bulkBody = bulkEntries.map((e) => ({ assetId, typeId: e.typeId, value: e.value }));
      try {
        const bulkResp = await client.restCallWithBody<any[]>('/rest/2.0/attributes/bulk', 'POST', bulkBody);
        (bulkResp || []).forEach((attrResp: any, idx: number) => {
          const e = bulkEntries[idx];
          createdAttributes.push({
            typeId: e.typeId,
            ...(e.label ? { name: e.label } : {}),
            value: e.value,
            attributeId: attrResp?.id,
          });
        });
      } catch (bulkErr) {
        for (const e of bulkEntries) {
          attributeErrors.push({
            typeId: e.typeId,
            ...(e.label ? { name: e.label } : {}),
            value: e.value,
            error: (bulkErr as Error).message,
          });
        }
      }
    }

    const output: any = {
      success: true,
      businessTerm: {
        id: assetId,
        name: assetResp.name,
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
        'Business term was created successfully but some attributes could not be set. See attributeErrors for details.';
    }

    return okWithNext(output, [
      { tool: 'get_asset_by_id', args: { instance_name, asset_id: assetId }, why: 'Verify the newly created business term.' },
      { tool: 'get_asset_relations', args: { instance_name, asset_id: assetId }, why: 'See what the term is related to.' },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}