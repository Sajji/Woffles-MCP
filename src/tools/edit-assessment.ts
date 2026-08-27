import { okPretty, okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

const ASSESSMENTS_BASE = '/rest/assessments/v2';

/**
 * `edit_assessment` — chip-parity tool. Applies a list of typed operations to
 * a conducted assessment as a SINGLE atomic PATCH (all-or-nothing), replacing
 * the error-prone raw-JSON `update_assessment` flow. Answer edits are merged
 * into the assessment's current content so untouched questions are preserved.
 */
export const editAssessmentTool = {
  name: 'edit_assessment',
  description:
    'Edit a conducted assessment via a list of typed operations, applied as a single atomic PATCH (all-or-nothing). ' +
    'Identify the assessment by UUID (assessment_id) or by exact name (assessment_name). ' +
    'Supported ops: ' +
    'set_answer (answer a question by question_id: TEXT/HTML/EXPRESSION/NUMBER/BOOLEAN/DATE via value, or ITEMS via items; ' +
    'supply answer_type for a not-yet-answered question — an already-answered question\'s type is inferred), ' +
    'set_status (DRAFT, SUBMITTED, OBSOLETE), set_name, set_owner (user UUID), ' +
    'set_assignees (replace the assignee list), set_visibility (visible to everyone true/false). ' +
    'ASSETS/USERORGROUPS/ATTACHMENTS answer types are not supported. ' +
    'Answer edits are merged into the current content, so unedited questions keep their answers. ' +
    'Two-step safety: confirm=false (default) previews every resolved op; confirm=true applies. ' +
    'Prefer this over update_assessment (deprecated) for all assessment edits.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: { type: 'string', description: 'The Collibra instance name (as defined in config.json)' },
      assessment_id: { type: 'string', description: 'UUID of the assessment to edit (preferred).' },
      assessment_name: {
        type: 'string',
        description: 'Exact name of the assessment (used when assessment_id is not known). Ambiguous names return candidates.',
      },
      operations: {
        type: 'array',
        minItems: 1,
        description: 'Ordered list of typed edit operations.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['set_answer', 'set_status', 'set_name', 'set_owner', 'set_assignees', 'set_visibility'],
            },
            question_id: { type: 'string', description: 'For set_answer: the question UUID (from get_assessment content).' },
            value: {
              description: 'For set_answer: the answer value (string/number/boolean depending on answer type). Also used by set_status (status string) and set_name (new name).',
            },
            items: {
              type: 'array',
              items: { type: 'string' },
              description: 'For set_answer with ITEMS answers: the chosen item value(s).',
            },
            answer_type: {
              type: 'string',
              enum: ['TEXT', 'HTML', 'EXPRESSION', 'NUMBER', 'BOOLEAN', 'DATE', 'ITEMS'],
              description: 'For set_answer: required when the question has no existing answer to infer the type from.',
            },
            comments: { type: 'string', description: 'For set_answer: optional comment to attach to the answer.' },
            owner_id: { type: 'string', description: 'For set_owner: UUID of the new owner user.' },
            assignees: {
              type: 'array',
              description: 'For set_assignees: full replacement list of assignees.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['USER', 'GROUP'] },
                  id: { type: 'string' },
                },
                required: ['type', 'id'],
              },
            },
            visible: { type: 'boolean', description: 'For set_visibility: true = visible to everyone.' },
          },
          required: ['op'],
        },
      },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview. Set true to apply.',
        default: false,
      },
    },
    required: ['instance_name', 'operations'],
  },
  outputSchema: {
    type: 'object',
    description: 'PREVIEW: resolved ops with current vs proposed values. APPLIED: PATCH result.',
    additionalProperties: true,
  },
};

