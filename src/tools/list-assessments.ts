import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const listAssessmentsTool = {
  name: 'list_assessments',
  description:
    'List assessments from the Collibra Assessments API. ' +
    'Use assetId to find all assessments linked to a specific asset (e.g., an AI Use Case). ' +
    'Filter by status (DRAFT, SUBMITTED, OBSOLETE), templateId, templateVersion, or name. ' +
    'Results are sorted by lastModifiedOn descending (most recent first). ' +
    'Supports cursor-based pagination — pass the nextCursor from a response as cursor to fetch the next page. ' +
    'Limit defaults to 10; maximum is 50.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of the asset (e.g., AI Use Case) for which assessments were conducted',
      },
      status: {
        type: 'string',
        description: 'Optional: Filter by assessment status. Possible values: DRAFT, SUBMITTED, OBSOLETE (case-insensitive)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter by assessment name (case-insensitive contains match)',
      },
      template_id: {
        type: 'string',
        description: 'Optional: UUID of the assessment template to filter by',
      },
      template_version: {
        type: 'string',
        description: 'Optional: Version of the template. Use with template_id. Use LATEST for the latest version.',
      },
      last_modified_from: {
        type: 'string',
        description: 'Optional: ISO 8601 date-time — start of the lastModifiedOn filter range (inclusive). Example: 2023-07-10T15:03:10.433Z',
      },
      last_modified_to: {
        type: 'string',
        description: 'Optional: ISO 8601 date-time — end of the lastModifiedOn filter range (exclusive). Example: 2023-07-10T15:03:10.433Z',
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of assessments to return (default: 10, max: 50)',
        default: 10,
      },
      cursor: {
        type: 'string',
        description: 'Optional: Pagination cursor from the nextCursor field of a previous response',
      },
    },
    required: ['instance_name'],
  },
};

export async function executeListAssessments(args: any): Promise<string> {
  const {
    instance_name,
    asset_id,
    status,
    name,
    template_id,
    template_version,
    last_modified_from,
    last_modified_to,
    limit = 10,
    cursor,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (asset_id) params.append('assetId', asset_id);
    if (status) params.append('status', status);
    if (name) params.append('name', name);
    if (template_id) params.append('templateId', template_id);
    if (template_version) params.append('templateVersion', template_version);
    if (last_modified_from) params.append('lastModifiedFrom', last_modified_from);
    if (last_modified_to) params.append('lastModifiedTo', last_modified_to);
    params.append('limit', String(Math.min(Math.max(1, limit), 50)));
    if (cursor) params.append('cursor', cursor);

    const endpoint = `${ASSESSMENTS_BASE}/assessments?${params.toString()}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      filters: { asset_id, status, name, template_id, template_version },
      ...response,
    });
  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
