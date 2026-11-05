# Changelog

## Unreleased — Internal consolidation (Review plan, Phase 3)

No tools were added, removed or renamed, and `tools/list` is unchanged. Results were compared before and after on Production and Sandbox across 80 read calls: every successful result is identical.

### Changed
- **One error boundary.** `executeTool` now catches errors from every tool and returns the standard `{ error: true, message, instance }` result, flagged as MCP `isError`.
  - 78 tools had a try/catch that only built that same error. Those blocks were removed by a script that refused to touch any catch doing something else; 13 custom ones remain.
  - Errors from the usage-analytics and `errorEnvelope` tools now use this standard flat shape instead of `{ errors: [...], data: null }`.
- **One tool registry.** `src/tools/index.ts` used to keep two hand-maintained lists side by side: tool definitions and an executor map. It now has a single list of `[definition, executor]` pairs.
- **`clientFor(instance_name)`** (`src/tools/_context.ts`) replaces the "look up the instance, then build a client" lines that were repeated in 81 tools.
- **Duplicated code moved into shared helpers:**
  - `src/utils/responsibilities.ts`: owner user/group lookups (now done in chunks) and the direct/inherited grouping, which `get_asset_by_id` and `get_asset_responsibilities` had copied almost line for line
  - `src/utils/assessments.ts`: `ASSESSMENTS_BASE`, which had 10 copies, and JSON-argument parsing, which had 4
  - `usageSession()` in `src/utils/usage-analytics.ts`: the setup code shared by the three usage tools
- **`update_asset_description` / `bulk_update_asset_descriptions`** now run through the same shared code as the attribute update tools. As a result:
  - Markdown in a Description is now converted to HTML, since Description is a rich-text attribute
  - every existing value is covered, not just the first
- Net source size: about 1,000 fewer lines (17,395 → 16,380).

## Unreleased — Read-tool fixes (Review plan, Phase 2)

### Fixed
- **`find_workflow_tasks`: the user and business-item filters returned every task.** The tool sent `businessItemIds`/`userIds`, which the API ignores. The parameter names are now `businessItemId`/`userId`. `businessItemId` also has no effect unless `businessItemType` is sent with it, so the tool now adds it (`business_item_type`, default `ASSET`). Verified live: the filter now returns 1 task where it used to return all 20. Task fields are now read by their real names: `createTime`, `owner`, `candidateUsers`, `formKeyAvailable` and `inError`.
- **`find_users`: `only_enabled` had no effect.** The parameter it sent (`onlyEnabledUsers`) doesn't exist. `only_enabled=false` now sends `includeDisabled=true`. On Production that returns 62 users instead of 24.
- **`get_asset_view_stats`: every `assetId` and URL was null.** The tool read `asset.id`, but the API returns `assetId`.
- **`get_activities`: `context` and `onResource` were always null.** Activities don't have those fields; the resource an activity concerns is stored as JSON inside `description`. That JSON is now parsed, so `onResource` holds `{ id, name, typeCode }`.
- **`find_comments`** no longer returns a `user` field that was always null. It now returns `mentionedUsers`.
- **`start_workflow_instance`** no longer sends `businessItemId` to `startFormData`, which ignored it.
- **`find_ratings`: `averageRating` only covered the current page.** It now covers every rating on the asset, and a new `ratingCount` field shows how many.
- **Semantics tools:**
  - `get_column_semantics` no longer lists the column as one of its own business terms.
  - `get_measure_data` no longer lists the measure as one of its own columns.
  - The four semantics tools share one `fetchRelations` (`src/utils/relations.ts`) instead of four copies. Errors now surface instead of looking like "no data", and results are paginated.
  - Requests that fan out per column or per data attribute are now capped at 8 at a time; before, a wide table could fire hundreds of requests at once.
- **`get_asset_by_id`:**
  - multi-value attributes are now returned
  - it says when attribute lists are cut off at 100
  - the assignable schema now comes from the assignment that applies to the asset's domain
- **`get_asset_relations`:**
  - each relation now includes its `id`, so results can be passed straight to `bulk_delete_relations`
  - `next_offset` is null when there are no more relations
- **Paging:**
  - `get_domains`, `get_communities` and `get_attribute_types` now accept `offset` and return `nextOffset`
  - `get_domain_types` and `get_asset_statuses` now return every page instead of stopping at 200 / 500
- **`get_communities`:** with a name filter, a matching child whose parent didn't match used to vanish from the hierarchy. It is now shown as a top-level entry.
- **`find_traversal_path`:**
  - `max_depth` was off by one, so paths could be one step longer than allowed
  - the path search is now capped, and the result warns if it stopped early
- **`search_catalog_columns`** filters related assets by type on the server. Previously it fetched the first 20 relations of any type and filtered afterwards, so relevant ones could be missed.
- **`prepare_create_asset` / `prepare_add_business_term`:**
  - an exact name match is now chosen even when other names also contain the search text (for example, "Table" no longer comes back as `needs_clarification`)
  - `prepare_add_business_term` now suggests the attributes Business Term can actually have in the chosen domain, instead of the first 50 attribute types in the whole system
- **API fields could overwrite tool fields.** Lineage and assessment tools added the raw API response after their own fields (such as `instance` and `entityId`), so the API could replace them. The tool's fields now always win.
- **Follow-up suggestions (`nextActions`):**
  - fixed suggestions that used the wrong argument names
  - fixed one that suggested a tool that doesn't do what it described
  - suggestions no longer point at the deprecated `update_assessment`
  - `test/next-actions.test.ts` now checks every suggestion against the target tool's schema
- `plan_write_operation`'s rule for single-item writes no longer contradicts its own recommendations.

### Tests
- `test/read-tools.test.ts`: parameter and field-mapping regressions. All 9 tests fail against the previous code.
- `test/next-actions.test.ts`

