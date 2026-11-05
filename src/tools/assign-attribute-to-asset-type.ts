import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { isNotFound } from '../utils/collibra-client.js';
import { clientFor } from './_context.js';

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
    'the attribute is added to all of them. ' +
    'Two-step safety: 1) call with confirm=false (default) to PREVIEW the merged characteristic list per assignment; ' +
    '2) call again with confirm=true to APPLY. Use create_attribute_type first to obtain attribute_type_id, and ' +
    'get_asset_types to resolve asset_type_id.',
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
        type: ['number', 'null'],
        description: 'Optional: maximum occurrences. Default 1. Pass null for no upper limit.',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to apply. When false (default), returns a preview without writing.',
        default: false,
      },
      dry_run: {
        type: 'boolean',
        description: 'Deprecated: use confirm. dry_run=true always previews, even when confirm=true.',
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
    confirm = false,
    dry_run,
  } = args;
  // Preview unless explicitly confirmed (consistent with every other write tool).
  const preview = confirm !== true || dry_run === true;

  const { client } = clientFor(instance_name);

  // ── Resolve the new attribute type (validate existence + name for output) ──
  let attr: any = null;
  try {
    attr = await client.restCall<any>(`/rest/2.0/attributeTypes/${encodeURIComponent(attribute_type_id)}`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (!attr || !attr.id) {
    return ok({
      error: true,
      message: `Attribute type "${attribute_type_id}" not found. Create it first with create_attribute_type.`,
      instance: instance_name,
    });
  }

  // ── Read assignments for the asset type ──────────────────────────────
  let raw: any = [];
  try {
    raw = await client.restCall<any>(`/rest/2.0/assignments/assetType/${encodeURIComponent(asset_type_id)}`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
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
  // null → no upper limit (omitted from the reference); undefined → default 1.
  const newMax: number | undefined =
    maximum_occurrences === null ? undefined : typeof maximum_occurrences === 'number' ? maximum_occurrences : 1;

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

    if (preview) {
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

    try {
      await client.restCallWithBody<any>(`/rest/2.0/assignments/${encodeURIComponent(a.id)}`, 'PATCH', {
        characteristicTypes: merged,
      });
    } catch (err) {
      // Report what was already written instead of losing it in the generic catch.
      return ok({
        error: true,
        status: 'partial',
        message: `PATCH of assignment ${a.id} failed after ${patched} assignment(s) were already patched: ${(err as Error).message}`,
        instance: instance_name,
        assignments: perAssignment,
      });
    }
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
    action: preview ? 'preview' : 'assigned',
    instance: instance_name,
    assetTypeId: asset_type_id,
    attributeType: { id: attr.id, name: attr.name, kind: attr.resourceType || attr.attributeTypeDiscriminator },
    occurrences: { minimum: newMin, maximum: newMax ?? null },
    assignmentsTargeted: targets.length,
    patched,
    alreadyAssigned,
    assignments: perAssignment,
    message: preview
      ? `PREVIEW — no changes made: ${targets.length} assignment(s) inspected. To apply, call again with confirm=true.`
      : `Assigned "${attr.name}" to asset type — patched ${patched}, already assigned ${alreadyAssigned}.`,
  };

  if (preview || patched === 0) {
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
        tool: 'bulk_update_asset_attributes',
        args: { instance_name, attribute_type_id, updates: [{ asset_id: '<asset>', new_value: '<value>' }] },
        why: 'Set the attribute value on assets of this type now that it is assignable.',
      },
    ],
    true,
  );
}
