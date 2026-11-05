import { okPretty, okWithNext } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { authFetch } from '../utils/auth.js';
import { clientFor } from './_context.js';

export const removeDataClassificationMatchTool = {
  name: 'remove_data_classification_match',
  description:
    'Remove a data classification match (disassociate a data class from an asset) in Collibra. ' +
    'Use search_data_classification_match to find the classification_match_id. ' +
    'This tool uses a two-step safety process: ' +
    '1) Call with confirm=false (default) to PREVIEW the match that will be deleted. ' +
    '2) Call again with confirm=true to DELETE the match. ' +
    'Requires: dgc.classify, dgc.catalog, dgc.data-classes-edit.',
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
  outputSchema: {
    type: 'object',
    description: 'Structured result payload. Fields vary by tool; see inline JSON for details.',
    additionalProperties: true,
  },
};

export async function executeRemoveDataClassificationMatch(args: any): Promise<ToolResult> {
  const { instance_name, classification_match_id, confirm = false } = args;

  const { instance, client } = clientFor(instance_name);

  // Fetch the match first so we can show what will be deleted (best effort:
  // the preview still works with just the ID if the lookup is unavailable).
  const matchDetails: any = await client
    .restCall<any>(`/rest/catalog/1.0/dataClassification/classificationMatches/${encodeURIComponent(classification_match_id)}`)
    .catch(() => null);

  if (!confirm) {
    return okPretty({
      mode: 'PREVIEW — no changes made',
      instance: instance_name,
      classificationMatchId: classification_match_id,
      matchDetails: matchDetails || '(details not available — the match will be deleted if it exists)',
      instructions: 'To delete this classification match, call this tool again with confirm=true.',
    });
  }

  // DELETE the match
  const url = `${instance.baseUrl}/rest/catalog/1.0/dataClassification/classificationMatches/${encodeURIComponent(classification_match_id)}`;
  const response = await authFetch(instance, url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`DELETE failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  return okWithNext({
    mode: 'DELETED',
    instance: instance_name,
    classificationMatchId: classification_match_id,
    success: true,
  }, [
    { tool: 'search_data_classification_match', args: { instance_name }, why: 'Verify the match is gone.' },
  ], true);
}
