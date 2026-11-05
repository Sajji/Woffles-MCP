import { ok, okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';
import { authFetch } from '../utils/auth.js';
import { buildMultipartBody } from '../utils/multipart.js';

export const pushDataContractManifestTool = {
  name: 'push_data_contract_manifest',
  description:
    'Upload a new version of a data contract manifest to Collibra. ' +
    'If the manifest adheres to the Open Data Contract Standard (ODCS), the manifest_id and version ' +
    'are parsed automatically from the file content. ' +
    'Use force=true to overwrite an existing version with the same version value. ' +
    'Use active=true to make this the active version (deactivating the previous one). ' +
    'Requires: dgc.data-contract.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      manifest: {
        type: 'string',
        description: 'The full content of the data contract manifest file (typically YAML)',
      },
      manifest_id: {
        type: 'string',
        description: 'Optional: The unique identifier of the data contract. Auto-parsed from ODCS manifests.',
      },
      version: {
        type: 'string',
        description: 'Optional: The version of the manifest being uploaded. Auto-parsed from ODCS manifests.',
      },
      force: {
        type: 'boolean',
        description: 'Optional: Set to true to overwrite an existing manifest version with the same version value (default: false)',
        default: false,
      },
      active: {
        type: 'boolean',
        description: 'Optional: Set to true to make this the active version, deactivating the previous one (default: true)',
        default: true,
      },
    },
    required: ['instance_name', 'manifest'],
  },
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executePushDataContractManifest(args: any): Promise<ToolResult> {
  const { instance_name, manifest, manifest_id, version, force = false, active = true } = args;

  try {
    const instance = getInstance(instance_name);

    const fields: Record<string, string> = {};
    if (manifest_id) fields['manifestId'] = manifest_id;
    if (version) fields['version'] = version;
    // Send both flags explicitly so false is honoured even if the server defaults to true.
    fields['force'] = String(force === true);
    fields['active'] = String(active !== false);

    const { body, contentType } = buildMultipartBody(fields, {
      field: 'manifest',
      filename: 'contract.yaml',
      contentType: 'application/yaml',
      content: manifest,
    });
    const url = `${instance.baseUrl}/rest/dataProduct/v1/dataContracts/addFromManifest`;

    const response = await authFetch(instance, url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`);
    }

    const responseBody = await response.json() as any;

    return okWithNext({
      success: true,
      instance: instance_name,
      id: responseBody.id,
      domainId: responseBody.domainId,
      manifestId: responseBody.manifestId,
    }, [
      { tool: 'pull_data_contract_manifest', args: { instance_name, data_contract_id: '<id from response>' }, why: 'Verify the pushed manifest content.' },
      { tool: 'list_data_contract', args: { instance_name, manifest_id: '<manifestId from response>' }, why: 'See contracts associated with this manifest.' },
    ], true);

  } catch (error) {
    return ok({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
