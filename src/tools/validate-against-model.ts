import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { loadSnapshot } from '../utils/operating-model-cache.js';

export const validateAgainstModelTool = {
  name: 'validate_against_model',
  description:
    'Pre-flight a proposed Collibra write against the cached operating model and return violations ' +
    'before any API call. Validates three kinds of proposals: ' +
    '`asset` (asset_type_id + status_id + attribute_type_ids must exist), ' +
    '`relation` (relation_type_id must exist and source/target asset types must match its declared ends), ' +
    '`attribute` (attribute_type_id must exist). The cached model is authoritative for schema existence; ' +
    'business rules and per-domain constraints are still enforced server-side at write time.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      proposal_type: { type: 'string', enum: ['asset', 'relation', 'attribute'] },
      asset_type_id: { type: 'string' },
      status_id: { type: 'string' },
      attribute_type_ids: { type: 'array', items: { type: 'string' } },
      relation_type_id: { type: 'string' },
      source_asset_type_id: { type: 'string' },
      target_asset_type_id: { type: 'string' },
      attribute_type_id: { type: 'string' },
    },
    required: ['instance_name', 'proposal_type'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executeValidateAgainstModel(args: any): Promise<ToolResult> {
  const { instance_name, proposal_type } = args || {};
  const operation = 'validate_against_model';
  try {
    const snap = loadSnapshot(instance_name);
    if (!snap) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true, data: null,
        warnings: ['No cached operating model. Refresh first.'],
        nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
      });
    }

    const violations: string[] = [];
    const atIdx = new Map(snap.assetTypes.map((t) => [t.id, t]));
    const attrIdx = new Map(snap.attributeTypes.map((t) => [t.id, t]));
    const relIdx = new Map(snap.relationTypes.map((t) => [t.id, t]));
    const stIdx = new Map(snap.statuses.map((s) => [s.id, s]));

    if (proposal_type === 'asset') {
      if (!args.asset_type_id || !atIdx.has(args.asset_type_id)) {
        violations.push(`asset_type_id "${args.asset_type_id}" not found in model.`);
      }
      if (args.status_id && !stIdx.has(args.status_id)) {
        violations.push(`status_id "${args.status_id}" not found in model.`);
      }
      for (const aid of args.attribute_type_ids || []) {
        if (!attrIdx.has(aid)) violations.push(`attribute_type_id "${aid}" not found in model.`);
      }
    } else if (proposal_type === 'relation') {
      const rt = args.relation_type_id ? relIdx.get(args.relation_type_id) : undefined;
      if (!rt) {
        violations.push(`relation_type_id "${args.relation_type_id}" not found in model.`);
      } else {
        if (args.source_asset_type_id && rt.sourceTypeId !== args.source_asset_type_id) {
          violations.push(
            `source asset type does not match relation type: expected ${rt.sourceTypeName} (${rt.sourceTypeId}), got ${args.source_asset_type_id}.`,
          );
        }
        if (args.target_asset_type_id && rt.targetTypeId !== args.target_asset_type_id) {
          violations.push(
            `target asset type does not match relation type: expected ${rt.targetTypeName} (${rt.targetTypeId}), got ${args.target_asset_type_id}.`,
          );
        }
      }
    } else if (proposal_type === 'attribute') {
      if (!args.attribute_type_id || !attrIdx.has(args.attribute_type_id)) {
        violations.push(`attribute_type_id "${args.attribute_type_id}" not found in model.`);
      }
    } else {
      return errorEnvelope({ instance: instance_name, operation, message: `Unknown proposal_type: ${proposal_type}` });
    }

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt },
      data: {
        proposalType: proposal_type,
        valid: violations.length === 0,
        violations,
      },
      warnings: violations.length
        ? ['Schema validation failed. Server may still apply additional constraints (assignments, permissions, workflow).']
        : [],
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
