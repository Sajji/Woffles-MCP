import { ok, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { getInstance } from '../config.js';

export const initDataContractTool = {
  name: 'init_data_contract',
  description:
    'Initialize a new data contract asset and link it to its initial manifest — the FIRST step in ' +
    'creating a data contract in Collibra. Governs a Data Product Port asset (governed_asset_id). ' +
    'Provide a manifest to upload, or omit it to auto-generate the manifest from the governed port\'s ' +
    'existing Collibra metadata. Idempotent by governed port: if an uninitialized contract already ' +
    'governs the port, that contract is initialized rather than duplicated. ' +
    'After initialization, use push_data_contract_manifest to add further manifest versions. ' +
    'Requires: dgc.data-contract.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      governed_asset_id: {
        type: 'string',
        description: 'The UUID of the Data Product Port asset to be governed by the data contract. This is the only required field.',
      },
      manifest: {
        type: 'string',
        description:
          'Optional: The content of the data contract manifest file to upload (typically YAML). ' +
          'If omitted, the manifest is auto-generated from the governed port\'s existing Collibra metadata.',
      },
      manifest_id: {
        type: 'string',
        description:
          'Optional: The unique identifier of the data contract as specified in the manifest. ' +
          'Auto-parsed from ODCS manifests; otherwise defaults to the UUID of the data contract asset. Max length: 200.',
      },
      version: {
        type: 'string',
        description:
          'Optional: The version value for the initial manifest. Auto-parsed from ODCS manifests; otherwise defaults to "0.0.1". Max length: 100.',
      },
      name: {
        type: 'string',
        description:
          'Optional: A custom, human-readable name for the data contract. Auto-parsed from ODCS manifests; otherwise inherits the name of the governed asset. Max length: 200.',
      },
      domain_id: {
        type: 'string',
        description:
          'Optional: The UUID of the domain where the data contract asset will be created. The domain must support the data contract asset type. Defaults to the domain of the governed asset.',
      },
    },
    required: ['instance_name', 'governed_asset_id'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      instance: { type: 'string' },
      id: { type: 'string', description: 'UUID of the data contract asset that was created or initialized.' },
      name: { type: 'string' },
      manifestId: { type: 'string' },
      domainId: { type: 'string' },
      domainName: { type: 'string' },
      activeVersion: { type: 'string' },
      format: { type: 'string', description: 'Format of the active manifest version: ODCS, DCS, or CUSTOM.' },
      error: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['instance'],
    additionalProperties: true,
  },
};

/**
 * Build a multipart/form-data body for the data-contract init endpoint. The
 * `manifest` file part is optional (omitting it tells Collibra to auto-generate
 * the manifest from the governed port's metadata); all other values are plain
 * form fields.
 */
function buildInitMultipartBody(
  manifest: string | undefined,
  fields: Record<string, string>,
): { body: Buffer; contentType: string } {
  const boundary = `----CollibraMCPBoundary${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  if (manifest) {
    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="manifest"; filename="contract.yaml"\r\n` +
      `Content-Type: application/yaml\r\n\r\n`;
    parts.push(Buffer.from(fileHeader, 'utf8'));
    parts.push(Buffer.from(manifest, 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  for (const [name, value] of Object.entries(fields)) {
    const fieldPart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`;
    parts.push(Buffer.from(fieldPart, 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export async function executeInitDataContract(args: any): Promise<ToolResult> {
  const { instance_name, governed_asset_id, manifest, manifest_id, version, name, domain_id } = args;

  if (!governed_asset_id) {
    return ok({ error: true, instance: instance_name, message: 'governed_asset_id is required.' });
  }

  try {
    const instance = getInstance(instance_name);
    const fetch = (await import('node-fetch')).default;
    const credentials = Buffer.from(`${instance.username}:${instance.password}`).toString('base64');

    // governedAssetId is a required form field; the rest are optional.
    const fields: Record<string, string> = { governedAssetId: governed_asset_id };
    if (manifest_id) fields['manifestId'] = manifest_id;
    if (version) fields['version'] = version;
    if (name) fields['name'] = name;
    if (domain_id) fields['domainId'] = domain_id;

    const { body, contentType } = buildInitMultipartBody(manifest, fields);
    const url = `${instance.baseUrl}/rest/dataProduct/v1/dataContracts`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': contentType,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      if (response.status === 403) {
        throw new Error(
          `HTTP 403 Forbidden — the authenticated user is likely missing the "dgc.data-contract" permission required to initialize data contracts.${errorBody ? ` Details: ${errorBody}` : ''}`,
        );
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`);
    }

    const responseBody = (await response.json()) as any;

    return okWithNext(
      {
        success: true,
        instance: instance_name,
        id: responseBody.id,
        name: responseBody.name,
        manifestId: responseBody.manifestId,
        domainId: responseBody.domainId,
        domainName: responseBody.domainName,
        activeVersion: responseBody.activeVersion,
        format: responseBody.manifestVersion?.format,
      },
      [
        { tool: 'push_data_contract_manifest', args: { instance_name, manifest: '<next manifest version>' }, why: 'Add a further manifest version to the initialized contract.' },
        { tool: 'pull_data_contract_manifest', args: { instance_name, data_contract_id: '<id from response>' }, why: 'Download the manifest that was generated or uploaded.' },
        { tool: 'list_data_contract', args: { instance_name, manifest_id: '<manifestId from response>' }, why: 'See contracts associated with this manifest.' },
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