## Unreleased — Platform fixes (Review plan, Phase 1)

### Fixed
- **Failed calls are now reported as errors.** Most tools reported a failure as an ordinary result, so clients and agents could not tell a failed call from a successful one. The server now sets MCP `isError: true` whenever a tool's result describes a failure. Writes that were partly applied are marked `status: "partial"` and are not flagged as errors, so an agent can see what was applied and doesn't blindly retry. `failureMessage()` in `src/utils/tool-result.ts` decides this, and the audit log uses the same check.
- **Tool arguments are now checked against each tool's schema** (`src/utils/validation.ts`). The checks happen before anything is sent to Collibra:
  - wrong types are coerced (`"25"` → `25`)
  - schema defaults are applied
  - enum values and required arguments are enforced

  The server also adds two kinds of limits to every tool's schema, and these show up in `tools/list` too:
  - every `limit` must be between 1 and 1000, and `offset` must be 0 or more
  - Core REST id parameters must be UUIDs

  Invalid input returns a readable error such as `asset_id must be a UUID` or `limit must be <= 1000`.
- **GraphQL injection.** `query_assets`, `get_asset_by_id`, `get_asset_relations` and `get_api_catalog` pasted user input into the query text, so a quote in an asset type name could change the query. All user input is now passed as GraphQL variables.
- **Aliases no longer bypass `disabledTools`.** Previously, disabling a tool left its alias listed and callable. Now:
  - denylisting either the tool or its alias disables both
  - allowlisting either one enables both
- **`get_api_catalog`** always failed because the nested query asked for 86 million nodes, against Collibra's limit of 100,000. It now fetches the catalog in stages that each stay within that limit, and relations are filtered by role on the server. Two smaller fixes: the name filter used a field that doesn't exist on assets, and `include_operations=false` now actually skips fetching operations.
- **Clearer Collibra errors.** Errors now:
  - keep the HTTP status, so a 404 can be told apart from a 403
  - include Collibra's `userMessage`
  - explain HTML responses instead of failing with `Unexpected token '<'` (seen in Usage Analytics on older versions)
- User-derived values placed in REST paths are now URL-encoded at the remaining ~17 places that weren't.

### Changed
- **Shared lookups now actually get reused.** Relation-type and attribute-type lookups are shared by all clients of an instance and refresh after 10 minutes. Previously each tool call started with empty caches. Creating a relation type or attribute type clears them.
- **`query_assets`** summary pages now default to 500 rows instead of 5000; a full 5000-row page was about 100K characters.
- **HTTP mode** only accepts requests addressed to localhost (`Host`/`Origin` headers), which blocks DNS-rebinding attacks from a web page. Other changes:
  - optional `http.token` requires an `Authorization: Bearer …` header
  - an invalid JSON body returns 400 instead of 500
- **Server instructions** no longer say that every tool needs `instance_name`, and they explain `isError`.
- **Dependencies:** removed the unused `js-yaml`, and `npm audit fix` cleared 9 vulnerabilities in indirect dependencies, now 0. Star Wars API calls time out after 15 seconds.
- **Cleanup:**
  - removed dead code: the unused GraphQL types, `graphqlQueryPaginated`, and three copies of the UUID regex
  - removed unused imports
  - `tsconfig` now sets `noUnusedLocals` so unused code fails the build
  - `.gitignore`: `dcat*` is anchored to the repository root

### Tests
- `test/platform.test.ts` covers:
  - argument validation and the added schema limits
  - `failureMessage`
  - alias toggles in both allowlist and denylist modes
  - GraphQL variables
  - descriptive HTTP errors

## Unreleased — Write-integrity fixes (Review plan, Phase 0)

### Fixed
- **Relation writes acted on the wrong relation type.** `GET /rest/2.0/relations` ignores `typeId` and only filters on `relationTypeId`. Because of this:
  - `edit_asset` `remove_relation` deleted the first relation of *any* type between the two assets.
  - `add_relation`, `create_relation` and `bulk_create_relations` skipped creation whenever a relation of a different type already linked the same assets.

  All four now match the exact (source, target, type) triple through the shared `findRelation` helper (`src/utils/relations.ts`).
- **`edit_asset` `add_tag`** sent a bare array, but the API requires `{ tagNames: [...] }`.
- **`edit_asset` `set_responsibility`** omitted the required `resourceType`, so every assignment failed with a 400.
- **Role, user and group names are no longer guessed.** Previously a lookup with no exact match fell back to the first "contains" hit, so a responsibility could be assigned to the wrong role or person. Lookups now need an exact name and return suggestions on a miss (`src/utils/resolve.ts`). A UUID that doesn't exist is reported instead of being used blindly.
- **Relation role labels** in `create_relation` and the `bulk_delete_relations` preview were always empty. Labels now come from the relation-type map, since relation payloads only embed the type id.
- **Attribute updates covered only the first value.** `update_asset_attribute`, `bulk_update_asset_attributes` and `edit_asset` `update_attribute` now set the attribute to exactly the given value(s), and multi-value attributes are fully replaced. Input is coerced by kind:
  - DATE (ISO date or epoch milliseconds → epoch milliseconds)
  - NUMERIC
  - BOOLEAN
  - MULTI_VALUE_LIST (comma-separated)
  - RICH_TEXT (Markdown → HTML)

  Invalid values are rejected rather than written. This logic is shared in `src/utils/attributes.ts`.
- **`bulk_create_assets`** now:
  - enforces required attributes, as `create_asset` already did
  - skips duplicate (domain, name) entries within one request
  - validates attribute values
  - blocks the whole batch if any entry is invalid, so nothing is half-created
