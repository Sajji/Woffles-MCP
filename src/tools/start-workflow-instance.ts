import { okPretty, okWithNext, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * `start_workflow_instance` — WRITE tool. Starting a workflow can create tasks
 * and send notifications to real users, so the two-step preview shows the
 * definition, target business items, and its start-form fields first.
 */
export const startWorkflowInstanceTool = {
  name: 'start_workflow_instance',
  description:
    'Start a Collibra workflow instance (e.g. an approval or review process) against one or more business items ' +
    '(assets, domains, or communities). Resolve the definition with find_workflow_definitions first, or pass ' +
    'workflow_definition_name to resolve by exact name. ' +
    'CAUTION: starting a workflow can create tasks for and send notifications to real users. ' +
    'Two-step safety: confirm=false (default) previews the definition, targets, and start-form fields ' +
    '(so required form_properties can be filled in); confirm=true starts the workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      workflow_definition_id: {
        type: 'string',
        description: 'UUID of the workflow definition to start (from find_workflow_definitions).',
      },
      workflow_definition_name: {
        type: 'string',
        description: 'Exact name of the workflow definition (used when the UUID is not known).',
      },
      business_item_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'UUIDs of the assets/domains/communities to run the workflow against. Omit for global workflows.',
      },
      business_item_type: {
        type: 'string',
        enum: ['ASSET', 'DOMAIN', 'COMMUNITY'],
        description: 'Resource type of the business items (default: ASSET).',
        default: 'ASSET',
      },
      form_properties: {
        type: 'object',
        description: 'Optional: start-form field values keyed by form property ID (see the preview for required fields).',
        additionalProperties: true,
      },
      send_notification: {
        type: 'boolean',
        description: 'Whether Collibra sends its usual start notifications (default: true).',
        default: true,
      },
      confirm: {
        type: 'boolean',
        description: 'When false (default), returns a preview. Set true to start the workflow.',
        default: false,
      },
    },
    required: ['instance_name'],
  },
  outputSchema: {
    type: 'object',
    description: 'PREVIEW: definition + start-form fields. APPLIED: started workflow instance(s).',
    additionalProperties: true,
  },
};

export async function executeStartWorkflowInstance(args: any): Promise<ToolResult> {
  const {
    instance_name,
    workflow_definition_id,
    workflow_definition_name,
    business_item_ids,
    business_item_type = 'ASSET',
    form_properties,
    send_notification = true,
    confirm = false,
  } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Resolve the definition by UUID or exact name
    let definition: any | null = null;
    if (workflow_definition_id) {
      definition = await client.restCall<any>(
        `/rest/2.0/workflowDefinitions/${encodeURIComponent(workflow_definition_id)}`,
      );
    } else if (workflow_definition_name) {
      const resp = await client.restCall<any>(
        `/rest/2.0/workflowDefinitions?name=${encodeURIComponent(workflow_definition_name)}&limit=50`,
      );
      const matches: any[] = (resp.results || []).filter(
        (d: any) => (d.name || '').toLowerCase() === workflow_definition_name.toLowerCase(),
      );
      if (matches.length === 1) {
        definition = matches[0];
      } else {
        return okPretty({
          status: 'needs_input',
          message:
            matches.length === 0
              ? `No workflow definition found with the exact name "${workflow_definition_name}".`
              : `Multiple workflow definitions named "${workflow_definition_name}" — re-call with workflow_definition_id.`,
          candidates: (resp.results || []).slice(0, 10).map((d: any) => ({ id: d.id, name: d.name })),
        });
      }
    } else {
      return ok({
        error: true,
        message: 'Provide workflow_definition_id or workflow_definition_name.',
        instance: instance_name,
      });
    }

    if (!confirm) {
      // Fetch the start-form fields so required inputs are visible before starting
      let startFormData: any = null;
      try {
        const qp = business_item_ids?.length
          ? `?businessItemId=${encodeURIComponent(business_item_ids[0])}`
          : '';
        startFormData = await client.restCall<any>(
          `/rest/2.0/workflowDefinitions/workflowDefinition/${encodeURIComponent(definition.id)}/startFormData${qp}`,
        );
      } catch {
        startFormData = { note: 'Start-form data unavailable — the workflow may not define a start form.' };
      }
      return okPretty({
        mode: 'PREVIEW — workflow NOT started',
        definition: { id: definition.id, name: definition.name, description: definition.description ?? null },
        businessItems: business_item_ids ?? [],
        businessItemType: business_item_type,
        formProperties: form_properties ?? {},
        startFormData,
        warning: 'Starting this workflow may create tasks and send notifications to real users.',
        instructions: 'Review the start-form fields; supply any required values in form_properties, then call again with confirm=true.',
      });
    }

    const body: any = {
      workflowDefinitionId: definition.id,
      sendNotification: send_notification,
    };
    if (business_item_ids?.length) {
      body.businessItemIds = business_item_ids;
      body.businessItemType = business_item_type;
    }
    if (form_properties && Object.keys(form_properties).length > 0) {
      body.formProperties = form_properties;
    }

    const started = await client.restCallWithBody<any>('/rest/2.0/workflowInstances', 'POST', body);
    const instances: any[] = Array.isArray(started) ? started : started?.results ?? [started];

    return okWithNext(
      {
        mode: 'APPLIED',
        definition: { id: definition.id, name: definition.name },
        started: instances.map((i: any) => ({
          workflowInstanceId: i?.id ?? null,
          businessItem: i?.businessItemReference ?? i?.businessItem ?? null,
        })),
      },
      [
        { tool: 'find_workflow_tasks', args: { instance_name }, why: 'See the tasks created by the started workflow.' },
      ],
      true,
    );
  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
