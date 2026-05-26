import { getInstance } from '../config.js';

export const pullDataContractManifestTool = {
  name: 'pull_data_contract_manifest',
  description:
    'Download the active manifest file for a data contract asset in Collibra. ' +
    'Use list_data_contract to find the data_contract_id (the asset UUID). ' +
    'Returns the raw manifest content (typically YAML).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      data_contract_id: {
        type: 'string',
        description: 'UUID of the data contract asset (from list_data_contract)',
      },
    },
    required: ['instance_name', 'data_contract_id'],
  },
};

export async function executePullDataContractManifest(args: any): Promise<string> {
  const { instance_name, data_contract_id } = args;

  try {
    const instance = getInstance(instance_name);
    const fetch = (await import('node-fetch')).default;
    const credentials = Buffer.from(`${instance.username}:${instance.password}`).toString('base64');

    const url = `${instance.baseUrl}/rest/dataProduct/v1/dataContracts/${encodeURIComponent(data_contract_id)}/activeVersion/manifest`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'text/plain, application/yaml, application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`);
    }

    const manifestContent = await response.text();

    return JSON.stringify({
      instance: instance_name,
      dataContractId: data_contract_id,
      manifest: manifestContent,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
