import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

export const retakeAssessmentTool = {
  name: 'retake_assessment',
  description:
    'Start a new revision (retake) of an existing assessment. ' +
    'Creates a new assessment based on the original, with a reference back to the origin assessment. ' +
    'The ability to retake is governed by the template\'s retakePermission policy ' +
    '(All, Owner, or OwnerAndAssignees). ' +
    'Optionally override the owner or linked asset for the new assessment. ' +
    'Returns the newly created assessment object.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to use (as defined in config.json)',
      },
      assessment_id: {
        type: 'string',
        description: 'UUID of the assessment to retake',
      },
      owner_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra user to set as the owner of the new retaken assessment. Defaults to the authenticated user.',
      },
      asset_id: {
        type: 'string',
        description: 'Optional: UUID of the Collibra asset to link the retaken assessment to. Defaults to the original assessment\'s linked asset.',
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

export async function executeRetakeAssessment(args: any): Promise<ToolResult> {
  const { instance_name, assessment_id, owner_id, asset_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const body: any = {};
    if (owner_id) body.owner = { id: owner_id };
    if (asset_id) body.asset = { id: asset_id };

    const response = await client.restCallWithBody<any>(
      `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment_id)}/retake`,
      'POST',
      body
    );

    return okWithNext({
      instance: instance_name,
      retaken: true,
      originAssessmentId: assessment_id,
      ...response,
    }, [
      { tool: 'get_assessment', args: { instance_name, assessment_id: '<new id from response>' }, why: 'Fetch the newly spawned iteration.' },
      { tool: 'update_assessment', args: { instance_name, assessment_id: '<new id from response>', content: '[...]' }, why: 'Answer the questions in the new iteration.' },
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