- **Required-attribute checks follow assignment scope.** `create_asset` and `bulk_create_assets` previously merged every assignment of the asset type, enforcing requirements from scopes that don't apply to the target domain. They now use the single applicable assignment, chosen by domain type and then by domain or community scope (`fetchApplicableAssignment`).
- **Duplicate checks no longer return the wrong object as success.** `create_domain` (different type), `create_asset_type` (different parent), `create_attribute_type` (different kind) and `add_mapping` (mapped to a different resource) now return `status: "conflict"`.
- **Lookup errors are no longer treated as "not found".** A 403 or 500 used to look like a missing object. Now only a real 404 counts:
  - `bulk_delete_assets` / `bulk_delete_relations` stop instead of silently skipping
  - `add_mapping` no longer POSTs blindly
  - `assign_attribute_to_asset_type` no longer reports "not found"

  `CollibraHttpError` carries the HTTP status so callers can tell these cases apart.
- Data-contract multipart bodies use a random boundary and reject header injection. `push_data_contract_manifest` sends `force`/`active` explicitly, so `false` is honoured. Push and init now share one builder (`src/utils/multipart.ts`).

### Changed
- **`assign_attribute_to_asset_type` now previews by default.** Pass `confirm: true` to apply, matching every other write tool. `dry_run: true` still forces a preview. `maximum_occurrences: null` now means no upper limit.
- `edit_asset` validates `asset_id` and relation ids as UUIDs and URL-encodes path segments.

### Tests
- `test/write-integrity.test.ts`: a mock Collibra server that reproduces the real API quirks and asserts the exact query parameters and bodies sent.
- `test/multipart.test.ts`
- Verified live on Sandbox and Production with a self-cleaning scratch community (20/20 checks on each).

## Unreleased — Platform Hygiene (Roadmap Tier A, batch 1)

### Added
- **Pluggable, OAuth-free auth layer** (`src/utils/auth.ts`) for FedRAMP and self-hosted (CPSH) customers, who can't use OAuth. Each instance sets `auth.type`:
  - `basic` (default)
  - `session`: REST session login with cookie + CSRF, shared across concurrent calls, with automatic re-login on 401/403
- **TLS options** per instance: `tls.caFile` (custom or agency CA), `tls.clientCertFile` / `tls.clientKeyFile` / `tls.clientKeyPassphrase` (mutual TLS). TLS 1.2 is the minimum. Invalid `auth.type` values or mismatched cert/key pairs fail at startup.
- **Secret references in config** (`src/utils/secrets.ts`): any value can be `${env:NAME}`, `${file:/path}` or `${keychain:target}` (Windows Credential Manager, macOS Keychain, Linux libsecret), so passwords no longer need to be stored in plaintext. Startup warns about instances that still use a plaintext password. Instance passwords are masked in all tool output and errors.
- **Tamper-evident audit trail** (`src/utils/audit.ts`): hash-chained (SHA-256) JSONL with rotation, aligned with NIST 800-53 AU-2/3/9/11. Enable it with `"audit": {"enabled": true}`. It records every write (preview or applied), optionally reads, with user, instance, masked arguments, outcome and timing.
- **`get_audit_log`** (read): browse and filter the audit trail, and verify the hash chain.
- **`undo_write`** (write, preview/confirm): revert an applied write from its pre-write snapshot. It restores attribute values and asset properties for the update/edit tools, and deletes assets made by the create tools.
- **`complianceMode: "fedramp"`** (`src/utils/compliance.ts`): startup refuses to run, listing every violation, unless:
  - instances use https with verified TLS
  - passwords are secret references
  - external sources are off

  Compliance mode forces the audit trail on, checks FIPS mode (`requireFips: true` makes a non-FIPS runtime fatal), and reports the posture in `get_instances` under `security`.