/** Resolve the assessment by id or exact name; throws with candidates baked into the message. */
async function resolveAssessment(
  client: CollibraClient,
  assessmentId?: string,
  assessmentName?: string,
): Promise<{ assessment: any } | { needsInput: ToolResult }> {
  if (assessmentId) {
    const assessment = await client.restCall<any>(
      `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessmentId)}`,
    );
    return { assessment };
  }
  if (!assessmentName) {
    return {
      needsInput: ok({
        error: true,
        message: 'Provide assessment_id (UUID) or assessment_name.',
      }),
    };
  }
  const list = await client.restCall<any>(
    `${ASSESSMENTS_BASE}/assessments?name=${encodeURIComponent(assessmentName)}&limit=50`,
  );
  const results: any[] = list.results || [];
  const exact = results.filter((a) => (a.name || '').toLowerCase() === assessmentName.toLowerCase());
  if (exact.length === 1) {
    const assessment = await client.restCall<any>(
      `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(exact[0].id)}`,
    );
    return { assessment };
  }
  return {
    needsInput: okPretty({
      status: 'needs_input',
      message:
        exact.length === 0
          ? `No assessment found with the exact name "${assessmentName}".`
          : `Multiple assessments named "${assessmentName}" — re-call with the assessment_id of the intended one.`,
      candidates: results.slice(0, 10).map((a) => ({ id: a.id, name: a.name, status: a.status })),
    }),
  };
}

