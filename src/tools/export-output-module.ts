import { okPretty, ok } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

/**
 * `export_output_module` — run an Output Module TableViewConfig/ViewConfig
 * query and return the JSON results inline. This is Collibra's report-style
 * query engine: one call can join assets with their attributes, relations,
 * domain, and status — far more efficient than paging query_assets for large
 * extracts.
 */
export const exportOutputModuleTool = {
  name: 'export_output_module',
  description:
    'Run a Collibra Output Module query (TableViewConfig or ViewConfig JSON) and return the results inline as JSON. ' +
    'This is the report-style query engine: one call can join assets with attributes, relations, domain, and status — ' +
    'more efficient than paging query_assets for large extracts. ' +
    'Provide the full view config object in view_config. Example TableViewConfig listing assets in a domain: ' +
    '{"TableViewConfig":{"displayLength":100,"Resources":{"Asset":{"Id":{"name":"id"},"Signifier":{"name":"name"},' +
    '"AssetType":{"Signifier":{"name":"type"}},"Status":{"Signifier":{"name":"status"}},' +
    '"Domain":{"Id":{"name":"domainId"},"Signifier":{"name":"domain"}},' +
    '"Filter":{"Domain":{"Id":{"name":"domainId","value":"<domain-uuid>"}}}}}}. ' +
    'Admin console limits on result size/timeout apply. Syntax is NOT validated by default (set validate=true to validate).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      view_config: {
        type: 'object',
        description: 'The full Output Module view configuration: an object with a top-level "TableViewConfig" or "ViewConfig" key.',
        additionalProperties: true,
      },
      validate: {
        type: 'boolean',
        description: 'When true, Collibra validates the view config syntax before executing (default: false).',
        default: false,
      },
    },
    required: ['instance_name', 'view_config'],
  },
  outputSchema: {
    type: 'object',
    description: 'The raw Output Module JSON result (shape depends on the view config).',
    additionalProperties: true,
  },
};

export async function executeExportOutputModule(args: any): Promise<ToolResult> {
  const { instance_name, view_config, validate = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    if (!view_config || typeof view_config !== 'object' || (!view_config.TableViewConfig && !view_config.ViewConfig)) {
      return ok({
        error: true,
        message: 'view_config must be an object with a top-level "TableViewConfig" or "ViewConfig" key.',
        instance: instance_name,
      });
    }

    const qp = validate ? '?validationEnabled=true' : '';
    const result = await client.restCallWithBody<any>(
      `/rest/2.0/outputModule/export/json${qp}`,
      'POST',
      view_config,
    );

    return okPretty({
      instance: instance_name,
      operation: 'export_output_module',
      result,
    });
  } catch (error) {
    return ok({
      error: true,
      message:
        `${(error as Error).message} — check the view config syntax (set validate=true for server-side validation). ` +
        'See Collibra Output Module documentation for TableViewConfig/ViewConfig structure.',
      instance: instance_name,
    });
  }
}
