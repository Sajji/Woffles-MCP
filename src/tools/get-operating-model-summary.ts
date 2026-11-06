import type { ToolResult } from '../types.js';
import { withEnvelope } from '../utils/tool-result.js';
import { ancestorIds, loadSnapshot, snapshotStatus } from '../utils/operating-model-cache.js';

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

  // Top-level families: types whose parent is not itself a listed type. The
  // root "Asset" type is not returned by /assetTypes, so these are Business
  // Asset, Data Asset, Technology Asset, ... Each comes with the number of
  // types beneath it at any depth. (Previously this counted direct children
  // per parent at any level.)
  const listed = new Set(snap.assetTypes.map((t) => t.id));
  const isTop = (t: { parentId?: string }) => !t.parentId || !listed.has(t.parentId);
  const familySizes = new Map<string, number>();
  for (const t of snap.assetTypes) {
    // The family is the last listed type in the ancestry chain.
    const chain = ancestorIds(snap, t.id).filter((x) => listed.has(x));
    const family = chain[chain.length - 1];
    if (family && family !== t.id) familySizes.set(family, (familySizes.get(family) ?? 0) + 1);
  }
  const topLevelAssetTypeFamilies = snap.assetTypes
    .filter(isTop)
    .map((t) => ({ family: t.name, descendantCount: familySizes.get(t.id) ?? 0 }))
    .sort((a, b) => b.descendantCount - a.descendantCount)
    .slice(0, 15);

  const attrKindCounts: Record<string, number> = {};
  for (const a of snap.attributeTypes) {
    attrKindCounts[a.kind] = (attrKindCounts[a.kind] || 0) + 1;
  }

  return withEnvelope({
    instance: instance_name,
    operation,
    pretty: true,
    model: snapshotStatus(snap).model,
    warnings: snapshotStatus(snap).warnings,
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
}
