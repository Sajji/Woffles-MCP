import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { loadSnapshot } from '../utils/operating-model-cache.js';

export const getOperatingModelSummaryTool = {
  name: 'get_operating_model_summary',
  description:
    'Return a compact, AI-friendly digest of the cached operating model for a Collibra instance: ' +
    'top-level asset type families, attribute-type kind distribution, status names, domain types, ' +
    'and a count of relation types. Call refresh_operating_model first if no cache exists. ' +
    'Use this at the start of a conversation as cheap context priming before touching individual assets.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The Collibra instance whose cached model should be summarized.' },
    },
    required: ['instance_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executeGetOperatingModelSummary(args: any): Promise<ToolResult> {
  const { instance_name } = args || {};
  const operation = 'get_operating_model_summary';
  try {
    const snap = loadSnapshot(instance_name);
    if (!snap) {
      return withEnvelope({
        instance: instance_name,
        operation,
        pretty: true,
        data: null,
        warnings: ['No cached operating model for this instance.'],
        nextActions: [
          { tool: 'refresh_operating_model', args: { instance_name }, why: 'Build the cache before summarizing.' },
        ],
      });
    }

    const byParent = new Map<string, string[]>();
    for (const t of snap.assetTypes) {
      const key = t.parentName || '(root)';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t.name);
    }
    // Top-level families: parent buckets sorted by size, descending.
    // Works regardless of whether the customer model has explicit roots.
    const topLevelAssetTypeFamilies = Array.from(byParent.entries())
      .map(([parent, children]) => ({ parent, childCount: children.length }))
      .sort((a, b) => b.childCount - a.childCount)
      .slice(0, 15);

    const attrKindCounts: Record<string, number> = {};
    for (const a of snap.attributeTypes) {
      attrKindCounts[a.kind] = (attrKindCounts[a.kind] || 0) + 1;
    }

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt, stale: false },
      data: {
        counts: {
          assetTypes: snap.assetTypes.length,
          domainTypes: snap.domainTypes.length,
          attributeTypes: snap.attributeTypes.length,
          relationTypes: snap.relationTypes.length,
          statuses: snap.statuses.length,
        },
        topLevelAssetTypeFamilies,
        attributeKindDistribution: attrKindCounts,
        statuses: snap.statuses.map((s) => s.name),
        domainTypes: snap.domainTypes.map((d) => d.name),
      },
      nextActions: [
        { tool: 'describe_asset_type', args: { instance_name, name: '<pick from topLevelAssetTypeFamilies>' }, why: 'Inspect attributes/relations/statuses for a specific asset type.' },
        { tool: 'resolve_model_term', args: { instance_name, term: '<user term>' }, why: 'Map a free-text term to model elements.' },
      ],
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