export async function executeEditAssessment(args: any): Promise<ToolResult> {
  const { instance_name, assessment_id, assessment_name, operations, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const resolvedTarget = await resolveAssessment(client, assessment_id, assessment_name);
    if ('needsInput' in resolvedTarget) return resolvedTarget.needsInput;
    const assessment = resolvedTarget.assessment;

    // Current content, keyed by question id, in the shape PATCH expects.
    const currentContent: any[] = Array.isArray(assessment.content) ? assessment.content : [];
    const contentById = new Map<string, any>(currentContent.map((q: any) => [q.id, q]));

    const body: any = {};
    let contentTouched = false;
    // Deep-copy so merged answers don't mutate the fetched assessment.
    const mergedContent: any[] = JSON.parse(JSON.stringify(currentContent)).map((q: any) => ({
      id: q.id,
      ...(q.answer !== undefined && q.answer !== null ? { answer: q.answer } : {}),
      ...(q.comments !== undefined && q.comments !== null ? { comments: q.comments } : {}),
    }));
    const mergedById = new Map<string, any>(mergedContent.map((q: any) => [q.id, q]));

    const resolvedOps: any[] = [];

    for (const raw of operations as any[]) {
      switch (raw.op) {
        case 'set_answer': {
          const qid = raw.question_id;
          if (!qid) {
            resolvedOps.push({ op: raw.op, raw, error: 'set_answer requires question_id.' });
            break;
          }
          const currentQ = contentById.get(qid);
          const inferredType = currentQ?.answer?.type ?? null;
          const answerType = raw.answer_type || inferredType;
          if (!answerType) {
            resolvedOps.push({
              op: raw.op,
              raw,
              error: `Question ${qid} has no existing answer to infer the type from — supply answer_type.`,
            });
            break;
          }
          if (['ASSETS', 'USERORGROUPS', 'ATTACHMENTS'].includes(answerType)) {
            resolvedOps.push({ op: raw.op, raw, error: `Answer type ${answerType} is not supported.` });
            break;
          }
          const value = answerType === 'ITEMS' ? (raw.items ?? raw.value) : raw.value;
          if (value === undefined) {
            resolvedOps.push({
              op: raw.op,
              raw,
              error: answerType === 'ITEMS' ? 'ITEMS answers require items.' : 'set_answer requires value.',
            });
            break;
          }
          const proposedAnswer = { type: answerType, value };
          const target = mergedById.get(qid);
          if (target) {
            target.answer = proposedAnswer;
            if (raw.comments !== undefined) target.comments = raw.comments;
          } else {
            // Question absent from current content (e.g. never answered) — add it.
            const added: any = { id: qid, answer: proposedAnswer };
            if (raw.comments !== undefined) added.comments = raw.comments;
            mergedContent.push(added);
            mergedById.set(qid, added);
          }
          contentTouched = true;
          resolvedOps.push({
            op: raw.op,
            questionId: qid,
            current: currentQ?.answer ?? null,
            proposed: proposedAnswer,
            ...(raw.comments !== undefined ? { comments: raw.comments } : {}),
          });
          break;
        }
        case 'set_status': {
          const status = raw.value ?? raw.status;
          if (!['DRAFT', 'SUBMITTED', 'OBSOLETE'].includes(status)) {
            resolvedOps.push({ op: raw.op, raw, error: 'set_status value must be DRAFT, SUBMITTED, or OBSOLETE.' });
            break;
          }
          body.status = status;
          resolvedOps.push({ op: raw.op, current: assessment.status, proposed: status });
          break;
        }
        case 'set_name': {
          if (!raw.value) {
            resolvedOps.push({ op: raw.op, raw, error: 'set_name requires value (the new name).' });
            break;
          }
          body.name = raw.value;
          resolvedOps.push({ op: raw.op, current: assessment.name, proposed: raw.value });
          break;
        }
        case 'set_owner': {
          const ownerId = raw.owner_id ?? raw.value;
          if (!ownerId) {
            resolvedOps.push({ op: raw.op, raw, error: 'set_owner requires owner_id (user UUID).' });
            break;
          }
          body.owner = { id: ownerId };
          resolvedOps.push({ op: raw.op, current: assessment.owner ?? null, proposed: { id: ownerId } });
          break;
        }
        case 'set_assignees': {
          if (!Array.isArray(raw.assignees)) {
            resolvedOps.push({ op: raw.op, raw, error: 'set_assignees requires an assignees array of {type, id}.' });
            break;
          }
          body.assignees = raw.assignees;
          resolvedOps.push({ op: raw.op, current: assessment.assignees ?? [], proposed: raw.assignees });
          break;
        }
        case 'set_visibility': {
          if (typeof raw.visible !== 'boolean') {
            resolvedOps.push({ op: raw.op, raw, error: 'set_visibility requires visible (boolean).' });
            break;
          }
          body.isVisibleToEveryone = raw.visible;
          resolvedOps.push({ op: raw.op, current: assessment.isVisibleToEveryone ?? null, proposed: raw.visible });
          break;
        }
        default:
          resolvedOps.push({ op: raw.op, raw, error: `Unknown op: ${raw.op}` });
      }
    }

    if (contentTouched) {
      body.content = mergedContent;
    }

    const opErrors = resolvedOps.filter((r) => r.error);
    if (opErrors.length > 0) {
      return okPretty({
        error: true,
        message: `${opErrors.length} operation(s) failed to resolve — nothing was changed (the PATCH is all-or-nothing).`,
        assessment: { id: assessment.id, name: assessment.name, status: assessment.status },
        operations: resolvedOps,
      });
    }

    if (!confirm) {
      return okPretty({
        mode: 'PREVIEW — no changes made',
        assessment: { id: assessment.id, name: assessment.name, status: assessment.status },
        operationCount: resolvedOps.length,
        operations: resolvedOps,
        patchFields: Object.keys(body),
        instructions: 'To apply all operations atomically, call again with confirm=true.',
      });
    }

    const response = await client.restCallWithBody<any>(
      `${ASSESSMENTS_BASE}/assessments/${encodeURIComponent(assessment.id)}`,
      'PATCH',
      body,
    );

    return okWithNext(
      {
        mode: 'APPLIED',
        assessment: { id: assessment.id, name: response?.name ?? assessment.name, status: response?.status ?? assessment.status },
        operationsApplied: resolvedOps.length,
        operations: resolvedOps,
      },
      [
        { tool: 'get_assessment', args: { instance_name, assessment_id: assessment.id }, why: 'Verify the applied changes.' },
      ],
      true,
    );
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      assessment_id: assessment_id ?? null,
      assessment_name: assessment_name ?? null,
    });
  }
}
