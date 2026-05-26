import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const listAssessmentTemplatesTool = {
  name: 'list_assessment_templates',
  description:
    'List available assessment templates from the Collibra Assessments API. ' +
    'Templates define the structure (questions) for assessments. ' +
    'Use this to discover template IDs before creating an assessment. ' +
    'Filter by name, status (DRAFT, PUBLISHED, OBSOLETE), assetTypeId (to find templates applicable ' +
    'to a specific asset type such as AI Use Case), or set latest_version_only=true to retrieve ' +
    'only the most recent version of each template. ' +
    'Results are sorted alphabetically by name. Supports cursor-based pagination.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      name: {
        type: 'string',
        description: 'Optional: Filter templates by name (case-insensitive contains match)',
      },
      status: {
        type: 'string',
        description: 'Optional: Filter by template status. Possible values: DRAFT, PUBLISHED, OBSOLETE (case-insensitive)',
      },
      asset_type_id: {
        type: 'string',
        description: 'Optional: UUID of the asset type to filter templates that apply to that type (e.g., the AI Use Case asset type UUID)',
      },
      latest_version_only: {
        type: 'boolean',
        description: 'Optional: When true, returns only the latest version of each template. Default: false.',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Optional: Maximum number of templates to return (default: 10, max: 50)',
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

export async function executeListAssessmentTemplates(args: any): Promise<string> {
  const {
    instance_name,
    name,
    status,
    asset_type_id,
    latest_version_only,
    limit = 10,
    cursor,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const params = new URLSearchParams();
    if (name) params.append('name', name);
    if (status) params.append('status', status);
    if (asset_type_id) params.append('assetTypeId', asset_type_id);
    if (latest_version_only !== undefined) params.append('latestVersionOnly', String(latest_version_only));
    params.append('limit', String(Math.min(Math.max(1, limit), 50)));
    if (cursor) params.append('cursor', cursor);

    const endpoint = `${ASSESSMENTS_BASE}/templates?${params.toString()}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      filters: { name, status, asset_type_id, latest_version_only },
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
