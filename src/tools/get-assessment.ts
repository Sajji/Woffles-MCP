import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const getAssessmentTool = {
  name: 'get_assessment',
  description:
    'Retrieve full details of a single assessment by its UUID. ' +
    'Returns the assessment name, status, template details (name, version, assetType), ' +
    'owner, assignees, visibility, all Q&A content (questions with their answers and comments), ' +
    'creation and modification timestamps, submission details, and the linked assessmentReview asset ID. ' +
    'Use list_assessments first to find the assessment ID.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      assessment_id: {
        type: 'string',
        description: 'The UUID of the assessment to retrieve',
      },
    },
    required: ['instance_name', 'assessment_id'],
  },
};

export async function executeGetAssessment(args: any): Promise<string> {
  const { instance_name, assessment_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}`;
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
      assessment_id,
    });
  }
}
