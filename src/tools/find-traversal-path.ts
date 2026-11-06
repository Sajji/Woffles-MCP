import type { ToolResult } from '../types.js';
import { withEnvelope } from '../utils/tool-result.js';
import { ancestorIds, loadSnapshot, type ModelRelationType, snapshotStatus } from '../utils/operating-model-cache.js';

export const findTraversalPathTool = {
  name: 'find_traversal_path',
  description:
    'Given a source and target asset type (by name or UUID), return the shortest sequence of relation ' +
    'types that connects them in the cached operating model. Each step says which asset type to leave ' +
    'and which to land on, plus the relation type UUID, role label and direction. Use this to plan ' +
    'efficient graph traversals instead of guessing relation chains. Customer-agnostic: relies only on ' +
    'the model graph, not on any specific names.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      source_asset_type_id: { type: 'string' },
      source_asset_type_name: { type: 'string' },
      target_asset_type_id: { type: 'string' },
      target_asset_type_name: { type: 'string' },
      max_depth: { type: 'number', description: 'Maximum path length to consider. Default: 5.' },
      max_paths: { type: 'number', description: 'Maximum number of paths to return. Default: 3.' },
    },
    required: ['instance_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

interface Edge {
  relationTypeId: string;
  role: string;
  corole: string;
  direction: 'OUTGOING' | 'INCOMING';
  fromTypeId: string;
  fromTypeName: string;
  toTypeId: string;
  toTypeName: string;
}

function buildAdjacency(relations: ModelRelationType[]): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const add = (k: string, e: Edge) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push(e);
  };
  for (const r of relations) {
    if (!r.sourceTypeId || !r.targetTypeId) continue;
    add(r.sourceTypeId, {
      relationTypeId: r.id, role: r.role, corole: r.corole, direction: 'OUTGOING',
      fromTypeId: r.sourceTypeId, fromTypeName: r.sourceTypeName,
      toTypeId: r.targetTypeId, toTypeName: r.targetTypeName,
    });
    add(r.targetTypeId, {
      relationTypeId: r.id, role: r.role, corole: r.corole, direction: 'INCOMING',
      fromTypeId: r.targetTypeId, fromTypeName: r.targetTypeName,
      toTypeId: r.sourceTypeId, toTypeName: r.sourceTypeName,
    });
  }
  return adj;
}

