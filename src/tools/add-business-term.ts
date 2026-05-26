import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const BUSINESS_TERM_TYPE_NAME = 'Business Term';
const DEFINITION_ATTR_TYPE_ID = '00000000-0000-0000-0000-000000000202';

export const addBusinessTermTool = {
  name: 'add_business_term',
  description:
    'Create a Business Term asset in Collibra with an optional definition and additional attributes. ' +
    'Use prepare_add_business_term first to resolve the domainId and check for duplicates. ' +
    'Use get_attribute_types to find attribute type UUIDs for additional attributes.',
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
};

export async function executeAddBusinessTerm(args: any): Promise<string> {
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
      return JSON.stringify({
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

    // Add definition attribute if provided
    if (definition) {
      try {
        const attrResp = await client.restCallWithBody<any>('/rest/2.0/attributes', 'POST', {
          assetId,
          typeId: DEFINITION_ATTR_TYPE_ID,
          value: definition,
        });
        createdAttributes.push({ typeId: DEFINITION_ATTR_TYPE_ID, name: 'Definition', value: definition, attributeId: attrResp.id });
      } catch (attrErr) {
        attributeErrors.push({ typeId: DEFINITION_ATTR_TYPE_ID, name: 'Definition', error: (attrErr as Error).message });
      }
    }

    // Add additional attributes if provided
    if (Array.isArray(attributes)) {
      for (const attr of attributes) {
        try {
          const attrResp = await client.restCallWithBody<any>('/rest/2.0/attributes', 'POST', {
            assetId,
            typeId: attr.type_id,
            value: attr.value,
          });
          createdAttributes.push({ typeId: attr.type_id, value: attr.value, attributeId: attrResp.id });
        } catch (attrErr) {
          attributeErrors.push({ typeId: attr.type_id, value: attr.value, error: (attrErr as Error).message });
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

    return JSON.stringify(output, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
