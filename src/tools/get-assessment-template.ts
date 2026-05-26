import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const getAssessmentTemplateTool = {
  name: 'get_assessment_template',
  description:
    'Retrieve full details of a single assessment template by its UUID. ' +
    'Returns the template name, version, status (DRAFT, PUBLISHED, OBSOLETE), ' +
    'the linked assetType (showing which asset types this template applies to), ' +
    'notification settings, and retakePermission policy ' +
    '(All, Owner, or OwnerAndAssignees — dictates who can retake assessments of this template). ' +
    'Use list_assessment_templates to find template IDs.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      template_id: {
        type: 'string',
        description: 'The UUID of the assessment template to retrieve',
      },
    },
    required: ['instance_name', 'template_id'],
  },
};

export async function executeGetAssessmentTemplate(args: any): Promise<string> {
  const { instance_name, template_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${ASSESSMENTS_BASE}/templates/${encodeURIComponent(template_id)}`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      ...response,
    });
  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      template_id,
    });
  }
}
