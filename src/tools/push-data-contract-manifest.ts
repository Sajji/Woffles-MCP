import { getInstance } from '../config.js';

export const pushDataContractManifestTool = {
  name: 'push_data_contract_manifest',
  description:
    'Upload a new version of a data contract manifest to Collibra. ' +
    'If the manifest adheres to the Open Data Contract Standard (ODCS), the manifest_id and version ' +
    'are parsed automatically from the file content. ' +
    'Use force=true to overwrite an existing version with the same version value. ' +
    'Use active=true to make this the active version (deactivating the previous one).',
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
};

/**
 * Build a multipart/form-data body manually, avoiding any external form-data dependency.
 */
function buildMultipartBody(
  manifest: string,
  fields: Record<string, string>,
): { body: Buffer; contentType: string } {
  const boundary = `----CollibraMCPBoundary${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  // File part
  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="manifest"; filename="contract.yaml"\r\n` +
    `Content-Type: application/yaml\r\n\r\n`;
  parts.push(Buffer.from(fileHeader, 'utf8'));
  parts.push(Buffer.from(manifest, 'utf8'));
  parts.push(Buffer.from('\r\n', 'utf8'));

  // String fields
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

export async function executePushDataContractManifest(args: any): Promise<string> {
  const { instance_name, manifest, manifest_id, version, force = false, active = true } = args;

  try {
    const instance = getInstance(instance_name);
    const fetch = (await import('node-fetch')).default;
    const credentials = Buffer.from(`${instance.username}:${instance.password}`).toString('base64');

    const fields: Record<string, string> = {};
    if (manifest_id) fields['manifestId'] = manifest_id;
    if (version) fields['version'] = version;
    if (force) fields['force'] = 'true';
    if (active) fields['active'] = 'true';

    const { body, contentType } = buildMultipartBody(manifest, fields);
    const url = `${instance.baseUrl}/rest/dataProduct/v1/dataContracts/addFromManifest`;

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
      throw new Error(`HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`);
    }

    const responseBody = await response.json() as any;

    return JSON.stringify({
      success: true,
      instance: instance_name,
      id: responseBody.id,
      domainId: responseBody.domainId,
      manifestId: responseBody.manifestId,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
