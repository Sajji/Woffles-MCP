import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * Map an AssignedCharacteristicType (GET shape) to a
 * CharacteristicTypeAssignmentReference (PATCH shape). The reference `id` is the
 * *resource* id (attribute/relation type id), NOT the wrapper entity id.
 * Relation references must always carry a direction.
 */
function toReference(c: any): { id: string; type: string; min?: number; max?: number; relationTypeDirection?: string; relationTypeRestriction?: string } | null {
  const min = c.minimumOccurrences;
  const max = c.maximumOccurrences;
  if (c.attributeType?.id) {
    return { id: c.attributeType.id, type: 'AttributeType', min, max };
  }
  if (c.relationType?.id) {
    const ref: any = { id: c.relationType.id, type: 'RelationType', min, max };
    if (c.roleDirection) ref.relationTypeDirection = c.roleDirection;
    if (c.restriction?.id) ref.relationTypeRestriction = c.restriction.id;
    return ref;
  }
  if (c.complexRelationType?.id) {
    return { id: c.complexRelationType.id, type: 'ComplexRelationType', min, max };
  }
  return null;
}

export const assignAttributeToAssetTypeTool = {
  name: 'assign_attribute_to_asset_type',
  description:
    'Assign an existing attribute type to an asset type so that assets of that type can carry ' +
    'values for it (the operating-model step that makes an attribute settable on a profile). ' +
    'Reads the asset type\'s assignment(s) (GET /rest/2.0/assignments/assetType/{id}), merges the new ' +
    'attribute into the existing characteristic list, and applies a PATCH /rest/2.0/assignments/{id} that ' +
    'preserves all existing attributes, relations and statuses. ' +
    'This tool is idempotent: if the attribute type is already assigned to every target assignment, no ' +
    'change is made. An asset type may have multiple assignments (one per eligible domain type); by default ' +
    'the attribute is added to all of them. Set dry_run=true to preview the merged characteristic list ' +
    'without writing. Use create_attribute_type first to obtain attribute_type_id, and get_asset_types to ' +
    'resolve asset_type_id.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_type_id: {
        type: 'string',
        description: 'UUID of the asset type whose profile gains the attribute. Use get_asset_types to resolve.',
      },
      attribute_type_id: {
        type: 'string',
        description: 'UUID of the attribute type to assign. Use create_attribute_type or get_attribute_types.',
      },
      assignment_id: {
        type: 'string',
        description:
          'Optional: target a single assignment by id. If omitted, the attribute is added to ALL ' +
          'assignments of the asset type.',
      },
      minimum_occurrences: {
        type: 'number',
        description: 'Optional: minimum occurrences for the attribute on this asset type. Default 0 (no restriction).',
      },
      maximum_occurrences: {
        type: 'number',
        description: 'Optional: maximum occurrences. Default 1. Omit / null for no limit.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Optional: if true, returns the merged characteristic list per assignment WITHOUT writing.',
      },
    },
    required: ['instance_name', 'asset_type_id', 'attribute_type_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeAssignAttributeToAssetType(args: any): Promise<ToolResult> {
  const {
    instance_name,
    asset_type_id,
    attribute_type_id,
    assignment_id,
    minimum_occurrences,
    maximum_occurrences,
    dry_run,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // ── Resolve the new attribute type (validate existence + name for output) ──
    const attr = await client
      .restCall<any>(`/rest/2.0/attributeTypes/${attribute_type_id}`)
      .catch(() => null);
    if (!attr || !attr.id) {
      return ok({
        error: true,
        message: `Attribute type "${attribute_type_id}" not found. Create it first with create_attribute_type.`,
        instance: instance_name,
      });
    }

    // ── Read assignments for the asset type ──────────────────────────────
    const raw = await client
      .restCall<any>(`/rest/2.0/assignments/assetType/${asset_type_id}`)
      .catch(() => []);
    const assignments: any[] = Array.isArray(raw) ? raw : raw.results || [];

    if (!assignments.length) {
      return ok({
        error: true,
        message:
          `No assignments found for asset type "${asset_type_id}". The asset type may not exist ` +
          `or may have no domain-type assignment to attach attributes to.`,
        instance: instance_name,
      });
    }

    const targets = assignment_id
      ? assignments.filter((a) => a.id === assignment_id)
      : assignments;

    if (assignment_id && !targets.length) {
      return ok({
        error: true,
        message: `Assignment "${assignment_id}" not found on asset type "${asset_type_id}".`,
        instance: instance_name,
      });
    }

    const newMin = typeof minimum_occurrences === 'number' ? minimum_occurrences : 0;
    const newMax = typeof maximum_occurrences === 'number' ? maximum_occurrences : 1;

    const perAssignment: any[] = [];
    let patched = 0;
    let alreadyAssigned = 0;

    for (const a of targets) {
      const existing: any[] = a.characteristicTypes || [];
      const refs = existing.map(toReference).filter((r): r is NonNullable<typeof r> => r !== null);

      const has = refs.some((r) => r.id === attribute_type_id);
      if (has) {
        alreadyAssigned++;
        perAssignment.push({
          assignmentId: a.id,
          domainTypes: (a.domainTypes || []).map((d: any) => d.name),
          status: 'already-assigned',
          characteristicCount: refs.length,
        });
        continue;
      }

      const merged = [...refs, { id: attribute_type_id, type: 'AttributeType', min: newMin, max: newMax }];

      if (dry_run) {
        perAssignment.push({
          assignmentId: a.id,
          domainTypes: (a.domainTypes || []).map((d: any) => d.name),
          status: 'would-patch',
          before: refs.length,
          after: merged.length,
          mergedCharacteristicTypes: merged,
        });
        continue;
      }

      await client.restCallWithBody<any>(`/rest/2.0/assignments/${a.id}`, 'PATCH', {
        characteristicTypes: merged,
      });
      patched++;
      perAssignment.push({
        assignmentId: a.id,
        domainTypes: (a.domainTypes || []).map((d: any) => d.name),
        status: 'patched',
        before: refs.length,
        after: merged.length,
      });
    }

    const payload = {
      action: dry_run ? 'preview' : 'assigned',
      instance: instance_name,
      assetTypeId: asset_type_id,
      attributeType: { id: attr.id, name: attr.name, kind: attr.resourceType || attr.attributeTypeDiscriminator },
      occurrences: { minimum: newMin, maximum: newMax },
      assignmentsTargeted: targets.length,
      patched,
      alreadyAssigned,
      assignments: perAssignment,
      message: dry_run
        ? `Dry run: previewed ${targets.length} assignment(s). No changes written.`
        : `Assigned "${attr.name}" to asset type — patched ${patched}, already assigned ${alreadyAssigned}.`,
    };

    if (dry_run || patched === 0) {
      return okPretty(payload);
    }

    return okWithNext(
      payload,
      [
        {
          tool: 'refresh_operating_model',
          args: { instance_name, force: true },
          why: 'Refresh the cached model so the new assignment is reflected.',
        },
        {
          tool: 'describe_asset_type',
          args: { instance_name, asset_type_id },
          why: 'Confirm the attribute now appears in the asset type\'s assignable attributes.',
        },
        {
          tool: 'update_asset_attribute',
          args: { instance_name, asset_id: '<asset>', attribute_type_id, value: '<value>' },
          why: 'Set the attribute value on assets of this type now that it is assignable.',
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
