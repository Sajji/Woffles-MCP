import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const addDataClassificationMatchTool = {
  name: 'add_data_classification_match',
  description:
    'Associate a data class (classification) with a specific data asset in Collibra. ' +
    'Use search_data_class to find the classificationId and get_asset_by_id or search_assets_by_name to find the assetId. ' +
    'Returns an error if the classification match already exists (HTTP 422) or if either UUID is not found (HTTP 404).',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      asset_id: {
        type: 'string',
        description: 'UUID of the asset to classify',
      },
      classification_id: {
        type: 'string',
        description: 'UUID of the data class to apply (from search_data_class)',
      },
    },
    required: ['instance_name', 'asset_id', 'classification_id'],
  },
};

export async function executeAddDataClassificationMatch(args: any): Promise<string> {
  const { instance_name, asset_id, classification_id } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    const match = await client.restCallWithBody<any>(
      '/rest/catalog/1.0/dataClassification/classificationMatches',
      'POST',
      { assetId: asset_id, classificationId: classification_id },
    );

    return JSON.stringify({
      success: true,
      instance: instance_name,
      match: {
        id: match.id,
        status: match.status,
        confidence: match.confidence,
        asset: match.asset,
        classification: match.classification,
        createdBy: match.createdBy,
        createdOn: match.createdOn,
      },
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
