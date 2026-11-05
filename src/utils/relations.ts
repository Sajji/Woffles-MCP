import type { CollibraClient } from './collibra-client.js';

/**
 * Shared relation helpers.
 *
 * IMPORTANT: `GET /rest/2.0/relations` filters by relation type with
 * `relationTypeId`. The similarly named `typeId` is silently IGNORED by the
 * API (verified on 2026.10 and on the sandbox), which returns relations of
 * every type — so never use `typeId` as a query filter. (`typeId` IS the
 * correct field name in POST bodies.)
 */

export interface RelationKey {
  sourceId: string;
  targetId: string;
  relationTypeId: string;
}

/**
 * Find the existing relation for an exact (source, target, type) triple, or
 * null. Filters server-side on all three keys and re-checks client-side so a
 * mis-applied filter can never match a relation of the wrong type.
 */
export async function findRelation(client: CollibraClient, key: RelationKey): Promise<any | null> {
  const params = new URLSearchParams({
    sourceId: key.sourceId,
    targetId: key.targetId,
    relationTypeId: key.relationTypeId,
    limit: '10',
  });
  const resp = await client.restCall<{ results?: any[] }>(`/rest/2.0/relations?${params.toString()}`);
  return (
    (resp.results ?? []).find(
      (r) =>
        r.source?.id === key.sourceId &&
        r.target?.id === key.targetId &&
        r.type?.id === key.relationTypeId,
    ) ?? null
  );
}

/** Well-known out-of-the-box relation type UUIDs used by the semantics tools. */
export const SEMANTIC_RELATION_TYPES = {
  COLUMN_TO_TABLE: '00000000-0000-0000-0000-000000007042',
  DATA_ATTRIBUTE_1: '00000000-0000-0000-0000-000000007094',
  DATA_ATTRIBUTE_2: 'cd000000-0000-0000-0000-000000000023',
  GENERIC_CONNECTED_ASSET: '00000000-0000-0000-0000-000000007038',
  DATA_ATTRIBUTE_REPRESENTS_MEASURE: '00000000-0000-0000-0000-000000007200',
} as const;

/**
 * All relations of one type, filtered by source and/or target, across every
 * page. Errors propagate: a 403 or 500 must not look like "no relations".
 */
export async function fetchRelations(
  client: CollibraClient,
  relationTypeId: string,
  sourceId?: string,
  targetId?: string,
): Promise<any[]> {
  const params: Record<string, string> = { relationTypeId };
  if (sourceId) params.sourceId = sourceId;
  if (targetId) params.targetId = targetId;
  return client.restPaginate<any>('/rest/2.0/relations', params);
}

/**
 * Role / co-role labels for a relation type. Relation payloads only embed the
 * type's `{ id }`, so labels must come from the (cached) relation-type map.
 */
export async function relationTypeLabels(
  client: CollibraClient,
  relationTypeId: string | undefined,
): Promise<{ id: string; role: string | null; coRole: string | null } | null> {
  if (!relationTypeId) return null;
  const rt = (await client.getRelationTypeMap()).get(relationTypeId);
  return { id: relationTypeId, role: rt?.role ?? null, coRole: rt?.coRole ?? rt?.corole ?? null };
}
