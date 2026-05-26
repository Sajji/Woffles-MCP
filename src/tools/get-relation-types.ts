import { getInstance } from '../config.js';
import { CollibraClient } from '../utils/collibra-client.js';

export const getRelationTypesTool = {
  name: 'get_relation_types',
  description: 'Retrieve the operating model of a Collibra instance — the full list of Relation Types ' +
    'that define how asset types relate to each other. Each relation type specifies a source asset type, ' +
    'a target asset type, a role (source→target label), and a co-role (target→source label). ' +
    'WORKFLOW: Call this tool early to understand which asset types are connected and how, ' +
    'so you can plan efficient traversal paths. For example, if a user asks "What data sets use this table?", ' +
    'the relation types will reveal that Tables relate to Columns, and Columns relate to Data Sets, ' +
    'so you should traverse Table → Columns → Data Sets rather than searching blindly. ' +
    'Optionally filter by source or target asset type name to narrow results.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_name: {
        type: 'string',
        description: 'The name of the Collibra instance to query (as defined in config.json)',
      },
      source_type_name: {
        type: 'string',
        description: 'Optional: Filter to only relation types where the source asset type name contains this value (case-insensitive)',
      },
      target_type_name: {
        type: 'string',
        description: 'Optional: Filter to only relation types where the target asset type name contains this value (case-insensitive)',
      },
      role: {
        type: 'string',
        description: 'Optional: Filter to only relation types where the role label contains this value (case-insensitive)',
      },
    },
    required: ['instance_name'],
  },
};

export async function executeGetRelationTypes(args: any): Promise<string> {
  const { instance_name, source_type_name, target_type_name, role } = args;

  try {
    const instance = getInstance(instance_name);
    const client = new CollibraClient(instance);

    // Fetch all relation types (paginate if needed)
    let allResults: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const response = await client.restCall<any>(
        `/rest/2.0/relationTypes?offset=${offset}&limit=${pageSize}&sortField=ROLE&sortOrder=ASC`
      );
      const results = response.results || [];
      allResults = allResults.concat(results);
      hasMore = results.length === pageSize;
      offset += pageSize;
    }

    // Apply client-side filters
    let filtered = allResults;

    if (source_type_name) {
      const lc = source_type_name.toLowerCase();
      filtered = filtered.filter((r: any) =>
        r.sourceType?.name?.toLowerCase().includes(lc)
      );
    }

    if (target_type_name) {
      const lc = target_type_name.toLowerCase();
      filtered = filtered.filter((r: any) =>
        r.targetType?.name?.toLowerCase().includes(lc)
      );
    }

    if (role) {
      const lc = role.toLowerCase();
      filtered = filtered.filter((r: any) =>
        r.role?.toLowerCase().includes(lc) || r.coRole?.toLowerCase().includes(lc)
      );
    }

    // Map to a concise, useful shape
    const relationTypes = filtered.map((r: any) => ({
      id: r.id,
      sourceType: {
        id: r.sourceType?.id,
        name: r.sourceType?.name,
      },
      targetType: {
        id: r.targetType?.id,
        name: r.targetType?.name,
      },
      role: r.role,
      coRole: r.coRole,
    }));

    return JSON.stringify({
      instance: instance_name,
      filters: {
        sourceTypeName: source_type_name || 'All',
        targetTypeName: target_type_name || 'All',
        role: role || 'All',
      },
      total: allResults.length,
      returned: relationTypes.length,
      relationTypes,
    });

  } catch (error) {
    return JSON.stringify({
      error: true,
      message: (error as Error).message,
      instance: instance_name,
    });
  }
}
