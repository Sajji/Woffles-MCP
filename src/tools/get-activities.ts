import { withEnvelope } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';

const CATEGORIES = [
  'ATTRIBUTE', 'ATTACHMENT', 'RELATION', 'COMMENT', 'STATUS', 'WORKFLOW',
  'RESPONSIBILITY', 'USER', 'USER_GROUP', 'ROLE', 'TAGS', 'OTHERS',
];

export const getActivitiesTool = {
  name: 'get_activities',
  description:
    'Retrieve the Collibra activity stream (audit trail): who changed what and when. ' +
    'Filter by the resource the activity happened on (context_id — an asset/domain/community UUID), ' +
    'the acting user, activity categories (ATTRIBUTE, RELATION, STATUS, WORKFLOW, …), ' +
    'resource kinds, and a date range. Ideal for "what changed recently in this domain?" questions. ' +
    'Returns up to 100 activities per page, newest first.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      context_id: {
        type: 'string',
        description: 'Optional: UUID of the asset/domain/community whose activities to fetch.',
      },
      performed_by_user_id: {
        type: 'string',
        description: 'Optional: UUID of the user who performed the activities.',
      },
      categories: {
        type: 'array',
        items: { type: 'string', enum: CATEGORIES },
        description: `Optional: Activity categories to include: ${CATEGORIES.join(', ')}.`,
      },
      resource_discriminators: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Resource kinds the activities refer to (e.g. Asset, Domain, Community, Attribute, Relation, WorkflowInstance).',
      },
      start_date: {
        type: 'string',
        description: 'Optional: Earliest activity date (ISO 8601, e.g. 2026-08-01 or 2026-08-01T00:00:00Z).',
      },
      end_date: {
        type: 'string',
        description: 'Optional: Latest activity date (ISO 8601).',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 100, max: 1000).',
        default: 100,
      },
      offset: {
        type: 'number',
        description: 'Pagination offset (default: 0).',
        default: 0,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'Envelope with data.activities: audit-trail entries, newest first.',
    additionalProperties: true,
  },
};

function toEpochMs(iso: string, label: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid ${label}: "${iso}" — use ISO 8601 (e.g. 2026-08-01T00:00:00Z).`);
  return ms;
}

/**
 * Activities carry no resource field; the affected resource is encoded as JSON
 * in `description` (e.g. {"affected":{"name","id","type":"CO"}} or {"new":{...},"old":{...}}).
 * Parse it so callers get structured details and the resource it concerns.
 */
function describeActivity(description: unknown): { description: unknown; onResource: { id: string; name: string | null; typeCode: string | null } | null } {
  if (typeof description !== 'string') return { description: description ?? null, onResource: null };
  let parsed: any;
  try {
    parsed = JSON.parse(description);
  } catch {
    return { description, onResource: null };
  }
  const r = parsed?.affected ?? parsed?.new ?? parsed?.old;
  return {
    description: parsed,
    onResource: r?.id ? { id: r.id, name: r.name ?? null, typeCode: r.type ?? null } : null,
  };
}

export async function executeGetActivities(args: any): Promise<ToolResult> {
  const {
    instance_name,
    context_id,
    performed_by_user_id,
    categories,
    resource_discriminators,
    start_date,
    end_date,
    limit = 100,
    offset = 0,
  } = args;

  const { client } = clientFor(instance_name);

  const qp = new URLSearchParams({ limit: String(Math.min(limit, 1000)), offset: String(offset) });
  if (context_id) qp.set('contextId', context_id);
  if (performed_by_user_id) qp.set('performedByUserId', performed_by_user_id);
  for (const c of categories ?? []) qp.append('categories', c);
  for (const d of resource_discriminators ?? []) qp.append('resourceDiscriminators', d);
  if (start_date) qp.set('startDate', String(toEpochMs(start_date, 'start_date')));
  if (end_date) qp.set('endDate', String(toEpochMs(end_date, 'end_date')));

  const resp = await client.restCall<any>(`/rest/2.0/activities?${qp.toString()}`);
  const results: any[] = resp.results || [];

  const activities = results.map((a) => ({
    id: a.id,
    timestamp: a.timestamp ?? null,
    timestampIso: a.timestamp ? new Date(a.timestamp).toISOString() : null,
    activityType: a.activityType ?? null,
    ...describeActivity(a.description),
    cause: a.cause ?? null,
    callId: a.callId ?? null,
    user: a.user ? { id: a.user.id, userName: a.user.userName ?? null } : null,
  }));

  return withEnvelope({
    instance: instance_name,
    operation: 'get_activities',
    data: { count: activities.length, activities },
    pagination: { offset, limit, ...(results.length === limit ? { nextOffset: offset + limit } : {}) },
  });
}
