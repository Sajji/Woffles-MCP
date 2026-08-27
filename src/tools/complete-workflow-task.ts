import { okPretty, okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const completeWorkflowTaskTool = {
  name: 'complete_workflow_task',
  description:
    'Complete an open Collibra workflow task (e.g. approve/reject a review step). ' +
    'Use find_workflow_tasks to locate the task_id. ' +
    'Two-step safety: confirm=false (default) previews the task and its form fields ' +
    '(so required form_properties like an approve/reject decision can be filled in); confirm=true completes the task. ' +
    'Completing a task advances the workflow and cannot be undone from this server.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      task_id: {
        type: 'string',
        description: 'UUID of the workflow task to complete (from find_workflow_tasks).',
      },
      form_properties: {
        type: 'object',
        description: 'Optional: task-form field values keyed by form property ID (see the preview for the fields).',
        additionalProperties: true,
      },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview. Set true to complete the task.',
        default: false,
      },
    },
    required: ['instance_name', 'task_id'],
  },
  outputSchema: {
    type: 'object',
    description: 'PREVIEW: task details + form fields. APPLIED: completion result and any follow-up tasks.',
    additionalProperties: true,
  },
};

export async function executeCompleteWorkflowTask(args: any): Promise<ToolResult> {
  const { instance_name, task_id, form_properties, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const task = await client.restCall<any>(`/rest/2.0/workflowTasks/${encodeURIComponent(task_id)}`);

    if (!confirm) {
      let taskFormData: any = null;
      try {
        taskFormData = await client.restCall<any>(
          `/rest/2.0/workflowTasks/${encodeURIComponent(task_id)}/taskFormData`,
        );
      } catch {
        taskFormData = { note: 'Task form data unavailable — the task may not define a form.' };
      }
      return okPretty({
        mode: 'PREVIEW — task NOT completed',
        task: {
          id: task.id,
          title: task.title ?? task.name ?? null,
          description: task.description ?? null,
          workflowDefinition: task.workflowDefinition ? { id: task.workflowDefinition.id, name: task.workflowDefinition.name } : null,
          businessItem: task.businessItemReference ?? task.businessItem ?? null,
        },
        formProperties: form_properties ?? {},
        taskFormData,
        instructions: 'Review the form fields; supply any required values in form_properties, then call again with confirm=true.',
      });
    }

    const body: any = { taskIds: [task_id] };
    if (form_properties && Object.keys(form_properties).length > 0) {
      body.formProperties = form_properties;
    }
    const resp = await client.restCallWithBody<any>('/rest/2.0/workflowTasks/completed', 'POST', body);
    const followUps: any[] = resp?.results ?? (Array.isArray(resp) ? resp : []);

    return okWithNext(
      {
        mode: 'APPLIED',
        completedTaskId: task_id,
        followUpTasks: followUps.map((t: any) => ({ id: t?.id, title: t?.title ?? t?.name ?? null })),
      },
      [
        { tool: 'find_workflow_tasks', args: { instance_name }, why: 'Check for remaining or newly created workflow tasks.' },
      ],
      true,
    );
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
      task_id,
    });
  }
}
