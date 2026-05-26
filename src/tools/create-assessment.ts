import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const createAssessmentTool = {
  name: 'create_assessment',
  description:
    'Create a new assessment in the Collibra Assessments application. ' +
    'Requires a templateId (use list_assessment_templates to find one). ' +
    'Providing an assetId links the assessment to an existing Collibra asset (e.g., an AI Use Case); ' +
    'when an asset is provided, the asset\'s name is used as the assessment name. ' +
    'If no assetId is provided, a name is required. ' +
    'The content field accepts a raw JSON string representing an array of question answers: ' +
    '[{"id":"questionId","answer":{"type":"BOOLEAN","value":true},"comments":"optional comment"}]. ' +
    'Answer types: TEXT, HTML, DATE (yyyy-MM-dd), BOOLEAN, ITEMS, NUMBER, EXPRESSION, ASSETS, USERORGROUPS, ATTACHMENTS. ' +
    'The assignees field accepts a raw JSON string: [{"type":"USER","id":"uuid"},{"type":"GROUP","id":"uuid"}]. ' +
    'If owner_id is omitted, the authenticated user becomes the owner.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to use (as defined in config.json)',
      },
      template_id: {
        type: 'string',
        description: 'UUID of the assessment template to use. Use list_assessment_templates to find available templates.',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra asset (e.g., AI Use Case) to link this assessment to. When provided, the asset\'s name is used as the assessment name.',
      },
      name: {
        type: 'string',
        description: 'Optional: Name for the assessment. Required if asset_id is not provided. Ignored when asset_id is provided (asset name is used instead).',
      },
      status: {
        type: 'string',
        description: 'Optional: Initial status of the assessment. Possible values: DRAFT, SUBMITTED. Defaults to DRAFT.',
      },
      owner_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra user to set as the assessment owner. Defaults to the authenticated user.',
      },
      assignees: {
        type: 'string',
        description: 'Optional: Raw JSON string of assignees array. Example: [{"type":"USER","id":"uuid1"},{"type":"GROUP","id":"uuid2"}]',
      },
      is_visible_to_everyone: {
        type: 'boolean',
        description: 'Optional: When true, the assessment is visible to everyone. When false, only owner and assignees can access it. Default: false.',
        default: false,
      },
      assessment_review_domain_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra domain where the Assessment Review asset will be created.',
      },
      content: {
        type: 'string',
        description: 'Optional: Raw JSON string of initial Q&A answers. Example: [{"id":"questionId","answer":{"type":"BOOLEAN","value":true},"comments":"comment"}]',
      },
    },
    required: ['instance_name', 'template_id'],
  },
};

export async function executeCreateAssessment(args: any): Promise<string> {
  const {
    instance_name,
    template_id,
    asset_id,
    name,
    status,
    owner_id,
    assignees,
    is_visible_to_everyone,
    assessment_review_domain_id,
    content,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const body: any = {
      template: { id: template_id },
    };

    if (asset_id) body.asset = { id: asset_id };
    if (name) body.name = name;
    if (status) body.status = status;
    if (owner_id) body.owner = { id: owner_id };
    if (is_visible_to_everyone !== undefined) body.isVisibleToEveryone = is_visible_to_everyone;
    if (assessment_review_domain_id) body.assessmentReviewDomain = { id: assessment_review_domain_id };

    if (assignees) {
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

    if (content) {
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
      `${ASSESSMENTS_BASE}/assessments`,
      'POST',
      body
    );

    return JSON.stringify({
      instance: instance_name,
      created: true,
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