- 99 canonical tools + 3 aliases. Write tools: 32.
- **MCP tool annotations on every tool.** Each tool now has `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, matching chip. Hints come from one table (`src/tools/annotations.ts`), which is also now the single source of the read-only write-tool list. Chip aliases inherit their canonical tool's hints.
- **Test harness:** vitest (`npm test`) with registry tests. They check for unique names, valid input schemas, an executor per tool, and annotations set on every tool (the equivalent of chip's `TestRegisterAll_AllToolsHaveProperAnnotations`). They also cover read-only mode and the external-source opt-in. Fixtures are in `test/fixtures/`, so no real credentials are needed.
- **CI:** a GitHub Actions workflow (`.github/workflows/ci.yml`) runs build and test on Node 22.
- `npm run typecheck` script.

### Changed
- **MCP SDK upgraded from 1.27 to 1.32.** The server now negotiates protocol `2025-11-25` and declares the `logging` capability.
- `serverInfo` reports the real package name and version, plus a `title`. It was previously hardcoded to `1.0.0`.
- **The Star Wars external source is now opt-in** (`externalSources.starWars.enabled: true`). This avoids unexpected calls to a public internet API in FedRAMP and restricted-egress deployments. When the source is disabled, `search_star_wars` is not advertised.
- `@types/node` bumped to 22 to match the Node 22 runtime.

### Fixed
- `init_data_contract`, `push_data_contract_manifest`, `pull_data_contract_manifest` and `remove_data_classification_match` built their own Basic auth and **ignored the instance's TLS settings**, so they failed against self-signed or custom-CA instances. All four now go through the shared auth layer.
- Config validation errors no longer echo the instance password.
- Credentials are now only ever sent to the configured instance's own origin. Any authenticated request to another host, or with userinfo tricks in the URL, is refused.
- A config that fails validation is no longer cached as if it were valid, and startup now fails cleanly (`✗ Failed to load configuration`) instead of with an uncaught stack trace.
- Lineage tools now return an actionable explanation when the lineage service rejects the user mapping (401 "Unauthorized User Token") instead of a bare `401 Unauthorized`. Diagnosis on a 2026.10 tenant: Basic and session auth both get this response, and Collibra's hosted MCP fails the same way. The cause is lineage provisioning on the instance, not credentials, so the message points admins at the actual fix.

## Unreleased — Usage Analytics

Three read-only tools for Collibra's **Usage Analytics** app data (`/apps/usage-analytics`), so agents can answer "what's being used, by whom, and how is adoption trending?" for any date range. 97 canonical tools + 3 aliases.

### Added
- **`get_content_usage`**: visits to assets, domains, communities, dashboards and diagrams. Views:
  - `summary`: totals per type, plus % change vs. the previous period.
  - `trend`: visits per Day/Week/Month/Quarter bucket.
  - `top`: most visited items. Top assets include asset type, domain and community.
  - `filters`: valid filter values.
- **`get_user_usage`**: user adoption. Views:
  - `summary`: Active/Inactive/New counts, plus % change vs. the previous period.
  - `top`: most active users.
  - `usage_rate`: High/Medium/Low users per bucket.
  - `retention`: Acquired/Retained/Returning users per bucket.
  - `license_types`: users per license type per bucket.
- **`get_asset_usage`**: usage for one asset, looked up by UUID or exact name:
  - All-time visits, unique visitors and first visit date.
  - Visit trend over the date range.
  - Top visitors, with names resolved.
- All three tools share these options:
  - `start_date` / `end_date` (default: the 30 days ending yesterday) and `granularity` (`Day`/`Week`/`Month`).
  - `exclude_admin` / `exclude_disabled_users`.
  - Filters by user group, role, license type, community/domain and asset type. Names are resolved to IDs automatically.
  - Every response includes `lastRefreshed`.
- **`CollibraClient.sessionRestCall`**: GET with session auth (cookie + `X-CSRF-TOKEN` from `POST /rest/2.0/auth/sessions`). It logs in when first needed, reuses the session, and logs in again on 401/403. This is needed because the internal Usage Analytics APIs (`/rest/usageAnalyticsUsage/v1`, `/rest/usageAnalyticsUsers/v1`) reject Basic auth.
- `scripts/smoke-usage-analytics.mjs`: end-to-end check of every view against a live instance.

### Notes
- These APIs are undocumented and may change between Collibra releases. They need Usage Analytics enabled and Insights permission.
- `get_asset_view_stats` is unchanged (all-time navigation stats). Its description now points to the new tools for time-bounded questions.

## 9.3.0 — Chip Parity Phase C: Workflows, Comments, Activities, Skills, HTTP Transport & More

The largest single expansion of the tool surface: 23 new tools (94 canonical + 3 aliases), Markdown→HTML for rich-text writes, cursor pagination, an embedded skills catalog, context specifications (Semantic Blueprint), a streamable-HTTP transport, and optional output-schema validation. Excludes Collibra AI (`discover_*`) tools by design.

### Added

#### Catalog Metadata Search (Read)
- **`search_catalog_columns`** — find Column assets by metadata keyword search can't filter on: Description / Data Type attribute values, a Data Steward assignment, or a relation to a Business Term / Business Rule / Data Element / Data Attribute (by name); AND-combined into a single Knowledge Graph GraphQL query; direction-agnostic relation matching via `_or`

#### Typed Assessment Editing (Write)
- **`edit_assessment`** — edit a conducted assessment via typed operations applied as ONE atomic PATCH: `set_answer` (by `questionId`; answer type inferred from the existing answer or supplied via `answer_type`; ITEMS via `items`), `set_status`, `set_name`, `set_owner`, `set_assignees`, `set_visibility`; answers are merged into current content so untouched questions are preserved; two-step preview/confirm; resolves the assessment by UUID or exact name (ambiguity returns candidates)
- **`update_assessment`** is now marked DEPRECATED in favor of `edit_assessment`

#### Workflows (2 Read + 2 Write)
- **`find_workflow_definitions`** — list deployed workflow definitions (name filter, pagination)
- **`find_workflow_tasks`** — list open workflow tasks (filter by title, business item, or user)
- **`start_workflow_instance`** *(write)* — start a workflow against assets/domains/communities; resolves the definition by UUID or exact name; the preview surfaces the start-form fields so required `form_properties` can be filled in; explicit warning that workflows can create tasks/notifications for real users
- **`complete_workflow_task`** *(write)* — complete a task; the preview surfaces the task-form fields (e.g. approve/reject decisions)

#### Collaboration & Audit (Read + Write)
- **`find_comments`** — comments on any resource (filter by resource, author, parent/replies, root-only, resolved)
- **`add_comment`** *(write)* — comment on an asset/domain/community or reply to a comment; Markdown auto-converted to HTML
- **`get_activities`** — the audit trail: filter by resource, user, categories, resource kinds, and ISO date range
- **`find_ratings`** — user ratings + reviews per asset (with computed average)
- **`get_asset_view_stats`** — most-viewed / recently-viewed assets (navigation statistics)

#### Tags, Mappings, Users & Complex Relations (Read + Write)
- **`find_tags`** — list tags, optionally with the assets carrying each tag (`include_assets`)
- **`find_mappings`** / **`add_mapping`** *(write, idempotent)* / **`remove_mapping`** *(write, preview/confirm)* — external-system mappings for idempotent integrations and cross-instance migration provenance
- **`find_users`** — resolve users by name fragment across username/first/last/email (feeds `set_responsibility`, `set_owner`, `set_assignees`, `performed_by_user_id`)
- **`find_complex_relations`** — multi-leg relations with legs and attributes, filtered by asset or type public IDs

#### Output Module (Read)
- **`export_output_module`** — run a raw TableViewConfig/ViewConfig JSON query via `POST /outputModule/export/json` and return results inline; optional server-side syntax validation (`validate=true`)

#### Skills Catalog
- **`list_collibra_skills`** / **`load_collibra_skill`** — embedded Markdown workflow guides (chip-style layout `skills/<namespace>/<name>/SKILL.md`) shipping with 4 starter skills: `collibra/operating-model`, `collibra/cross-instance-migration`, `collibra/assessments`, `collibra/discovery-lineage`; external skills dir via `skillsDir` config or `COLLIBRA_MCP_SKILLS_DIR` (same-name external skills fully replace embedded ones)

#### Context Specifications (Semantic Blueprint)
- **`list_context_specifications`** / **`get_context_specification`** — browse Context Specifications (`/rest/semanticBlueprint/v1/contextSpecifications`), including the full mapping YAML
- **`get_asset_by_id`** gained `context_specification_id` — also generates the asset's structured YAML context via `POST /rest/contextEngine/v1/contexts/generate`

#### Transport & Validation
- **Streamable HTTP transport** — run with `--http[=port]`, `COLLIBRA_MCP_HTTP_PORT`, or `"http": {"enabled": true, "port": 3399}`; stateless (one Server per request), binds to localhost only; stdio remains the default
- **`validateOutput` config flag** — when true, every tool's `structuredContent` is validated against its `outputSchema` (ajv, warn-only to stderr)

### Changed
- **Markdown → HTML for RICH_TEXT attributes** — `create_asset`, `bulk_create_assets`, `add_business_term`, and `edit_asset` now detect Markdown values targeting RICH_TEXT string attribute types and convert them to HTML (via `marked`); already-HTML values and plain prose pass through unchanged; new `src/utils/markdown.ts` + attribute-type cache on `CollibraClient`
- **Cursor pagination** — `restPaginate()` now transparently uses cursor pagination (`cursor`/`nextCursor`) for the endpoints where Collibra deprecated `offset` (`/assets`, `/attributes`, `/communities`, `/domains`, `/complexRelations`), with automatic offset fallback for older instances
- **`get_asset_by_id`** gained `include_breadcrumb` (community/domain path via `/assets/{id}/breadcrumb`)
- Server `instructions` now point the agent at `list_collibra_skills`
- Tool count 71 → **94** canonical (+3 chip aliases = 97 advertised); write tools 25 → **31**; read-only mode exposes **63** canonical tools
- Version bumped to **9.3.0**

### Notes
- Collibra AI tools (`discover_business_glossary`, `discover_data_assets`) intentionally NOT implemented (3rd-party AI / consumes Collibra Units)
- New write tools (`edit_assessment`, `start_workflow_instance`, `complete_workflow_task`, `add_comment`, `add_mapping`, `remove_mapping`) are hidden in read-only mode
- Credential-free smoke test: `node scripts/smoke-phase-c.mjs` (registration, schemas, markdown util, skills catalog); HTTP transport verified with a live initialize + tools/list round trip

---

## 9.2.0 — Chip Parity: Data Contract Init, Richer edit_asset, Create Guards & Tool Toggles

Brings the server to read/write parity-plus with Collibra's official [`chip`](https://github.com/collibra/chip) MCP server (Phases A + B).

### Added

#### Data Contracts (Write)
- **`init_data_contract`** *(write)* — initialize a new data contract asset governing a Data Product Port (`POST /rest/dataProduct/v1/dataContracts`, multipart); the first step in creating a contract. Provide a manifest to upload, or omit it to auto-generate from the governed port's metadata. Idempotent by governed port. Optional `manifest_id`, `version`, `name`, `domain_id`. Requires the `dgc.data-contract` permission.

#### Compound Edit — new `edit_asset` operations (Write)
- **`add_tag`** — append a free-text tag without replacing existing tags (idempotent)
- **`set_responsibility`** — assign a user or group to a resource role (e.g. Steward, Owner) by username, email, or UUID (idempotent); role and owner are resolved server-side
- **`remove_responsibility`** — unassign a directly-assigned responsibility (inherited ones are not affected)

#### Per-Tool Enable/Disable
- New optional `enabledTools` (allowlist) and `disabledTools` (denylist) config keys, plus `COLLIBRA_ENABLED_TOOLS` / `COLLIBRA_DISABLED_TOOLS` environment-variable overrides (comma-separated). The allowlist takes precedence; toggles apply on top of `readOnly` and are enforced both in the advertised tool list and at execution time.

#### Chip-Compatible Aliases
- Added additive aliases matching the official `chip` tool names — `list_asset_types` → `get_asset_types`, `search_asset_keyword` → `search_assets_by_name`, `get_asset_details` → `get_asset_by_id` — so prompts/clients built against `chip` work unchanged. Canonical names remain primary.

### Changed
- **`create_asset`** now enforces required attributes from the asset type's own assignment (rejects with the list of missing attributes before creating anything) and gates on duplicate name via a new `allow_duplicate` flag (default `false`, blocking a same-name asset in the same domain + type).
- **`get_asset_by_id`** gained an `include_assignable_schema` option that returns the asset type's full assignable schema — every attribute it can hold (including empty ones), each flagged `required`/`populated`, plus assignable relation types and eligible statuses.
- Permission (HTTP 403) errors from the REST client now return a clearer message indicating a likely missing Collibra permission / DGC scope.
- Added `Requires: dgc.*` scope hints to the classification and data-contract tool descriptions.
- Tool count increased from 70 to **71** (advertised = executable), plus **3** chip-compatible aliases; write tools now **25**; read-only tools (when `"readOnly": true`) remain **46**.
- `edit_asset` `outputSchema` tightened to document PREVIEW vs. APPLIED shapes.
- Version bumped to **9.2.0**.

### Notes
- `init_data_contract`, and the `add_tag` / `set_responsibility` / `remove_responsibility` apply paths on `edit_asset`, are write tools hidden in read-only mode.
- A credential-free smoke test (`scripts/smoke-chip-parity.mjs`) validates the new tool registry surface (registration, schemas, and aliases).

---

## 9.1.0 — Multi-API Federation, Attribute-Type Tools & Registration Fix

### Added

#### Multi-Source Federation (Read-Only)
- **`search_subject`** — federated search that fans a single query across **every configured Collibra instance AND the public Star Wars API** in one call; results are grouped by source and tagged `collibra` or `starwars`; each source is queried independently so a failure in one never blocks the others
- **`search_star_wars`** — search the public [Star Wars API](https://www.swapi.tech) (people, planets, starships, vehicles, species, films) directly; no API key required; demonstrates that the server is a federation layer that can front non-Collibra REST APIs
- New optional `externalSources.starWars` block in `config.json` (enabled by default) and a `SwapiClient` util (`src/utils/swapi-client.ts`) that mirrors the `CollibraClient` shape so external and Collibra sources are treated uniformly

#### Operating Model Management (Write)
- **`create_attribute_type`** *(write)* — create an attribute type (characteristic) in the operating model (`POST /rest/2.0/attributeTypes`); supports `STRING`, `SINGLE_VALUE_LIST`, `MULTI_VALUE_LIST`, `NUMERIC`, `DATE`, `BOOLEAN`, `SCRIPT` kinds; idempotent
- **`assign_attribute_to_asset_type`** *(write)* — assign an existing attribute type to an asset type so its assets can carry the attribute; merges into all existing assignments while preserving current attributes/relations/statuses; idempotent; `dry_run` preview supported

### Fixed
- **`create_asset` and `add_business_term` were callable but unregistered.** Both tools were present in the executor map but missing from the advertised `allTools` list *and* from `WRITE_TOOL_NAMES`, so they never appeared in the tool list yet could still be invoked even in read-only mode. They are now registered in the tool list and guarded by read-only mode like every other write tool.

### Changed
- Genericized the `get_api_catalog` tool description and docs: removed the internal "Army REST API" wording and the `setupArmyRestApiModel.mjs` prerequisite in favor of neutral "REST API operating model" language
- Tool count corrected to **70** (advertised = executable); write tools now **24**; read-only tools (when `"readOnly": true`) now **46**
- `scripts/` is now git-ignored (development/provisioning helpers are no longer published)

---

## 9.0.0 — Operating Model Intelligence, Bulk Operations & Compound Edit

### Added

#### Operating Model Intelligence (Read-Only)
- **`refresh_operating_model`** — crawl a Collibra instance and persist a portable snapshot (asset types, domain types, attribute types, relation types, statuses) to a local cache; cached once per session (configurable via `max_age_hours`); pass `force=true` to re-crawl immediately; returns counts and a snapshot hash for verification
- **`get_operating_model_summary`** — return a compact, AI-friendly digest of the cached operating model: top-level asset type families by size, attribute-type kind distribution, status names, domain types, and relation type count; ideal for cheap context priming at the start of a conversation
- **`describe_asset_type`** — full description of a specific asset type from the cache: parent/sub types, assignable attribute types (with kind and description), assignable relation types (with direction and the other type), and eligible statuses; resolve by name or UUID
- **`describe_domain_type`** — describe a domain type from the cache including a heuristic list of asset types whose name family overlaps with it; useful for picking the right domain when creating assets
- **`resolve_model_term`** — fuzzy-resolve a free-text term against all elements in the cached model (asset types, domain types, attribute types, relation types, statuses); returns ranked candidates with UUIDs per category; customer-agnostic
- **`plan_asset_creation`** — pure-logic planning tool: resolves an asset type and target domain by name or UUID, lists assignable attribute types, recommends an initial status, and emits a `nextAction` pointing at `prepare_create_asset` / `create_asset` with resolved UUIDs; makes no API calls when reading from cache
- **`find_traversal_path`** — given a source and target asset type (by name or UUID), returns the shortest sequence of relation types that connects them in the cached model; each step shows direction, role label, and relation type UUID; use this to plan efficient graph traversals without guessing relation chains
- **`validate_against_model`** *(read-only)* — pre-flight a proposed write (asset, relation, or attribute) against the cached model and return violations before any API call is made; validates type existence, status IDs, attribute type IDs, and relation source/target type compatibility

#### Bulk Operations (Write)
- **`bulk_create_assets`** *(write)* — create multiple assets in a single `POST /rest/2.0/assets/bulk` + optional `POST /rest/2.0/attributes/bulk` call; supports mixed asset types and domains in one batch; two-step preview/confirm; detects existing `(domain_id, name)` pairs and skips them by default (`skip_existing=true`)
- **`bulk_create_relations`** *(write)* — create multiple typed relations in a single `POST /rest/2.0/relations/bulk` call; idempotent (existing `(source, target, type)` triples are detected in preview and skipped on apply); two-step preview/confirm
- **`bulk_delete_assets`** *(write)* — permanently delete multiple assets in a single `DELETE /rest/2.0/assets/bulk` call; DESTRUCTIVE (attributes, relations, attachments, and comments are all removed); two-step preview shows asset name, type, domain, and URL before applying
- **`bulk_delete_relations`** *(write)* — permanently delete multiple relations in a single `DELETE /rest/2.0/relations/bulk` call; two-step preview shows source asset, target asset, and relation type before applying

#### Compound Edit (Write)
- **`edit_asset`** *(write)* — apply a list of typed edits to a single asset in one tool call; supported ops: `update_attribute`, `add_attribute`, `remove_attribute`, `update_property` (name/displayName/statusId), `add_relation`, `remove_relation`; attribute changes batched via `/attributes/bulk`, relation changes batched via `/relations/bulk`; two-step preview shows current vs. proposed values for every op; replaces what would otherwise require many singleton calls

#### Write Advisor (Read-Only)
- **`plan_write_operation`** — pure-logic decision helper: given the kind of work and the number of items, returns the recommended tool (single vs. bulk vs. `edit_asset`) with rationale; makes no API calls; call this before write work when in doubt about which tool to use

### Changed
- Tool count increased from 52 to **66**; write tool count increased from 17 to **22**
- `WRITE_TOOL_NAMES` guard in `src/tools/index.ts` updated to cover all five new write tools (`bulk_create_assets`, `bulk_create_relations`, `bulk_delete_assets`, `bulk_delete_relations`, `edit_asset`)
- Read-only tool count (when `"readOnly": true`) increased from 35 to **44**

### Notes
- All model-intelligence tools require `refresh_operating_model` to have been run first for the target instance; they read from the local cache and make no live API calls (except `describe_asset_type`, which fetches per-type assignment data on-demand from the live instance)
- `bulk_delete_assets` and `bulk_delete_relations` are write tools hidden in read-only mode; they require explicit `confirm=true` and are intentionally placed behind the two-step safety pattern

---

## 8.1.0 — Structured Tool Output (MCP `structuredContent` + `outputSchema`)

### Added
- Every tool now declares an `outputSchema` and returns MCP **`structuredContent`** alongside the existing human-readable text payload. Structured-aware clients can parse responses directly without re-parsing the text block; text-only clients continue to work exactly as before.
- New `ToolResult` type (`src/types.ts`) and `ok` / `okPretty` helpers (`src/utils/tool-result.ts`) standardize how tools return both shapes.
- 5 reference tools (`get_asset_types`, `query_assets`, `search_assets_by_name`, `get_asset_by_id`, `update_asset_description`) ship rich, hand-authored output schemas describing their exact response shape. The remaining 47 tools ship a permissive schema (`type: object, additionalProperties: true`) that can be tightened incrementally.

### Changed
- `executeTool` (`src/tools/index.ts`) now returns `ToolResult` and normalizes legacy string returns.
- Server (`src/index.ts`) attaches `response.structuredContent` whenever a tool provides one, while keeping the existing `content[0].text` (including the configurable safety warning footer) intact.

### Notes
- Fully backward-compatible. No tool inputs changed, no behavior changed for clients that only consume `content[0].text`.

---

## 8.0.0 — Operating Model Management & API Catalog

### Added

#### Discovery
- **`get_domain_types`** — list all domain types and their UUIDs (Glossary, Physical Data Dictionary, Report Catalog, Data Product Catalog, etc.); use before `create_domain` to find the correct `type_id`
- **`get_asset_statuses`** — list all workflow statuses and their UUIDs (Candidate, Accepted, Deprecated, etc.); use before `create_asset` to map status names to UUIDs across instances

#### API Catalog Traversal
- **`get_api_catalog`** — traverse the REST API catalog hierarchy: **REST API → REST API Version → REST API Endpoint → REST API Operation**; filter by API name, toggle operation detail with `include_operations`, and paginate with `limit`; designed for instances with the REST API operating model configured

#### Operating Model Management (Write)
- **`create_community`** *(write)* — create a top-level community or sub-community; idempotent (returns existing if name matches under same parent)
- **`create_domain`** *(write)* — create a domain inside a community with a specified domain type; idempotent
- **`create_relation`** *(write)* — create a typed relationship between two assets; idempotent
- **`create_asset_type`** *(write)* — create an asset type in the operating model with optional parent, color, and symbol; idempotent
- **`create_relation_type`** *(write)* — create a relation type (role + co-role) between two asset types; idempotent

### Changed
- Tool count increased from 44 to **52**; write tool count increased from 12 to **17**
- All five Operating Model Management write tools are hidden when `"readOnly": true` is set in config

---

## 7.0.0 — Collibra Assessments API Integration

### Added

#### Assessments (Read)
- **`list_assessments`** — list assessments with filtering by `assetId`, `status` (DRAFT/SUBMITTED/OBSOLETE), `templateId`, `templateVersion`, `name`, and date range; cursor-based pagination; sorted by `lastModifiedOn` descending
- **`get_assessment`** — retrieve full assessment details including all Q&A content (questions, answers, comments), owner, assignees, visibility, linked asset, submitted timestamps, and the associated Assessment Review asset ID
- **`get_assessment_by_review`** — reverse lookup: find an assessment by its Collibra Assessment Review asset UUID
- **`list_assessment_templates`** — browse available assessment templates with filtering by `name`, `status`, `assetTypeId`, and `latestVersionOnly`; cursor-based pagination
- **`get_assessment_template`** — retrieve full template details: version, status, linked assetType, notification setting, and `retakePermission` policy (All / Owner / OwnerAndAssignees)
- **`list_assessment_attachments`** — list file attachments for an assessment (IDs, filenames, upload metadata)

#### Assessments (Write)
- **`create_assessment`** *(write)* — create a new assessment from a template, optionally linked to a Collibra asset (e.g., AI Use Case); supports initial Q&A content, owner, assignees, and visibility settings
- **`update_assessment`** *(write)* — update any combination of status, name, owner, assignees, visibility, and Q&A content on an existing assessment; commonly used to submit a draft (status → SUBMITTED)
- **`retake_assessment`** *(write)* — start a new revision of a submitted assessment; the new assessment references the original via `originAssessment`

### Changed
- Tool count increased from 35 to **44**; write tool count increased from 9 to **12**
- Assessments API calls target the separate `/rest/assessments/v2` base path (distinct from `/rest/2.0`)
- All three write tools (`create_assessment`, `update_assessment`, `retake_assessment`) are hidden from the AI when `"readOnly": true` is set in config

### Notes
- `content` and `assignees` fields on create/update tools accept raw JSON strings for maximum flexibility across all answer types (TEXT, HTML, DATE, BOOLEAN, ITEMS, NUMBER, EXPRESSION, ASSETS, USERORGROUPS, ATTACHMENTS)
- Attachment upload/download excluded — binary data is incompatible with MCP text transport
- `delete_assessment` excluded — destructive with no recovery path

---

## 6.0.0 — Asset Creation, Data Classification, Data Contracts & More

### Added

#### Asset & Business Term Creation
- **`prepare_create_asset`** — pre-flight check before creating an asset: resolves asset type and domain by name or UUID, detects duplicates, returns a `ready` / `incomplete` / `needs_clarification` / `duplicate_found` status
- **`create_asset`** *(write)* — create any Collibra asset with optional attribute values; returns the new asset URL
- **`prepare_add_business_term`** — pre-flight check before adding a business term: resolves the glossary domain, detects duplicates, hydrates the attribute schema
- **`add_business_term`** *(write)* — create a Business Term in any Glossary domain with optional definition and extra attributes

#### Data Classification
- **`search_data_class`** — search Collibra data classes from the Classification service (filter by name, description, rule presence)
- **`add_data_classification_match`** *(write)* — associate a data class with a Collibra asset
- **`search_data_classification_match`** — search classification matches by asset ID, status (`ACCEPTED` / `REJECTED` / `SUGGESTED`), classification ID, or asset type
- **`remove_data_classification_match`** *(write)* — remove a classification match with two-step preview/confirm safety

#### Data Contracts
- **`list_data_contract`** — list data contracts with cursor-based pagination and optional manifest ID filter
- **`pull_data_contract_manifest`** — download the active YAML manifest for a data contract
- **`push_data_contract_manifest`** *(write)* — upload a new manifest version (multipart form upload; auto-parses ODCS manifests for manifest ID and version)

#### Semantic Traversal
- **`get_column_semantics`** — trace Column → Data Attributes → Business Terms / Measures
- **`get_measure_data`** — trace Measure → Data Attributes → Columns → Tables

#### Technical Lineage
- **`get_lineage_transformation`** — retrieve the SQL or script body for a technical lineage transformation by ID
- **`search_lineage_transformations`** — search lineage transformations by name with cursor pagination

### Changed
- **`search_assets_by_name`** — added `community_ids` (array), `domain_ids` (array), `domain_type_filter` (array), and `created_by_filter` (array) parameters; existing single-value `community_id` and `domain_id` remain for backwards compatibility
- **`get_lineage_upstream`** — added `entity_type` filter and `limit` parameter (default 20, max 100)
- **`get_lineage_downstream`** — added `entity_type` filter and `limit` parameter (default 20, max 100)
- **`search_lineage_entities`** — added explicit `limit` parameter (default 20, max 100)
- Tool count increased from 20 to **35**; write tool count increased from 4 to **9**

---

## 5.0.0 — Read-Only Safety Switch

### Added
- **`readOnly` config flag** — set `"readOnly": true` in `config.json` to run the server in read-only mode
- In read-only mode, all four write tools (`update_asset_description`, `bulk_update_asset_descriptions`, `update_asset_attribute`, `bulk_update_asset_attributes`) are **excluded from the MCP tool list entirely** — the AI cannot see or call them
- A secondary guard in `executeTool` returns a clear error if a write tool is somehow invoked while read-only mode is active
- `config.example.json` now defaults to `"readOnly": true` as the safe out-of-the-box configuration

### Why
When an MCP server is active, AI assistants can autonomously decide to call write tools without explicit instruction. Removing the tools from the MCP `ListTools` response is the strongest enforcement — a tool that doesn't exist cannot be misused.

---

## 4.0.0 — GraphQL, Semantic Traversal & Lineage

### Added
- **`get_relation_types`** — discover relationship types, filterable by source/target type and role
- **`get_table_semantics`** — traverse Table → Columns → Data Attributes → Measures using well-known relation types
- **`get_business_term_data`** — traverse Business Term → Data Attributes → Columns → Tables (reverse semantic trace)
- **`get_lineage_upstream`** — upstream data flow for a technical lineage entity
- **`get_lineage_downstream`** — downstream data flow for a technical lineage entity
- **`get_lineage_entity`** — details about a single technical lineage entity
- **`search_lineage_entities`** — find lineage entities by name, type, or DGC asset UUID
- Clickable URLs in all tool responses — direct links to assets, domains, and communities in Collibra

### Changed
- **`get_asset_by_id`** — rewritten to use a single GraphQL query fetching all attribute types (string, boolean, numeric, date) and relations with cursor-based pagination. Responsibilities still fetched via REST in parallel.
- **`search_assets_by_name`** — upgraded from `GET /rest/2.0/assets` to `POST /rest/2.0/search` with wildcard keyword matching and filters for resource type, community, domain, asset type, and status
- **`get_asset_relations`** — rewritten to use GraphQL with cursor-based pagination
- Tool count increased from 14 to 20

## 3.0.0 — Attribute Updates & Generic Write Operations

### Added
- **`get_attribute_types`** — discover attribute types by name or kind (BOOLEAN, STRING, NUMERIC, etc.)
- **`update_asset_attribute`** — update any attribute on a single asset by attribute type ID, with preview/confirm safety
- **`bulk_update_asset_attributes`** — update any attribute across multiple assets in one bulk operation

## 2.0.0 — Write Operations

### Added
- **`update_asset_description`** — update a single asset's Description attribute with preview/confirm safety
- **`bulk_update_asset_descriptions`** — bulk update descriptions for multiple assets
- Two-step safety pattern: all write tools preview changes before applying them
- `CollibraClient` gained `restCallWithBody()` for POST/PATCH/PUT requests

## 1.0.0 — Initial Release

### Features
- 8 read-only tools for Collibra data discovery and governance
- Multi-instance configuration support
- Full user name resolution (UUIDs → names, emails, usernames)
- Inherited responsibility support (asset, domain, community levels)
- Hierarchical community organization
- REST and GraphQL API support with automatic pagination

### Tools
- `get_asset_types`, `query_assets`, `search_assets_by_name`, `get_asset_by_id`
- `get_asset_relations`, `get_domains`, `get_communities`, `get_asset_responsibilities`
