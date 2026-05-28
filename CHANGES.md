# Changelog

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
- **`get_api_catalog`** — traverse the REST API catalog hierarchy: **REST API → REST API Version → REST API Endpoint → REST API Operation**; filter by API name, toggle operation detail with `include_operations`, and paginate with `limit`; designed for instances with the Army REST API operating model configured

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
