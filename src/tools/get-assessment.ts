import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeGetAssessment(args: any): Promise<ToolResult> {
  const { instance_name, assessment_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const endpoint = `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}`;
    const response = await client.restCall<any>(endpoint);

    return okWithNext({
      instance: instance_name,
      ...response,
    }, [
      { tool: 'update_assessment', args: { instance_name, assessment_id, status: '<new status>' }, why: 'Edit the assessment status, content, owner, or assignees.' },
      { tool: 'list_assessment_attachments', args: { instance_name, assessment_id }, why: 'List attached evidence files.' },
      { tool: 'retake_assessment', args: { instance_name, assessment_id }, why: 'Spawn a new iteration based on this one.' },
    ]);
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assessment_id,
    });
  }
}
