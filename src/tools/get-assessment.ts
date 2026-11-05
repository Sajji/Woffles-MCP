import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';
import { ASSESSMENTS_BASE } from '../utils/assessments.js';

export const getAssessmentTool = {
  name: 'get_assessment',
  description:
    'Retrieve full details of a single assessment by its UUID, or by the UUID of its Assessment Review asset. ' +
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
        description: 'The UUID of the assessment to retrieve.',
      },
      assessment_review_id: {
        type: 'string',
        description: 'Alternative to assessment_id: the UUID of the Assessment Review asset linked to the assessment.',
      },
    },
    required: ['instance_name'],
    anyOf: [{ required: ['assessment_id'] }, { required: ['assessment_review_id'] }],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssessment(args: any): Promise<ToolResult> {
  const { instance_name, assessment_id, assessment_review_id } = args;

  const { client } = clientFor(instance_name);

  const endpoint = assessment_id
    ? `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}`
    : `${ASSESSMENTS_BASE}/assessments/by/assessmentReview/${encodeURIComponent(assessment_review_id)}`;
  const response = await client.restCall<any>(endpoint);
  const id = assessment_id ?? response.id ?? '<id from response>';

  return okWithNext({
    ...response, // API fields first; our keys below take precedence
    instance: instance_name,
    ...(assessment_id ? {} : { lookedUpBy: 'assessmentReviewId', assessmentReviewId: assessment_review_id }),
  }, [
    { tool: 'edit_assessment', args: { instance_name, assessment_id: id, operations: [{ op: 'set_status', value: '<new status>' }] }, why: 'Edit the assessment (answers, status, owner, assignees, visibility) via typed operations.' },
    { tool: 'list_assessment_attachments', args: { instance_name, assessment_id: id }, why: 'List attached evidence files.' },
    { tool: 'retake_assessment', args: { instance_name, assessment_id: id }, why: 'Spawn a new iteration based on this one.' },
  ]);
}
