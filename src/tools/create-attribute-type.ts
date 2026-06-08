import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const VALID_KINDS = [
  'STRING',
  'SINGLE_VALUE_LIST',
  'MULTI_VALUE_LIST',
  'NUMERIC',
  'DATE',
  'BOOLEAN',
  'SCRIPT',
] as const;

export const createAttributeTypeTool = {
  name: 'create_attribute_type',
  description:
    'Create an attribute type in the operating model of a Collibra instance ' +
    '(POST /rest/2.0/attributeTypes). An attribute type defines a reusable characteristic ' +
    '(e.g. "Identifier", "Access Level") that can later be assigned to one or more asset types ' +
    'via assign_attribute_to_asset_type, after which assets of those types can carry values for it. ' +
    'This tool is idempotent: if an attribute type with the same name already exists, the existing ' +
    'type is returned without creating a duplicate. ' +
    'Use get_attribute_types to browse existing types before creating new ones. ' +
    'For SINGLE_VALUE_LIST / MULTI_VALUE_LIST kinds, supply allowed_values to seed the picklist.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'The name of the new attribute type (must be unique across all attribute types)',
      },
      kind: {
        type: 'string',
        enum: [...VALID_KINDS],
        description:
          'The attribute type kind. One of: STRING, SINGLE_VALUE_LIST, MULTI_VALUE_LIST, NUMERIC, DATE, BOOLEAN, SCRIPT.',
      },
      description: {
        type: 'string',
        description: 'Optional: A description for the attribute type',
      },
      allowed_values: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: List of allowed values. Only applicable to SINGLE_VALUE_LIST and MULTI_VALUE_LIST kinds.',
      },
      string_type: {
        type: 'string',
        enum: ['PLAIN_TEXT', 'RICH_TEXT'],
        description: 'Optional: For STRING kind only. PLAIN_TEXT (default) or RICH_TEXT.',
      },
      is_integer: {
        type: 'boolean',
        description: 'Optional: For NUMERIC kind only. Whether the attribute holds an integer value.',
      },
      statistics_enabled: {
        type: 'boolean',
        description: 'Optional: For NUMERIC or BOOLEAN kind only. Whether statistics are enabled.',
      },
      public_id: {
        type: 'string',
        description:
          'Optional: Public id. Must start with an uppercase ASCII letter and end with "_C". ' +
          'A valid public id is generated automatically if omitted.',
      },
    },
    required: ['instance_name', 'name', 'kind'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeCreateAttributeType(args: any): Promise<ToolResult> {
  const {
    instance_name,
    name,
    kind,
    description,
    allowed_values,
    string_type,
    is_integer,
    statistics_enabled,
    public_id,
  } = args;

  try {
    if (!VALID_KINDS.includes(kind)) {
      return ok({
        error: true,
        message: `Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(', ')}.`,
        instance: instance_name,
      });
    }

    const isListKind = kind === 'SINGLE_VALUE_LIST' || kind === 'MULTI_VALUE_LIST';
    if (allowed_values && allowed_values.length && !isListKind) {
      return ok({
        error: true,
        message: `allowed_values is only applicable to SINGLE_VALUE_LIST or MULTI_VALUE_LIST (got "${kind}").`,
        instance: instance_name,
      });
    }

    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Idempotency check ─────────────────────────────────────────────
    const checkParams = new URLSearchParams({
      name,
      nameMatchMode: 'EXACT',
      limit: '5',
      offset: '0',
    });

    const existing = await client.restCall<any>(`/rest/2.0/attributeTypes?${checkParams.toString()}`);
    const match = (existing.results || []).find((t: any) => t.name === name);

    if (match) {
      return okPretty({
        action: 'existing',
        attributeType: {
          id: match.id,
          name: match.name,
          kind: match.resourceType || match.attributeTypeDiscriminator || null,
          description: match.description || null,
          publicId: match.publicId || null,
          allowedValues: match.allowedValues || undefined,
        },
        message: `Attribute type "${name}" already exists — no changes made.`,
      });
    }

    // ── Create ────────────────────────────────────────────────────────
    const body: any = { name, kind };
    if (description) body.description = description;
    if (isListKind && allowed_values && allowed_values.length) body.allowedValues = allowed_values;
    if (kind === 'STRING' && string_type) body.stringType = string_type;
    if (kind === 'NUMERIC' && typeof is_integer === 'boolean') body.isInteger = is_integer;
    // Collibra requires statisticsEnabled to be explicitly set for NUMERIC and BOOLEAN kinds.
    if (kind === 'NUMERIC' || kind === 'BOOLEAN') {
      body.statisticsEnabled = typeof statistics_enabled === 'boolean' ? statistics_enabled : false;
    }
    if (public_id) body.publicId = public_id;

    const created = await client.restCallWithBody<any>('/rest/2.0/attributeTypes', 'POST', body);

    return okWithNext(
      {
        action: 'created',
        attributeType: {
          id: created.id,
          name: created.name,
          kind: created.resourceType || created.attributeTypeDiscriminator || kind,
          description: created.description || null,
          publicId: created.publicId || null,
          allowedValues: created.allowedValues || undefined,
        },
      },
      [
        {
          tool: 'assign_attribute_to_asset_type',
          args: { instance_name, asset_type_id: '<asset type id>', attribute_type_id: created.id },
          why: 'Assign the new attribute type to an asset type so its assets can carry values for it.',
        },
        {
          tool: 'refresh_operating_model',
          args: { instance_name, force: true },
          why: 'Refresh the cached model so the new attribute type is discoverable.',
        },
        {
          tool: 'validate_against_model',
          args: { instance_name, proposal_type: 'attribute', attribute_type_id: created.id },
          why: 'Schema-validate writes that use this attribute type.',
        },
      ],
      true,
    );
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
