#!/usr/bin/env node
// Smoke test: exercises the new bulk-write tools end-to-end against a live
// instance: bulk_create_assets, bulk_create_relations, edit_asset,
// bulk_delete_relations, bulk_delete_assets.
//
// Usage:
//   node scripts/smoke-bulk-writes.mjs [instance_name]                 # preview-only (safe; no writes)
//   node scripts/smoke-bulk-writes.mjs [instance_name] --apply         # creates + cleans up test assets
//
// Required env vars (apply mode only):
//   SMOKE_DOMAIN_ID            UUID of a Glossary-like domain that allows the asset type
//   SMOKE_ASSET_TYPE_ID        UUID of the asset type to create (e.g. Business Term)
//   SMOKE_RELATION_TYPE_ID     UUID of a relation type that connects asset_type → asset_type
//   SMOKE_DEFINITION_ATTR_ID   (optional) attribute type UUID to set during create
//                              (defaults to the well-known Definition attribute id)
//
// The script is self-cleaning: any test assets/relations it creates are
// deleted before exit, even on assertion failure.

import { executeTool } from '../dist/tools/index.js';

const INSTANCE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'prod';
const APPLY = process.argv.includes('--apply');

const DOMAIN_ID = process.env.SMOKE_DOMAIN_ID;
const ASSET_TYPE_ID = process.env.SMOKE_ASSET_TYPE_ID;
const RELATION_TYPE_ID = process.env.SMOKE_RELATION_TYPE_ID;
const DEFINITION_ATTR_ID = process.env.SMOKE_DEFINITION_ATTR_ID || '00000000-0000-0000-0000-000000000202';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const NAME_A = `mcp-smoke-A-${STAMP}`;
const NAME_B = `mcp-smoke-B-${STAMP}`;

function header(title) {
  const bar = '─'.repeat(Math.max(0, 70 - title.length));
  console.log(`\n── ${title} ${bar}`);
}

async function call(tool, args) {
  header(`${tool}  ${JSON.stringify(args).slice(0, 120)}`);
  try {
    const result = await executeTool(tool, args);
    return result;
  } catch (err) {
    console.error(`  ✗ ${tool} threw: ${err.message}`);
    return null;
  }
}

