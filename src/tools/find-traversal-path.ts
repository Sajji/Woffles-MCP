import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { loadSnapshot, type ModelRelationType } from '../utils/operating-model-cache.js';

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
  try {
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

    // BFS yielding up to max_paths shortest-first paths.
    const paths: Edge[][] = [];
    const queue: { node: string; path: Edge[]; visited: Set<string> }[] = [
      { node: src.id, path: [], visited: new Set([src.id]) },
    ];
    while (queue.length && paths.length < max_paths) {
      const cur = queue.shift()!;
      if (cur.path.length > max_depth) continue;
      const edges = adj.get(cur.node) || [];
      for (const e of edges) {
        if (e.toTypeId === dst.id) {
          paths.push([...cur.path, e]);
          if (paths.length >= max_paths) break;
          continue;
        }
        if (cur.visited.has(e.toTypeId)) continue;
        const nv = new Set(cur.visited);
        nv.add(e.toTypeId);
        queue.push({ node: e.toTypeId, path: [...cur.path, e], visited: nv });
      }
    }

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt },
      data: {
        source: { id: src.id, name: src.name },
        target: { id: dst.id, name: dst.name },
        paths: paths.map((p) => ({
          length: p.length,
          steps: p.map((e) => ({
            relationTypeId: e.relationTypeId,
            direction: e.direction,
            label: e.direction === 'OUTGOING' ? e.role : e.corole,
            from: e.fromTypeName,
            to: e.toTypeName,
          })),
        })),
      },
      warnings: paths.length === 0 ? [`No path found within depth ${max_depth}.`] : [],
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
