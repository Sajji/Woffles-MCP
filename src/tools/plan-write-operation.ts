import { okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';

/**
 * `plan_write_operation` — pure advisor (no API calls). Given a description of
 * the work to do, returns the recommended tool plus rationale. Designed to be
 * called by an agent before doing write work so it consistently picks the
 * most efficient endpoint family (single vs. bulk vs. multi-op edit).
 */
export const planWriteOperationTool = {
  name: 'plan_write_operation',
  description:
    'Decision helper for write operations. Given the kind of work (create asset/relation/community/domain, ' +
    'update attribute/description, or multi-op edit on one asset) and the number of items, returns the ' +
    'recommended tool and explanation. Use this BEFORE invoking write tools when in doubt. ' +
    'Pure logic — no API calls, safe to call at any time.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [
          'create_asset',
          'create_relation',
          'create_community',
          'create_domain',
          'update_attribute',
          'update_description',
          'add_business_term',
          'delete_asset',
          'delete_relation',
          'multi_op_one_asset',
        ],
        description: 'The kind of write you want to perform.',
      },
      items_count: {
        type: 'integer',
        minimum: 1,
        description: 'How many items (assets, relations, attribute updates, …) does the work involve?',
      },
      same_target_type: {
        type: 'boolean',
        description: 'For update_attribute: are all updates targeting the SAME attribute_type_id? (Affects whether bulk_update_asset_attributes can be used in one call.)',
        default: true,
      },
      affects_single_asset: {
        type: 'boolean',
        description: 'For multi_op_one_asset: confirm all ops target the same asset_id.',
        default: false,
      },
    },
    required: ['kind', 'items_count'],
  },
  outputSchema: {
    type: 'object',
    description: 'Recommended tool name + rationale.',
    additionalProperties: true,
  },
};

export async function executePlanWriteOperation(args: any): Promise<ToolResult> {
  const { kind, items_count, same_target_type = true, affects_single_asset = false } = args;
  const n: number = Math.max(1, Number(items_count) || 1);

  // Decision table
  let recommendation: string;
  let alternatives: string[] = [];
  let why: string;
  let efficiencyNote: string | undefined;

  switch (kind) {
    case 'create_asset': {
      if (n === 1) {
        recommendation = 'create_asset';
        alternatives = ['prepare_create_asset (call first to resolve IDs and check duplicates)'];
        why = 'Single asset: the singleton is fastest (no preview round trip).';
      } else {
        recommendation = 'bulk_create_assets';
        alternatives = ['create_asset (N×)'];
        why = `Creating ${n} assets in one bulk POST is ~${n}× fewer round trips. The tool also fans all attributes through a single /attributes/bulk call.`;
        efficiencyNote = `Approx round trips: bulk_create_assets = 1 lookup-batch + 1 POST + 1 attrs POST ≈ 3; create_asset×${n} = ${n}×(1+M) ≈ ${n * 2}+.`;
      }
      break;
    }
    case 'create_relation': {
      if (n === 1) {
        recommendation = 'create_relation';
        alternatives = [];
        why = 'Single relation: singleton handles idempotency in one round trip pair.';
      } else {
        recommendation = 'bulk_create_relations';
        alternatives = ['create_relation (N×)'];
        why = `Creating ${n} relations in one /relations/bulk POST is far fewer round trips. Idempotency check is grouped by (source, type).`;
      }
      break;
    }
    case 'create_community':
      recommendation = n === 1 ? 'create_community' : 'create_community (loop — no bulk wrapper today; /communities/bulk exists if you need to wire one up)';
      why = n === 1 ? 'Singleton already does idempotency.' : 'No bulk tool exposed yet — loop create_community or add a bulk_create_communities wrapper.';
      break;
    case 'create_domain':
      recommendation = n === 1 ? 'create_domain' : 'create_domain (loop — no bulk wrapper today; /domains/bulk exists if you need to wire one up)';
      why = n === 1 ? 'Singleton already does idempotency.' : 'No bulk tool exposed yet — loop create_domain or add a bulk_create_domains wrapper.';
      break;
    case 'update_attribute': {
      if (n === 1) {
        recommendation = 'update_asset_attribute';
        why = 'Single attribute update on one asset: singleton with confirm/preview.';
      } else if (same_target_type) {
        recommendation = 'bulk_update_asset_attributes';
        why = `Updating the same attribute_type on ${n} assets uses one /attributes/bulk PATCH (+ POST for missing values).`;
      } else {
        recommendation = 'edit_asset (per asset) OR multiple bulk_update_asset_attributes calls (one per attribute_type_id)';
        why = 'Updates span different attribute types — split by attribute_type_id and call bulk_update_asset_attributes for each group, or use edit_asset if all changes target the same asset.';
      }
      break;
    }
    case 'update_description': {
      recommendation = n === 1 ? 'update_asset_description' : 'bulk_update_asset_descriptions';
      why = n === 1 ? 'Single description update: singleton with preview/confirm.' : `Updating descriptions on ${n} assets uses /attributes/bulk PATCH (+ POST for missing).`;
      break;
    }
    case 'add_business_term': {
      if (n === 1) {
        recommendation = 'add_business_term';
        alternatives = ['prepare_add_business_term (call first to resolve domain and check duplicates)'];
        why = 'Singleton creates the asset and any attributes in one bulk attribute POST.';
      } else {
        recommendation = 'bulk_create_assets (with Business Term type and Definition attribute)';
        alternatives = ['add_business_term (N×)'];
        why = `For ${n} business terms, use bulk_create_assets with asset_type_id=<BusinessTerm> and attributes={ '00000000-0000-0000-0000-000000000202': definition }.`;
      }
      break;
    }
    case 'delete_asset':
      recommendation = n === 1 ? 'bulk_delete_assets (with a single-id array — preview is still valuable)' : 'bulk_delete_assets';
      why = 'Delete is destructive — always prefer the preview/confirm path that bulk_delete_assets provides.';
      break;
    case 'delete_relation':
      recommendation = n === 1 ? 'bulk_delete_relations (single-id array — preview still valuable)' : 'bulk_delete_relations';
      why = 'Delete is destructive — always prefer the preview/confirm path.';
      break;
    case 'multi_op_one_asset':
      recommendation = 'edit_asset';
      why = affects_single_asset
        ? `${n} mixed ops on one asset → edit_asset batches them into /attributes/bulk + /relations/bulk + 1 asset PATCH.`
        : 'edit_asset operates on a single asset_id. For ops spanning multiple assets, group by op kind and use the corresponding bulk_* tools.';
      break;
    default:
      recommendation = 'unknown';
      why = `Unsupported kind: ${kind}`;
  }

  return okPretty({
    inputs: { kind, items_count: n, same_target_type, affects_single_asset },
    recommendation,
    alternatives,
    why,
    ...(efficiencyNote ? { efficiencyNote } : {}),
    rules: {
      single: 'items_count === 1 → use the singleton (no preview round trip required).',
      bulkSameType: 'items_count > 1 AND same kind/target type → use the bulk variant.',
      multiOpOneAsset: 'Mixed ops on one asset → use edit_asset.',
      destructive: 'Any delete → always go through bulk_delete_* (preview/confirm).',
    },
  });
}
