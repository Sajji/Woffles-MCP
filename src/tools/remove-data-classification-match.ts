import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const removeDataClassificationMatchTool = {
  name: 'remove_data_classification_match',
  description:
    'Remove a data classification match (disassociate a data class from an asset) in Collibra. ' +
    'Use search_data_classification_match to find the classification_match_id. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the match that will be deleted. ' +
    '2) Call again with confirm=true to DELETE the match.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance (as defined in config.json)',
      },
      classification_match_id: {
        type: 'string',
        description: 'UUID of the classification match to remove (from search_data_classification_match)',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually delete the match. When false (default), returns a preview without making changes.',
        default: false,
      },
    },
    required: ['instance_name', 'classification_match_id'],
  },
};

export async function executeRemoveDataClassificationMatch(args: any): Promise<string> {
  const { instance_name, classification_match_id, confirm = false } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch the match first so we can show what will be deleted
    let matchDetails: any = null;
    try {
      const matchResp = await client.restCall<any>(
        `/rest/catalog/1.0/dataClassification/classificationMatches?limit=1&offset=0`,
      );
      // Try to find the specific match if a direct GET by ID endpoint is available
      const directMatch = await client.restCall<any>(
        `/rest/catalog/1.0/dataClassification/classificationMatches/${classification_match_id}`,
      ).catch(() => null);
      matchDetails = directMatch;
    } catch {
      // Not critical — proceed with just the ID
    }

    if (!confirm) {
      return JSON.stringify({
        mode: 'PREVIEW — no changes made',
        instance: instance_name,
        classificationMatchId: classification_match_id,
        matchDetails: matchDetails || '(details not available — the match will be deleted if it exists)',
        instructions: 'To delete this classification match, call this tool again with confirm=true.',
      }, null, 2);
    }

    // DELETE the match
    const url = `${instance.baseUrl}/rest/catalog/1.0/dataClassification/classificationMatches/${classification_match_id}`;
    const fetch = (await import('node-fetch')).default;
    const credentials = Buffer.from(`${instance.username}:${instance.password}`).toString('base64');
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`DELETE failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
    }

    return JSON.stringify({
      mode: 'DELETED',
      instance: instance_name,
      classificationMatchId: classification_match_id,
      success: true,
    }, null, 2);

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
