import type { ToolResult } from '../types.js';
import { errorEnvelope, withEnvelope } from '../utils/tool-result.js';
import { loadSnapshot } from '../utils/operating-model-cache.js';

export const describeDomainTypeTool = {
  name: 'describe_domain_type',
  description:
    'Describe a domain type using the cached operating model: returns the domain type metadata plus ' +
    'a heuristic list of asset types whose name family overlaps with this domain type ' +
    '(useful for picking the right domain when creating assets). Resolves by name (case-insensitive ' +
    'contains) or UUID. This tool only reads from the cache; call refresh_operating_model first if needed.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string' },
      domain_type_id: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['instance_name'],
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

export async function executeDescribeDomainType(args: any): Promise<ToolResult> {
  const { instance_name, domain_type_id, name } = args || {};
  const operation = 'describe_domain_type';
  try {
    const snap = loadSnapshot(instance_name);
    if (!snap) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true, data: null,
        warnings: ['No cached operating model. Refresh first.'],
        nextActions: [{ tool: 'refresh_operating_model', args: { instance_name }, why: 'Required cache.' }],
      });
    }

    let matches = snap.domainTypes;
    if (domain_type_id) matches = matches.filter((d) => d.id === domain_type_id);
    else if (name) {
      const n = String(name).toLowerCase();
      const contains = matches.filter((d) => d.name.toLowerCase().includes(n));
      const exact = contains.filter((d) => d.name.toLowerCase() === n);
      matches = exact.length === 1 ? exact : contains;
    } else {
      return errorEnvelope({ instance: instance_name, operation, message: 'Provide domain_type_id or name.' });
    }

    if (matches.length === 0) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true, data: { candidates: [] },
        warnings: ['No domain type matched.'],
      });
    }
    if (matches.length > 1) {
      return withEnvelope({
        instance: instance_name, operation, pretty: true,
        data: { candidates: matches.slice(0, 20) },
        warnings: [`Ambiguous: ${matches.length} domain types matched.`],
      });
    }

    const target = matches[0];
    const tokens = target.name.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    const likelyAssetTypes = snap.assetTypes
      .filter((t) => tokens.some((tok) => t.name.toLowerCase().includes(tok)))
      .map((t) => ({ id: t.id, name: t.name }));

    return withEnvelope({
      instance: instance_name,
      operation,
      pretty: true,
      model: { snapshotHash: snap.snapshotHash, refreshedAt: snap.refreshedAt },
      data: {
        domainType: target,
        likelyAssetTypes,
        note: 'likelyAssetTypes is a name-overlap heuristic. Authoritative assignability is enforced server-side at asset creation time.',
      },
      nextActions: [
        { tool: 'plan_asset_creation', args: { instance_name, asset_name: '<name>', asset_type_name: '<type>', domain_type_id: target.id }, why: 'Plan an asset under this domain type.' },
      ],
    });
  } catch (error) {
    return errorEnvelope({ instance: instance_name, operation, message: (error as Error).message });
  }
}
