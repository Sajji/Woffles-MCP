import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const getAssessmentByReviewTool = {
  name: 'get_assessment_by_review',
  description:
    'Retrieve an assessment by its associated Collibra Assessment Review asset ID. ' +
    'This is a reverse lookup — useful when you have the UUID of an "Assessment Review" asset ' +
    'in the Collibra catalog and need to find the corresponding assessment record with its Q&A content. ' +
    'Returns the same full assessment details as get_assessment.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      assessment_review_id: {
        type: 'string',
        description: 'The UUID of the Assessment Review asset in Collibra',
      },
    },
    required: ['instance_name', 'assessment_review_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssessmentByReview(args: any): Promise<ToolResult> {
  const { instance_name, assessment_review_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${ASSESSMENTS_BASE}/assessments/by/assessmentReview/${encodeURIComponent(assessment_review_id)}`;
    const response = await client.restCall<any>(endpoint);

    return ok({
      instance: instance_name,
      lookedUpBy: 'assessmentReviewId',
      assessmentReviewId: assessment_review_id,
      ...response,
    });
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assessment_review_id,
    });
  }
}
