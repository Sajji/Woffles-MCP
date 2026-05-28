#!/usr/bin/env node
// Smoke test: exercises plan_write_operation. Pure logic, no API calls — safe
// to run anywhere, no credentials required.
//
//   node scripts/smoke-plan-write-operation.mjs

import { executeTool } from '../dist/tools/index.js';

function header(title) {
  const bar = '─'.repeat(Math.max(0, 70 - title.length));
  console.log(`\n── ${title} ${bar}`);
}

async function call(args) {
  const result = await executeTool('plan_write_operation', args);
  return result?.structured ?? {};
}

async function main() {
  let failed = 0;
  const expect = (cond, msg) => {
    if (cond) console.log(`  ✓ ${msg}`);
    else { console.log(`  ✗ ${msg}`); failed++; }
  };

  const cases = [
    {
      title: 'Single asset → create_asset',
      args: { kind: 'create_asset', items_count: 1 },
      want: 'create_asset',
    },
    {
      title: '5 assets → bulk_create_assets',
      args: { kind: 'create_asset', items_count: 5 },
      want: 'bulk_create_assets',
    },
    {
      title: 'Single relation → create_relation',
      args: { kind: 'create_relation', items_count: 1 },
      want: 'create_relation',
    },
    {
      title: '20 relations → bulk_create_relations',
      args: { kind: 'create_relation', items_count: 20 },
      want: 'bulk_create_relations',
    },
    {
      title: 'Single attribute update → update_asset_attribute',
      args: { kind: 'update_attribute', items_count: 1 },
      want: 'update_asset_attribute',
    },
    {
      title: '10 updates of same attribute type → bulk_update_asset_attributes',
      args: { kind: 'update_attribute', items_count: 10, same_target_type: true },
      want: 'bulk_update_asset_attributes',
    },
    {
      title: '10 updates across different attribute types → split / edit_asset',
      args: { kind: 'update_attribute', items_count: 10, same_target_type: false },
      wantContains: 'edit_asset',
    },
    {
      title: 'Single description update → update_asset_description',
      args: { kind: 'update_description', items_count: 1 },
      want: 'update_asset_description',
    },
    {
      title: '12 description updates → bulk_update_asset_descriptions',
      args: { kind: 'update_description', items_count: 12 },
      want: 'bulk_update_asset_descriptions',
    },
    {
      title: 'Single business term → add_business_term',
      args: { kind: 'add_business_term', items_count: 1 },
      want: 'add_business_term',
    },
    {
      title: '50 business terms → bulk_create_assets',
      args: { kind: 'add_business_term', items_count: 50 },
      wantContains: 'bulk_create_assets',
    },
    {
      title: 'Single delete → bulk_delete_assets (preview enforced)',
      args: { kind: 'delete_asset', items_count: 1 },
      wantContains: 'bulk_delete_assets',
    },
    {
      title: '3 relation deletes → bulk_delete_relations',
      args: { kind: 'delete_relation', items_count: 3 },
      want: 'bulk_delete_relations',
    },
    {
      title: 'Multi-op on one asset → edit_asset',
      args: { kind: 'multi_op_one_asset', items_count: 5, affects_single_asset: true },
      want: 'edit_asset',
    },
  ];

  for (const c of cases) {
    header(c.title);
    const out = await call(c.args);
    console.log(`  recommendation: ${out.recommendation}`);
    console.log(`  why:            ${out.why}`);
    if (c.want) expect(out.recommendation === c.want, `recommendation === "${c.want}"`);
    else if (c.wantContains) expect((out.recommendation || '').includes(c.wantContains), `recommendation contains "${c.wantContains}"`);
    expect(!!out.why, 'rationale present');
    expect(!!out.rules, 'rules block present');
  }

  header('Summary');
  if (failed === 0) {
    console.log(`✓ plan_write_operation smoke PASSED (${cases.length} scenarios)`);
    process.exit(0);
  } else {
    console.log(`✗ plan_write_operation smoke FAILED: ${failed} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
