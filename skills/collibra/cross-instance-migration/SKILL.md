# Cross-Instance Migration Workflow

Copy or synchronize communities, domains, and assets between two configured Collibra instances idempotently.

## When to use

- Promoting content from a dev/sandbox instance to production
- Copying a glossary or catalog structure between environments

## Steps

1. **`get_instances`** — confirm both source and target instance names.
2. **`refresh_operating_model`** on BOTH instances — type/status UUIDs differ per instance and must never be reused across them.
3. Read from the source: **`get_communities`** / **`get_domains`** / **`query_assets`** (summary level first).
4. Resolve target UUIDs: **`resolve_model_term`** / **`get_domain_types`** / **`get_asset_statuses`** against the TARGET instance.
5. Create structure on the target: **`create_community`** → **`create_domain`** (both idempotent by name).
6. Create assets: **`bulk_create_assets`** with `skip_existing=true` (preview, then confirm).
7. Record provenance with **`add_mapping`** — external_system_id = a stable migration tag (e.g. `"woffles-migration-<source>"`), external_entity_id = the SOURCE asset UUID, mapped_resource_id = the TARGET asset UUID. This makes re-runs idempotent and auditable.
8. On re-runs, check **`find_mappings`** first to skip already-migrated items.
9. Recreate relations with **`bulk_create_relations`** (translate both endpoint UUIDs via the mappings).

## Rules

- Never copy UUIDs across instances — always resolve names on the target.
- Statuses and attribute types must be mapped by NAME (get_asset_statuses / get_attribute_types on the target).
- Prefer bulk tools; use `plan_write_operation` if unsure.