let failed = 0;
const expect = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ ${msg}`); failed++; }
};

async function main() {
  if (APPLY && (!DOMAIN_ID || !ASSET_TYPE_ID || !RELATION_TYPE_ID)) {
    console.error('✗ --apply requires SMOKE_DOMAIN_ID, SMOKE_ASSET_TYPE_ID, SMOKE_RELATION_TYPE_ID env vars.');
    process.exit(2);
  }

  console.log(`Instance: ${INSTANCE}`);
  console.log(`Mode:     ${APPLY ? 'APPLY (will create + delete test assets)' : 'PREVIEW-ONLY (no writes)'}`);
  if (APPLY) {
    console.log(`  domain_id        = ${DOMAIN_ID}`);
    console.log(`  asset_type_id    = ${ASSET_TYPE_ID}`);
    console.log(`  relation_type_id = ${RELATION_TYPE_ID}`);
  }

  // ── 1. bulk_create_assets — preview ──────────────────────────────────
  const previewArgs = {
    instance_name: INSTANCE,
    assets: [
      {
        name: NAME_A,
        asset_type_id: ASSET_TYPE_ID || '00000000-0000-0000-0000-000000000000',
        domain_id: DOMAIN_ID || '00000000-0000-0000-0000-000000000000',
        attributes: { [DEFINITION_ATTR_ID]: 'Smoke-test definition A' },
      },
      {
        name: NAME_B,
        asset_type_id: ASSET_TYPE_ID || '00000000-0000-0000-0000-000000000000',
        domain_id: DOMAIN_ID || '00000000-0000-0000-0000-000000000000',
      },
    ],
  };
  const r1 = await call('bulk_create_assets', previewArgs);
  const s1 = r1?.structured ?? {};
  expect(s1.mode === 'PREVIEW — no changes made' || !!s1.error, 'bulk_create_assets returned a preview (or error if creds missing)');
  if (s1.mode) {
    expect(s1.totalRequested === 2, 'preview totalRequested === 2');
    expect(Array.isArray(s1.details) && s1.details.length === 2, 'preview details has 2 entries');
  }

  if (!APPLY) {
    finish();
    return;
  }

  // ── 2. bulk_create_assets — apply ────────────────────────────────────
  const r2 = await call('bulk_create_assets', { ...previewArgs, confirm: true });
  const s2 = r2?.structured ?? {};
  expect(s2.mode === 'APPLIED', 'bulk_create_assets APPLIED');
  expect((s2.created || 0) >= 1, 'at least one asset created');

  const createdIds = (s2.details || [])
    .filter((d) => d.action === 'CREATED')
    .map((d) => d.assetId);
  console.log('  createdIds:', createdIds);
  expect(createdIds.length === 2, 'two new assetIds returned');

  try {
    const [idA, idB] = createdIds;

    // ── 3. bulk_create_relations — preview then apply ──────────────────
    const relPreview = await call('bulk_create_relations', {
      instance_name: INSTANCE,
      relations: [{ source_asset_id: idA, target_asset_id: idB, relation_type_id: RELATION_TYPE_ID }],
    });
    const sRelPrev = relPreview?.structured ?? {};
    expect(sRelPrev.mode === 'PREVIEW — no changes made', 'bulk_create_relations preview mode');

    const relApply = await call('bulk_create_relations', {
      instance_name: INSTANCE,
      relations: [{ source_asset_id: idA, target_asset_id: idB, relation_type_id: RELATION_TYPE_ID }],
      confirm: true,
    });
    const sRelApply = relApply?.structured ?? {};
    expect(sRelApply.mode === 'APPLIED', 'bulk_create_relations APPLIED');
    const newRelIds = (sRelApply.details || []).filter((d) => d.action === 'CREATED').map((d) => d.relationId);
    expect(newRelIds.length === 1, 'one new relationId returned');

    // Idempotency: re-issue, expect SKIP
    const relRepeat = await call('bulk_create_relations', {
      instance_name: INSTANCE,
      relations: [{ source_asset_id: idA, target_asset_id: idB, relation_type_id: RELATION_TYPE_ID }],
      confirm: true,
    });
    const sRelRepeat = relRepeat?.structured ?? {};
    expect((sRelRepeat.skipped || 0) >= 1, 're-issuing the same relation is idempotent (skipped)');

    // ── 4. edit_asset — multi-op preview then apply ────────────────────
    const editArgs = {
      instance_name: INSTANCE,
      asset_id: idA,
      operations: [
        { op: 'update_attribute', attribute_type_id: DEFINITION_ATTR_ID, value: 'Smoke-test definition A (edited)' },
        { op: 'add_relation', target_asset_id: idB, relation_type_id: RELATION_TYPE_ID }, // already exists → SKIP
      ],
    };
    const editPrev = await call('edit_asset', editArgs);
    const sEditPrev = editPrev?.structured ?? {};
    expect(sEditPrev.mode === 'PREVIEW — no changes made', 'edit_asset preview mode');

    const editApply = await call('edit_asset', { ...editArgs, confirm: true });
    const sEditApply = editApply?.structured ?? {};
    expect(sEditApply.mode === 'APPLIED', 'edit_asset APPLIED');
    expect(Array.isArray(sEditApply.appliedActions) && sEditApply.appliedActions.length >= 1, 'edit_asset applied at least one action');

    // ── 5. bulk_delete_relations — clean up the relation we created ────
    if (newRelIds.length > 0) {
      const delRel = await call('bulk_delete_relations', {
        instance_name: INSTANCE,
        relation_ids: newRelIds,
        confirm: true,
      });
      const sDelRel = delRel?.structured ?? {};
      expect(sDelRel.mode === 'APPLIED' && (sDelRel.deleted || 0) >= 1, 'bulk_delete_relations cleaned up relation');
    }
  } finally {
    // ── 6. bulk_delete_assets — always clean up the test assets ────────
    if (createdIds.length > 0) {
      const delPrev = await call('bulk_delete_assets', {
        instance_name: INSTANCE,
        asset_ids: createdIds,
      });
      const sDelPrev = delPrev?.structured ?? {};
      expect(sDelPrev.mode === 'PREVIEW — no changes made', 'bulk_delete_assets preview mode');

      const delApply = await call('bulk_delete_assets', {
        instance_name: INSTANCE,
        asset_ids: createdIds,
        confirm: true,
      });
      const sDelApply = delApply?.structured ?? {};
      expect(sDelApply.mode === 'APPLIED', 'bulk_delete_assets APPLIED');
      expect((sDelApply.deleted || 0) === createdIds.length, 'all test assets deleted');
    }
  }

  finish();
}

function finish() {
  header('Summary');
  if (failed === 0) {
    console.log('✓ bulk-writes smoke PASSED');
    process.exit(0);
  } else {
    console.log(`✗ bulk-writes smoke FAILED: ${failed} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