export async function executeFindTraversalPath(args: any): Promise<ToolResult> {
  const {
    instance_name,
    source_asset_type_id, source_asset_type_name,
    target_asset_type_id, target_asset_type_name,
    max_depth = 5, max_paths = 3,
  } = args || {};
  const operation = 'find_traversal_path';
  const snap = loadSnapshot(instance_name);
  if (!snap) {
    return withEnvelope({
      instance: instance_name, operation, pretty: true, data: null,
      warnings: ['No cached operating model. Refresh first.'],
      nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
    });
  }

  const resolve = (id?: string, name?: string) => {
    if (id) return snap.assetTypes.filter((t) => t.id === id);
    if (name) {
      const n = name.toLowerCase();
      const contains = snap.assetTypes.filter((t) => t.name.toLowerCase().includes(n));
      // Prefer an exact (case-insensitive) match when the contains-match is ambiguous.
      const exact = contains.filter((t) => t.name.toLowerCase() === n);
      return exact.length === 1 ? exact : contains;
    }
    return [];
  };

  const sources = resolve(source_asset_type_id, source_asset_type_name);
  const targets = resolve(target_asset_type_id, target_asset_type_name);
  if (sources.length !== 1 || targets.length !== 1) {
    return withEnvelope({
      instance: instance_name, operation, pretty: true,
      data: { sourceCandidates: sources.slice(0, 20), targetCandidates: targets.slice(0, 20) },
      warnings: ['Source and target must each resolve to exactly one asset type.'],
    });
  }

  const src = sources[0];
  const dst = targets[0];
  const adj = buildAdjacency(snap.relationTypes);

  // BFS yielding shortest-first paths. Relation types declared on a supertype
  // apply to all its subtypes: a node expands with the edges of its whole
  // ancestry, and an edge reaches the target when it lands on the target type
  // or one of its supertypes. `generality` counts how far up the hierarchy the
  // edges used were declared, so specific paths rank before generic ones.
  type Found = { path: Edge[]; generality: number; supertypeSteps: Set<number> };
  const found: Found[] = [];
  const dstAncestry = ancestorIds(snap, dst.id);
  const queue: { node: string; path: Edge[]; visited: Set<string>; generality: number; supertypeSteps: Set<number> }[] = [
    { node: src.id, path: [], visited: new Set([src.id]), generality: 0, supertypeSteps: new Set() },
  ];
  // Collect more candidates than requested, then rank.
  const want = max_paths * 5;
  // Simple-path enumeration is exponential around hub types (Asset, Data
  // Asset): cap the work and say so rather than hang.
  const MAX_EXPANSIONS = 50_000;
  let expansions = 0;
  let truncated = false;
  let head = 0;
  let shortest = Infinity;
  while (head < queue.length && found.length < want) {
    if (++expansions > MAX_EXPANSIONS) {
      truncated = true;
      break;
    }
    const cur = queue[head++];
    // Expanding a node at depth d yields paths of length d+1, so stop at max_depth.
    if (cur.path.length >= max_depth) continue;
    // Once enough paths are found, don't explore beyond the shortest length + 1.
    if (found.length >= max_paths && cur.path.length >= shortest) continue;
    const ancestry = ancestorIds(snap, cur.node);
    const step = cur.path.length;
    for (let level = 0; level < ancestry.length; level++) {
      for (const e of adj.get(ancestry[level]) || []) {
        const viaSupertype = level > 0;
        const targetLevel = dstAncestry.indexOf(e.toTypeId);
        const supertypeSteps = viaSupertype ? new Set([...cur.supertypeSteps, step]) : cur.supertypeSteps;
        if (targetLevel >= 0) {
          found.push({ path: [...cur.path, e], generality: cur.generality + level + targetLevel, supertypeSteps });
          shortest = Math.min(shortest, cur.path.length + 1);
          continue;
        }
        if (cur.visited.has(e.toTypeId)) continue;
        if (queue.length - head >= 200_000) {
          truncated = true;
          break;
        }
        const nv = new Set(cur.visited);
        nv.add(e.toTypeId);
        queue.push({ node: e.toTypeId, path: [...cur.path, e], visited: nv, generality: cur.generality + level, supertypeSteps });
      }
    }
  }
  found.sort((a, b) => a.path.length - b.path.length || a.generality - b.generality);
  const ranked = found.slice(0, max_paths);
  const paths = ranked.map((f) => f.path);
  const warnings: string[] = [...snapshotStatus(snap).warnings];
  if (paths.length === 0) warnings.push(`No path found within depth ${max_depth}.`);
  if (truncated) warnings.push('Search stopped early (too many candidate paths); results may be incomplete — reduce max_depth.');

  return withEnvelope({
    instance: instance_name,
    operation,
    pretty: true,
    model: snapshotStatus(snap).model,
    data: {
      source: { id: src.id, name: src.name },
      target: { id: dst.id, name: dst.name },
      paths: ranked.map((f) => ({
        length: f.path.length,
        steps: f.path.map((e, i) => ({
          relationTypeId: e.relationTypeId,
          direction: e.direction,
          label: e.direction === 'OUTGOING' ? e.role : e.corole,
          // from/to are the types the relation type is declared on; a step
          // marked viaSupertype applies because the current type inherits it.
          from: e.fromTypeName,
          to: e.toTypeName,
          ...(f.supertypeSteps.has(i) ? { viaSupertype: true } : {}),
        })),
      })),
    },
    warnings,
  });
}
