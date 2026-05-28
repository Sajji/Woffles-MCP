import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { fetchOperatingModel, loadSnapshot, saveSnapshot } from '../utils/operating-model-cache.js';

export const refreshOperatingModelTool = {
  name: 'refresh_operating_model',
  description:
    'Crawl a Collibra instance and persist a portable operating-model snapshot ' +
    '(asset types, domain types, attribute types, relation types, statuses) to a local cache. ' +
    'Run this once per session (or when the model is expected to have changed). Other model-aware ' +
    'tools (get_operating_model_summary, describe_asset_type, describe_domain_type, ' +
    'resolve_model_term, plan_asset_creation, find_traversal_path, validate_against_model) read ' +
    'from this cache to give consistent, customer-agnostic guidance. Returns counts and a snapshot hash; ' +
    'pass `force=true` to refresh even if a recent cache exists.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The Collibra instance to crawl (as defined in config.json).' },
      force: { type: 'boolean', description: 'Force re-crawl even if a cached snapshot exists. Default: false.' },
      max_age_hours: { type: 'number', description: 'Reuse existing cache if it is younger than this many hours. Default: 24.' },
    },
    required: ['instance_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executeRefreshOperatingModel(args: any): Promise<ToolResult> {
  const { instance_name, force = false, max_age_hours = 24 } = args || {};
  const operation = 'refresh_operating_model';
  try {
    const existing = loadSnapshot(instance_name);
    let reused = false;
    if (!force && existing) {
      const ageMs = Date.now() - new Date(existing.refreshedAt).getTime();
      if (ageMs < max_age_hours * 3600_000) {
        reused = true;
      }
    }

    const snapshot = reused && existing ? existing : await fetchOperatingModel(instance_name);
    if (!reused) saveSnapshot(snapshot);

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snapshot.snapshotHash, stale: false, refreshedAt: snapshot.refreshedAt },
      data: {
        reusedCache: reused,
        counts: {
          assetTypes: snapshot.assetTypes.length,
          domainTypes: snapshot.domainTypes.length,
          attributeTypes: snapshot.attributeTypes.length,
          relationTypes: snapshot.relationTypes.length,
          statuses: snapshot.statuses.length,
        },
      },
      summary: { snapshotHash: snapshot.snapshotHash, refreshedAt: snapshot.refreshedAt },
      nextActions: [
        { tool: 'get_operating_model_summary', args: { instance_name }, why: 'Get a compact, AI-friendly digest of the model.' },
        { tool: 'describe_asset_type', args: { instance_name, name: '<asset type name>' }, why: 'Inspect attributes/relations/eligible domains for a specific asset type.' },
      ],
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
