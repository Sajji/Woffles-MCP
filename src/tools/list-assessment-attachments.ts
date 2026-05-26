import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const listAssessmentAttachmentsTool = {
  name: 'list_assessment_attachments',
  description:
    'List file attachments for a specific assessment. ' +
    'Returns each attachment ID, original file name, the UUID of the user who uploaded it, ' +
    'and the upload timestamp. ' +
    'Attachment IDs can be referenced in assessment answers (type: ATTACHMENTS). ' +
    'Use get_assessment to find the assessment ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      assessment_id: {
        type: 'string',
        description: 'The UUID of the assessment whose attachments to list',
      },
    },
    required: ['instance_name', 'assessment_id'],
  },
};

export async function executeListAssessmentAttachments(args: any): Promise<string> {
  const { instance_name, assessment_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}/attachments`;
    const response = await client.restCall<any>(endpoint);

    return JSON.stringify({
      instance: instance_name,
      assessment_id,
      attachments: response,
    });
  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assessment_id,
    });
  }
}
