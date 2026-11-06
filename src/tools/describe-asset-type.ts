import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { fetchAssetTypeAssignments, loadSnapshot, snapshotStatus } from '../utils/operating-model-cache.js';

export const describeAssetTypeTool = {
  name: 'describe_asset_type',
  description:
    'Return everything the agent needs to work with a specific asset type: parent/sub types, ' +
    'assignable attribute types, assignable relation types (with direction and the other asset type), ' +
    'and the full list of eligible statuses. Resolves the asset type by name (case-insensitive contains) ' +
    'or by UUID. Reads from the cached operating model; per-asset-type assignment data is fetched ' +
    'on-demand from the live instance.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      asset_type_id: { type: 'string', description: 'UUID of the asset type. Provide this or name.' },
      name: { type: 'string', description: 'Asset type name (case-insensitive contains). Provide this or asset_type_id.' },
    },
    required: ['instance_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executeDescribeAssetType(args: any): Promise<ToolResult> {
  const { instance_name, asset_type_id, name } = args || {};
  const operation = 'describe_asset_type';
  const snap = loadSnapshot(instance_name);
  if (!snap) {
    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      data: null,
      warnings: ['No cached operating model. Refresh first.'],
      nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
    });
  }

  let matches = snap.assetTypes;
  if (asset_type_id) matches = matches.filter((t) => t.id === asset_type_id);
  else if (name) {
    const n = String(name).toLowerCase();
    const contains = matches.filter((t) => t.name.toLowerCase().includes(n));
    const exact = contains.filter((t) => t.name.toLowerCase() === n);
    matches = exact.length === 1 ? exact : contains;
  } else {
    return errorEnvelope({ instance: instance_name, operation, message: 'Provide asset_type_id or name.' });
  }

  if (matches.length === 0) {
    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      data: { candidates: [] },
      warnings: ['No asset type matched.'],
      nextActions: [{ tool: 'get_operating_model_summary', args: { instance_name }, why: 'Browse available asset types.' }],
    });
  }
  if (matches.length > 1) {
    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      data: { candidates: matches.slice(0, 20).map((m) => ({ id: m.id, name: m.name, parentName: m.parentName })) },
      warnings: [`Ambiguous: ${matches.length} asset types matched. Re-call with asset_type_id.`],
    });
  }

  const target = matches[0];
  const children = snap.assetTypes
    .filter((t) => t.parentId === target.id)
    .map((c) => ({ id: c.id, name: c.name }));

  // Errors (e.g. 403) now propagate instead of looking like "nothing assignable".
  const assignments = await fetchAssetTypeAssignments(instance_name, target.id);
  const warnings = [...snapshotStatus(snap).warnings];
  if (!assignments.attributeTypes.length && !assignments.relationTypes.length) {
    warnings.push(`No assignment found for "${target.name}" — it may be abstract (assign a subtype) or not yet assigned to any domain type.`);
  }

  return withEnvelope({
    instance: instance_name,
    operation,
    pretty: true,
    model: snapshotStatus(snap).model,
    warnings,
    data: {
      assetType: target,
      children,
      assignableAttributeTypes: assignments.attributeTypes,
      assignableRelationTypes: assignments.relationTypes,
      // Only what the assignment declares — falling back to every status in the
      // model presented ineligible statuses as valid.
      eligibleStatuses: assignments.eligibleStatuses,
      defaultStatusId: assignments.defaultStatusId,
      eligibleDomainTypes: assignments.eligibleDomainTypes,
    },
    nextActions: [
      { tool: 'prepare_create_asset', args: { instance_name, asset_type_id: target.id, asset_name: '<name>', domain_name: '<domain>' }, why: 'Plan a create that respects this type.' },
      { tool: 'find_traversal_path', args: { instance_name, source_asset_type_name: target.name, target_asset_type_name: '<target>' }, why: 'Find relation paths from this type.' },
    ],
  });
}
