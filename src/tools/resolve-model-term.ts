import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { loadSnapshot } from '../utils/operating-model-cache.js';

export const resolveModelTermTool = {
  name: 'resolve_model_term',
  description:
    'Fuzzy-resolve a free-text term against every kind of element in the cached operating model: ' +
    'asset types, domain types, attribute types, relation types (by role/corole), and statuses. ' +
    'Returns ranked candidate matches per category with their UUIDs so the agent can pick the right ' +
    'one without re-listing the entire model. Customer-agnostic: works against any deployment.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      term: { type: 'string', description: 'Free-text term to resolve (case-insensitive contains match).' },
      categories: {
        type: 'array',
        description: 'Optional: restrict to these categories. Default: all.',
        items: { type: 'string', enum: ['assetType', 'domainType', 'attributeType', 'relationType', 'status'] },
      },
      limit_per_category: { type: 'number', description: 'Max matches per category. Default: 10.' },
    },
    required: ['instance_name', 'term'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

function score(name: string, term: string): number {
  const n = name.toLowerCase();
  const t = term.toLowerCase();
  if (n === t) return 100;
  if (n.startsWith(t)) return 80;
  if (n.includes(t)) return 50;
  return 0;
}

export async function executeResolveModelTerm(args: any): Promise<ToolResult> {
  const { instance_name, term, categories, limit_per_category = 10 } = args || {};
  const operation = 'resolve_model_term';
  try {
    const snap = loadSnapshot(instance_name);
    if (!snap) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true, data: null,
        warnings: ['No cached operating model. Refresh first.'],
        nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
      });
    }

    const wanted = new Set<string>(
      Array.isArray(categories) && categories.length
        ? categories
        : ['assetType', 'domainType', 'attributeType', 'relationType', 'status'],
    );

    const rank = <T extends { name?: string }>(items: T[], nameFn: (i: T) => string): T[] =>
      items
        .map((i) => ({ i, s: score(nameFn(i), term) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit_per_category)
        .map((x) => x.i);

    const data: Record<string, unknown> = {};
    if (wanted.has('assetType')) data.assetTypes = rank(snap.assetTypes, (i) => i.name);
    if (wanted.has('domainType')) data.domainTypes = rank(snap.domainTypes, (i) => i.name);
    if (wanted.has('attributeType')) data.attributeTypes = rank(snap.attributeTypes, (i) => i.name);
    if (wanted.has('relationType')) {
      data.relationTypes = rank(
        snap.relationTypes.map((r) => ({ ...r, _label: `${r.sourceTypeName} ${r.role} ${r.targetTypeName} / ${r.corole}` })),
        (i: any) => i._label,
      );
    }
    if (wanted.has('status')) data.statuses = rank(snap.statuses, (i) => i.name);

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt },
      data,
      summary: { term },
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
