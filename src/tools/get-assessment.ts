import { okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { clientFor } from './_context.js';
import { ASSESSMENTS_BASE } from '../utils/assessments.js';

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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssessment(args: any): Promise<ToolResult> {
  const { instance_name, assessment_id } = args;

  const { client } = clientFor(instance_name);

  const endpoint = `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}`;
  const response = await client.restCall<any>(endpoint);

  return okWithNext({
    ...response, // API fields first; our keys below take precedence
    instance: instance_name,
  }, [
    { tool: 'edit_assessment', args: { instance_name, assessment_id, operations: [] }, why: 'Edit the assessment (answers, status, owner, assignees, visibility) via typed operations.' },
    { tool: 'list_assessment_attachments', args: { instance_name, assessment_id }, why: 'List attached evidence files.' },
    { tool: 'retake_assessment', args: { instance_name, assessment_id }, why: 'Spawn a new iteration based on this one.' },
  ]);
}
