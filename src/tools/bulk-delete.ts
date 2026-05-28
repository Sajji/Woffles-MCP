import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const bulkDeleteAssetsTool = {
  name: 'bulk_delete_assets',
  description:
    'Delete multiple Collibra assets in a single DELETE /rest/2.0/assets/bulk call. ' +
    'DESTRUCTIVE — assets and all their attributes, relations, attachments, and comments are permanently removed. ' +
    'Two-step safety is REQUIRED: ' +
    '1) Call with confirm=false (default) to PREVIEW each asset (name, type, domain, URL). ' +
    '2) Call again with confirm=true to APPLY. ' +
    'IDs that do not resolve are skipped silently in preview and reported separately.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The name of the Collibra instance.' },
      asset_ids: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', description: 'UUID of an asset to delete.' },
        description: 'UUIDs of assets to delete.',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually delete the assets. When false (default), returns a preview without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'asset_ids'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload.',
    additionalProperties: true,
  },
};

export async function executeBulkDeleteAssets(args: any): Promise<ToolResult> {
  const { instance_name, asset_ids, confirm = false } = args;

  if (!Array.isArray(asset_ids) || asset_ids.length === 0) {
    return ok({ error: 'asset_ids must be a non-empty array of UUIDs.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const lookups = await Promise.all(
      asset_ids.map(async (id: string) => {
        try {
          const a = await client.restCall<any>(`/rest/2.0/assets/${id}`);
          return {
            assetId: id,
            name: a.name || 'Unknown',
            type: a.type ? { id: a.type.id, name: a.type.name } : null,
            domain: a.domain ? { id: a.domain.id, name: a.domain.name } : null,
            url: client.assetUrl(id),
            notFound: false,
          };
        } catch (err) {
          return { assetId: id, name: null, notFound: true, error: (err as Error).message };
        }
      }),
    );

    const found = lookups.filter((l) => !l.notFound);
    const missing = lookups.filter((l) => l.notFound);

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        totalRequested: asset_ids.length,
        toDelete: found.length,
        notFound: missing.length,
        details: lookups,
        warning: 'DELETE is irreversible. Verify every asset above before confirming.',
        instructions: 'To apply, call again with confirm=true.',
      });
    }

    if (found.length === 0) {
      return okPretty({
        mode: 'APPLIED',
        deleted: 0,
        notFound: missing.length,
        message: 'No resolvable assets to delete.',
      });
    }

    await client.restCallWithBody<void>(
      '/rest/2.0/assets/bulk',
      'DELETE',
      found.map((f) => f.assetId),
    );

    return okWithNext({
      mode: 'APPLIED',
      deleted: found.length,
      notFound: missing.length,
      details: lookups.map((l) => ({
        assetId: l.assetId,
        name: l.name,
        action: l.notFound ? 'NOT FOUND' : 'DELETED',
      })),
    }, [
      { tool: 'query_assets', args: { instance_name, asset_type_name: '<type>' }, why: 'Re-query the affected asset type to confirm deletion.' },
    ], true);
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}

export const bulkDeleteRelationsTool = {
  name: 'bulk_delete_relations',
  description:
    'Delete multiple relations in a single DELETE /rest/2.0/relations/bulk call. ' +
    'DESTRUCTIVE — relations are removed permanently (the linked assets are untouched). ' +
    'Two-step safety is REQUIRED: ' +
    '1) Call with confirm=false (default) to PREVIEW each relation (source/target/type). ' +
    '2) Call again with confirm=true to APPLY.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The name of the Collibra instance.' },
      relation_ids: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', description: 'UUID of a relation to delete.' },
        description: 'UUIDs of relations to delete.',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually delete the relations. When false (default), returns a preview without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'relation_ids'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload.',
    additionalProperties: true,
  },
};

export async function executeBulkDeleteRelations(args: any): Promise<ToolResult> {
  const { instance_name, relation_ids, confirm = false } = args;

  if (!Array.isArray(relation_ids) || relation_ids.length === 0) {
    return ok({ error: 'relation_ids must be a non-empty array of UUIDs.' });
  }

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const lookups = await Promise.all(
      relation_ids.map(async (id: string) => {
        try {
          const r = await client.restCall<any>(`/rest/2.0/relations/${id}`);
          return {
            relationId: id,
            source: r.source ? { id: r.source.id, name: r.source.fullName ?? r.source.name } : null,
            target: r.target ? { id: r.target.id, name: r.target.fullName ?? r.target.name } : null,
            type: r.type ? { id: r.type.id, role: r.type.role, corole: r.type.corole } : null,
            notFound: false,
          };
        } catch (err) {
          return { relationId: id, notFound: true, error: (err as Error).message };
        }
      }),
    );

    const found = lookups.filter((l) => !l.notFound);
    const missing = lookups.filter((l) => l.notFound);

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        totalRequested: relation_ids.length,
        toDelete: found.length,
        notFound: missing.length,
        details: lookups,
        instructions: 'To apply, call again with confirm=true.',
      });
    }

    if (found.length === 0) {
      return okPretty({
        mode: 'APPLIED',
        deleted: 0,
        notFound: missing.length,
        message: 'No resolvable relations to delete.',
      });
    }

    await client.restCallWithBody<void>(
      '/rest/2.0/relations/bulk',
      'DELETE',
      found.map((f) => f.relationId),
    );

    return okPretty({
      mode: 'APPLIED',
      deleted: found.length,
      notFound: missing.length,
      details: lookups.map((l) => ({
        relationId: l.relationId,
        action: l.notFound ? 'NOT FOUND' : 'DELETED',
      })),
    });
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
