import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { fetchAssetTypeAssignments, loadSnapshot } from '../utils/operating-model-cache.js';

export const planAssetCreationTool = {
  name: 'plan_asset_creation',
  description:
    'Produce a portable, executable plan for creating an asset that conforms to the target instance\'s ' +
    'operating model: resolves the asset type and target domain (by name or UUID), lists assignable ' +
    'attribute types so the agent knows which keys are accepted, and emits a `nextAction` pointing at ' +
    'prepare_create_asset/create_asset with the resolved UUIDs. Does not choose an initial status: omit status_id ' +
    'on create so Collibra applies the asset type\'s default, unless the user named a status (preferred_status_name). ' +
    'Does NOT write anything.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      asset_name: { type: 'string' },
      asset_type_id: { type: 'string' },
      asset_type_name: { type: 'string' },
      domain_id: { type: 'string' },
      domain_name: { type: 'string' },
      domain_type_id: { type: 'string', description: 'Optional: domain type hint when domain not yet chosen.' },
      preferred_status_name: { type: 'string', description: 'Optional: only when the user explicitly asked for a specific initial status, its name. Resolved to a UUID if it is eligible for the asset type.' },
    },
    required: ['instance_name', 'asset_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executePlanAssetCreation(args: any): Promise<ToolResult> {
  const {
    instance_name, asset_name, asset_type_id, asset_type_name,
    domain_id, domain_name, domain_type_id, preferred_status_name,
  } = args || {};
  const operation = 'plan_asset_creation';
  try {
    const snap = loadSnapshot(instance_name);
    if (!snap) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true, data: null,
        warnings: ['No cached operating model. Refresh first.'],
        nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
      });
    }

    // Resolve asset type
    let typeCandidates = snap.assetTypes;
    if (asset_type_id) typeCandidates = typeCandidates.filter((t) => t.id === asset_type_id);
    else if (asset_type_name) {
      const n = asset_type_name.toLowerCase();
      const contains = typeCandidates.filter((t) => t.name.toLowerCase().includes(n));
      const exact = contains.filter((t) => t.name.toLowerCase() === n);
      typeCandidates = exact.length === 1 ? exact : contains;
    } else {
      typeCandidates = [];
    }

    if (typeCandidates.length !== 1) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true,
        data: { status: 'needs_clarification', kind: 'assetType', candidates: typeCandidates.slice(0, 20) },
        warnings: [typeCandidates.length === 0 ? 'No matching asset type.' : `Ambiguous: ${typeCandidates.length} asset types matched.`],
        nextActions: [{ tool: 'resolve_model_term', args: { instance_name, term: asset_type_name || '', categories: ['assetType'] }, why: 'Narrow asset type.' }],
      });
    }
    const assetType = typeCandidates[0];

    // Fetch assignable attributes for this type (live, cache-supplemented)
    const assignments = await fetchAssetTypeAssignments(instance_name, assetType.id);

    // Only resolve a status the user explicitly asked for. Never pick one:
    // leaving status_id out lets Collibra apply the asset type's default.
    const warnings: string[] = [];
    let requestedStatus: { id: string; name: string } | undefined;
    if (preferred_status_name) {
      const eligibleStatuses = assignments.eligibleStatuses.length
        ? assignments.eligibleStatuses
        : snap.statuses.map((s) => ({ id: s.id, name: s.name }));
      requestedStatus = eligibleStatuses.find((s) => s.name.toLowerCase() === preferred_status_name.toLowerCase());
      if (!requestedStatus) {
        warnings.push(`Status "${preferred_status_name}" is not eligible for this asset type; omit status_id to use Collibra's default.`);
      }
    }

    // Suggest a domain type using the type's eligible domain types when known.
    let domainTypeSuggestion: { id: string; name: string } | undefined;
    if (!domain_id && !domain_name && !domain_type_id) {
      if (assignments.eligibleDomainTypes.length) {
        domainTypeSuggestion = assignments.eligibleDomainTypes[0];
      } else {
        const tokens = assetType.name.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
        const dt = snap.domainTypes.find((d) => tokens.some((tok) => d.name.toLowerCase().includes(tok)));
        if (dt) domainTypeSuggestion = { id: dt.id, name: dt.name };
      }
    }

    const plan = {
      status: domain_id || domain_name ? 'ready_for_prepare' : 'needs_domain',
      resolved: {
        assetType: { id: assetType.id, name: assetType.name },
        requestedStatus: requestedStatus ?? null,
        domainTypeSuggestion,
      },
      assignableAttributeTypes: assignments.attributeTypes,
      assignableRelationTypes: assignments.relationTypes,
    };

    const nextActions = [];
    if (domain_id || domain_name) {
      nextActions.push({
        tool: 'prepare_create_asset',
        args: {
          instance_name, asset_name,
          asset_type_id: assetType.id,
          domain_id, domain_name,
        },
        why: 'Pre-flight check before create_asset.',
      });
    } else {
      nextActions.push({
        tool: 'get_domains',
        args: { instance_name, name: domain_type_id ? undefined : assetType.name },
        why: 'Pick a target domain. Filter by domain type when known.',
      });
    }

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt },
      data: { assetName: asset_name, plan },
      nextActions,
      warnings,
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
