import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const updateAssessmentTool = {
  name: 'update_assessment',
  description:
    'Update an existing assessment. All fields are optional — only provided fields are changed. ' +
    'Common uses: submit an assessment (set status to SUBMITTED), update Q&A answers, ' +
    'change the owner or assignees, or toggle visibility. ' +
    'The content field replaces the full Q&A content when provided. ' +
    'Accepts content as a raw JSON string: ' +
    '[{"id":"questionId","answer":{"type":"BOOLEAN","value":true},"comments":"optional"}]. ' +
    'The assignees field accepts a raw JSON string: [{"type":"USER","id":"uuid"},{"type":"GROUP","id":"uuid"}]. ' +
    'Use get_assessment to see the current state before making changes.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to use (as defined in config.json)',
      },
      assessment_id: {
        type: 'string',
        description: 'UUID of the assessment to update',
      },
      status: {
        type: 'string',
        description: 'Optional: New status. Possible values: DRAFT, SUBMITTED, OBSOLETE',
      },
      name: {
        type: 'string',
        description: 'Optional: New name for the assessment',
      },
      owner_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra user to set as the new owner',
      },
      assignees: {
        type: 'string',
        description: 'Optional: Raw JSON string replacing all assignees. Example: [{"type":"USER","id":"uuid1"},{"type":"GROUP","id":"uuid2"}]',
      },
      is_visible_to_everyone: {
        type: 'boolean',
        description: 'Optional: Update visibility. When true, everyone can view. When false, only owner and assignees.',
      },
      assessment_review_domain_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra domain for the Assessment Review asset',
      },
      content: {
        type: 'string',
        description: 'Optional: Raw JSON string replacing all Q&A answers. Example: [{"id":"questionId","answer":{"type":"TEXT","value":"my answer"},"comments":"note"}]',
      },
    },
    required: ['instance_name', 'assessment_id'],
  },
};

export async function executeUpdateAssessment(args: any): Promise<string> {
  const {
    instance_name,
    assessment_id,
    status,
    name,
    owner_id,
    assignees,
    is_visible_to_everyone,
    assessment_review_domain_id,
    content,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const body: any = {};

    if (status !== undefined) body.status = status;
    if (name !== undefined) body.name = name;
    if (owner_id !== undefined) body.owner = { id: owner_id };
    if (is_visible_to_everyone !== undefined) body.isVisibleToEveryone = is_visible_to_everyone;
    if (assessment_review_domain_id !== undefined) body.assessmentReviewDomain = { id: assessment_review_domain_id };

    if (assignees !== undefined) {
      try {
        body.assignees = JSON.parse(assignees);
      } catch {
        return JSON.stringify({
          error: true,
          message: 'Invalid JSON in assignees field. Expected format: [{"type":"USER","id":"uuid"}]',
          instance: instance_name,
        });
      }
    }

    if (content !== undefined) {
      try {
        body.content = JSON.parse(content);
      } catch {
        return JSON.stringify({
          error: true,
          message: 'Invalid JSON in content field. Expected format: [{"id":"questionId","answer":{"type":"BOOLEAN","value":true}}]',
          instance: instance_name,
        });
      }
    }

    const response = await client.restCallWithBody<any>(
      `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}`,
      'PATCH',
      body
    );

    return JSON.stringify({
      instance: instance_name,
      updated: true,
      assessment_id,
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
