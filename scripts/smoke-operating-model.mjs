#!/usr/bin/env node
// Smoke test: exercises the model-aware tool chain end-to-end against a live instance.
// Usage: node scripts/smoke-operating-model.mjs [instance_name]
//   defaults to "prod". Honors COLLIBRA_CONFIG_PATH like the server does.

import { executeTool } from '../dist/tools/index.js';

const INSTANCE = process.argv[2] || 'prod';

function header(title) {
  const bar = '─'.repeat(Math.max(0, 70 - title.length));
  console.log(`\n── ${title} ${bar}`);
}

function previewStructured(result, keys) {
  const s = result.structured ?? {};
  const out = {};
  for (const k of keys) {
    if (k in s) out[k] = s[k];
  }
  return out;
}

async function call(tool, args) {
  header(`${tool}  ${JSON.stringify(args)}`);
  try {
    const result = await executeTool(tool, args);
    return result;
  } catch (err) {
    console.error(`  ✗ ${tool} threw: ${err.message}`);
    return null;
  }
}

async function main() {
  let failed = 0;
  const ok = (cond, msg) => {
    if (cond) {
      console.log(`  ✓ ${msg}`);
    } else {
      console.log(`  ✗ ${msg}`);
      failed++;
    }
  };

  // 1. Refresh the cache.
  const r1 = await call('refresh_operating_model', { instance_name: INSTANCE, force: true });
  const s1 = r1?.structured ?? {};
  ok(!!s1.data?.counts, 'refresh returned counts');
  ok(!!s1.model?.snapshotHash, 'refresh returned snapshotHash');
  ok(Array.isArray(s1.nextActions) && s1.nextActions.length > 0, 'refresh emitted nextActions');
  console.log('  counts:', JSON.stringify(s1.data?.counts));

  // 2. Summary digest.
  const r2 = await call('get_operating_model_summary', { instance_name: INSTANCE });
  const s2 = r2?.structured ?? {};
  ok(Array.isArray(s2.data?.topLevelAssetTypeFamilies), 'summary returned topLevelAssetTypeFamilies');
  ok(Array.isArray(s2.data?.statuses) && s2.data.statuses.length > 0, 'summary returned statuses');
  ok(typeof s2.data?.attributeKindDistribution === 'object', 'summary returned attributeKindDistribution');
  console.log('  topLevelFamilies(first 8):', (s2.data?.topLevelAssetTypeFamilies || []).slice(0, 8));
  console.log('  domainTypes(first 6):', (s2.data?.domainTypes || []).slice(0, 6));

  // 3. Resolve a generic term that exists in nearly every Collibra deployment.
  const r3 = await call('resolve_model_term', { instance_name: INSTANCE, term: 'Table' });
  const s3 = r3?.structured ?? {};
  ok(typeof s3.data === 'object', 'resolve returned data');
  const tableMatch = (s3.data?.assetTypes || []).find((t) => /^table$/i.test(t.name));
  ok(!!tableMatch, 'resolved an asset type named "Table"');

  // 4. Describe an asset type (use Table if we found it, otherwise the first asset type).
  let assetTypeForDescribe = tableMatch;
  if (!assetTypeForDescribe) {
    const r3b = await call('resolve_model_term', { instance_name: INSTANCE, term: '', categories: ['assetType'] });
    assetTypeForDescribe = (r3b?.structured?.data?.assetTypes || [])[0];
  }
  if (assetTypeForDescribe) {
    const r4 = await call('describe_asset_type', { instance_name: INSTANCE, asset_type_id: assetTypeForDescribe.id });
    const s4 = r4?.structured ?? {};
    ok(!!s4.data?.assetType, `describe returned assetType for "${assetTypeForDescribe.name}"`);
    ok(Array.isArray(s4.data?.eligibleStatuses), 'describe returned eligibleStatuses');
    console.log('  assignableAttributes(count):', (s4.data?.assignableAttributeTypes || []).length);
    console.log('  assignableRelations(count):', (s4.data?.assignableRelationTypes || []).length);
  }

  // 5. Find a traversal path (Table -> Business Term is a very common Collibra pattern).
  const r5 = await call('find_traversal_path', {
    instance_name: INSTANCE,
    source_asset_type_name: 'Table',
    target_asset_type_name: 'Business Term',
    max_depth: 4,
    max_paths: 2,
  });
  const s5 = r5?.structured ?? {};
  if (Array.isArray(s5.data?.paths)) {
    ok(true, `find_traversal_path returned ${s5.data.paths.length} path(s)`);
    for (const p of s5.data.paths) {
      console.log(`    length=${p.length}: ` + p.steps.map((st) => `${st.from} --[${st.label}]--> ${st.to}`).join('  '));
    }
  } else {
    ok(false, 'find_traversal_path returned a paths array');
  }

  // 6. Validate a bogus proposal — should report violations.
  const r6 = await call('validate_against_model', {
    instance_name: INSTANCE,
    proposal_type: 'asset',
    asset_type_id: '00000000-0000-0000-0000-000000000bad',
    status_id: '00000000-0000-0000-0000-000000000bad',
  });
  const s6 = r6?.structured ?? {};
  ok(s6.data?.valid === false, 'validate flagged a bogus asset proposal as invalid');
  ok(Array.isArray(s6.data?.violations) && s6.data.violations.length >= 2, 'violations include both asset_type and status');

  // 7. Discovery tool retrofit check — get_asset_types should now include nextActions.
  const r7 = await call('get_asset_types', { instance_name: INSTANCE });
  const s7 = r7?.structured ?? {};
  ok(Array.isArray(s7.nextActions) && s7.nextActions.length > 0, 'get_asset_types now emits nextActions');

  header('Summary');
  if (failed === 0) {
    console.log(`  ✓ All checks passed against instance "${INSTANCE}".`);
    process.exit(0);
  } else {
    console.log(`  ✗ ${failed} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
