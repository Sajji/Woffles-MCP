# Operating Model Intelligence Workflow

Plan and validate any Collibra structural work (creating assets, relations, or types) against the instance's actual operating model instead of guessing names and UUIDs.

## When to use

- Before creating assets/relations in an unfamiliar instance
- When the user references a type/status/attribute by an approximate name
- When you need the shortest relation path between two asset types

## Steps

1. **`refresh_operating_model`** — crawl the instance once per session and cache the model (asset types, domain types, attribute types, relation types, statuses). Skip if already cached (the tool tells you).
2. **`get_operating_model_summary`** — cheap digest to prime context: type families, attribute kinds, statuses.
3. **`resolve_model_term`** — fuzzy-resolve every user-supplied term ("dataset", "steward", "approved") to concrete model elements with UUIDs. Never guess UUIDs.
4. **`describe_asset_type`** — full schema for the chosen type: assignable attributes (required vs optional), relation types, eligible statuses.
5. **`plan_asset_creation`** — resolves type + domain and emits a `nextAction` with the exact `create_asset` arguments.
6. **`validate_against_model`** — pre-flight the proposed write; fix violations before touching the API.
7. Execute with **`create_asset`** / **`bulk_create_assets`** / **`create_relation`** (all preview/confirm).
8. **`find_traversal_path`** — when you must navigate between asset types (e.g. Table → Business Term), get the relation chain instead of brute-forcing `get_asset_relations`.

## Rules

- Call `plan_write_operation` when unsure whether to use a singleton, bulk, or `edit_asset` tool.
- Required attributes are enforced by `create_asset` — supply them up front from step 4's output.
- The cache is per-instance; re-run step 1 after operating-model changes.
