import type { ToolResult } from '../types.js';
import { executeGetAssessment } from './get-assessment.js';

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

/** Legacy name — same as get_assessment with assessment_review_id. */
export async function executeGetAssessmentByReview(args: any): Promise<ToolResult> {
  return executeGetAssessment(args);
}
