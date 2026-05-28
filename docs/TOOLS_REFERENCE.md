# Tools Reference

Complete reference for all 66 tools provided by the Collibra MCP Server.

---

## Discovery & Navigation

### get_asset_types

List all asset type definitions from a Collibra instance (Data Set, Column, Table, etc.).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name from config.json |

**Tip:** Call this first to discover asset type names and IDs before querying assets.

---

### get_communities

List communities with automatic hierarchy building.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `parent_id` | No | Get children of a specific community |
| `name` | No | Filter by community name |
| `show_hierarchy` | No | Organize hierarchically (default: true) |
| `limit` | No | Max results (default: 1000) |

---

### get_domains

List domains (organizational containers for assets), auto-grouped by community.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `community_id` | No | Filter to a specific community |
| `name` | No | Filter by domain name |
| `limit` | No | Max results (default: 1000) |

---

### get_relation_types

Discover available relationship types in the Collibra operating model. Helps understand how asset types relate to each other.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `source_type_name` | No | Filter by source asset type name (case-insensitive partial match) |
| `target_type_name` | No | Filter by target asset type name (case-insensitive partial match) |
| `role` | No | Filter by role or co-role label (case-insensitive partial match) |

---

### get_domain_types

Retrieve all domain types from a Collibra instance. Domain types define the kind of content a domain holds (e.g. Glossary, Physical Data Dictionary, Report Catalog, Data Product Catalog, Technology Asset Domain, Policy Domain). Use this before `create_domain` to find the correct `type_id` for a target instance.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | No | Filter by name (partial match) |

---

### get_asset_statuses

Retrieve all asset workflow statuses from a Collibra instance. Returns the `id` and `name` of every status (e.g. Candidate, Accepted, Deprecated). Use this when migrating assets cross-instance to map status names to the correct UUIDs before calling `create_asset` with `status_id`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | No | Filter by status name (partial match) |

---

### get_api_catalog

Traverse the REST API catalog hierarchy in a Collibra instance: **REST API → REST API Version → REST API Endpoint → REST API Operation**. Returns a structured tree showing all cataloged APIs, their versioned releases, endpoint paths, and the HTTP operations on each path.

> **Prerequisite:** The REST API operating model must be configured in the target instance (run `setupArmyRestApiModel.mjs` first).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `api_name` | No | Filter to a specific REST API by name (partial match, case-insensitive). Omit to list all APIs. |
| `include_operations` | No | Whether to include REST API Operations in the response (default: `true`). Set to `false` for a compact API + Version + Endpoint summary. |
| `limit` | No | Maximum number of top-level REST API assets to return (default: 50) |

**Returns:** Each REST API with `baseUrl`, `lifecycleStatus`, `classificationLevel`, `authType`, `apiCategory`, `contactEmail`, nested versions (with `versionNumber`, `oasSpecVersion`), nested endpoints (with `pathTemplate`, `supportedMethods`), and optionally nested operations (with `httpMethod`, `operationId`, `summary`, `isDeprecated`).

---

## Search & Retrieval

### search_assets_by_name

Advanced search using the POST `/rest/2.0/search` endpoint. Supports keyword matching with automatic wildcard wrapping, and filtering by resource type, community, domain, asset type, and status.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `search_term` | Yes | Keyword(s) to search for (wildcards auto-added) |
| `resource_types` | No | Filter by resource types: `Asset`, `Domain`, `Community`, `User`, `UserGroup` |
| `community_id` | No | Filter to a specific community UUID |
| `domain_id` | No | Filter to a specific domain UUID |
| `asset_type_id` | No | Filter by asset type UUID |
| `status_id` | No | Filter by status UUID |
| `limit` | No | Max results (default: 100, max: 1000) |
| `offset` | No | Skip results for pagination (default: 0) |
| `community_ids` | No | Array of community UUIDs to filter by (multi-select alternative to `community_id`) |
| `domain_ids` | No | Array of domain UUIDs to filter by (multi-select alternative to `domain_id`) |
| `domain_type_filter` | No | Array of domain type names to filter by (e.g. `["Glossary", "Data Asset Domain"]`) |
| `created_by_filter` | No | Array of creator usernames or UUIDs |

---

### query_assets

Query assets using GraphQL with automatic pagination. Returns attributes and direct responsibilities.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_type_name` | No | Filter by asset type name (exact match) |
| `detail_level` | No | `"summary"` (default) or `"full"`. Summary returns fullName, displayName, and Description — up to 5000 per page. Full returns all attributes, responsibilities, and tags — defaults to 100 per page. |
| `limit` | No | Results per page. Defaults to 5000 for summary, 100 for full. |
| `offset` | No | Pagination offset (default: 0). Use `next_offset` from a previous response to fetch the next page. |

---

### get_asset_by_id

Get complete details for a single asset via a single GraphQL query. Returns all attribute types (string, boolean, numeric, date), incoming/outgoing relations with cursor-based pagination, and responsibilities (direct + inherited with full user names).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset |
| `include_inherited` | No | Include inherited responsibilities (default: true) |
| `outgoing_relations_cursor` | No | Cursor (relation ID) to fetch next page of outgoing relations |
| `incoming_relations_cursor` | No | Cursor (relation ID) to fetch next page of incoming relations |

**Pagination:** Relations return 50 per page. If `hasMoreOutgoing` or `hasMoreIncoming` is `true`, pass the `nextOutgoingCursor` or `nextIncomingCursor` from the response as the cursor parameter to get the next page.

**Responsibilities:** Fetched via REST in parallel with the GraphQL query. Categorized as:
- **Direct** — assigned directly to the asset
- **Inherited from Domain** — assigned at the domain level
- **Inherited from Community** — assigned at the community level

All user/group owners are resolved to full names, emails, and usernames via batch API calls.

---

## Relationships & Governance

### get_asset_relations

Get all incoming and outgoing relationships for an asset via GraphQL with offset-based pagination.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset |
| `relation_limit` | No | Max relations per direction (default: 100) |
| `relation_offset` | No | Offset for paginating relations per direction (default: 0) |

---

### get_asset_responsibilities

Detailed responsibility analysis with grouping by role and owner, including inherited responsibilities.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset |
| `include_inherited` | No | Include inherited responsibilities (default: true) |
| `role_name` | No | Filter by role name |

---

### get_attribute_types

Discover attribute types available in a Collibra instance. Use this to find the attribute type ID needed for `update_asset_attribute`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | No | Filter by name (partial match by default) |
| `name_match_mode` | No | `START`, `END`, `ANYWHERE` (default), `EXACT` |
| `kind` | No | `BOOLEAN`, `STRING`, `NUMERIC`, `DATE`, `SINGLE_VALUE_LIST`, `MULTI_VALUE_LIST`, `SCRIPT` |
| `limit` | No | Max results (default: 100, max: 1000) |

---

## Semantic Traversal

These tools traverse the Collibra operating model using well-known relationship types to connect physical data to business meaning.

### get_table_semantics

Discover the business meaning of a database Table by following: **Table → Columns → Data Attributes → Measures**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `table_asset_id` | Yes | UUID of the Table asset to analyze |

**Returns:** Each column with its linked data attributes and associated measures, all with clickable Collibra URLs.

---

### get_business_term_data

Trace a Business Term or Measure back to physical data by following: **Term → Data Attributes → Columns → Tables**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `term_asset_id` | Yes | UUID of the Business Term or Measure to trace |

**Returns:** Each linked data attribute with its columns and parent tables, answering "Where does this business concept live in the actual data?"

---

### get_column_semantics

Trace a Column asset to its business meaning: **Column → Data Attributes → Business Terms / Measures**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `column_asset_id` | Yes | UUID of the Column asset |

**Returns:** Data attributes linked to the column, with their associated business terms and measures.

---

### get_measure_data

Trace a Measure back to its physical data: **Measure → Data Attributes → Columns → Tables**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `measure_asset_id` | Yes | UUID of the Measure asset |

**Returns:** Data attributes linked to the measure, with their columns and parent tables.

---

## Technical Lineage

These tools work with Collibra's Technical Lineage module to trace data flow. Lineage entities have their own IDs separate from DGC asset UUIDs — use `search_lineage_entities` to bridge between them.

### search_lineage_entities

Search for technical lineage entities by name, type, or DGC asset UUID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name_contains` | No | Search by partial name |
| `entity_type` | No | Filter by type: `Column`, `Table`, `Database`, `Schema`, `Process` |
| `dgc_asset_id` | No | Find the lineage entity linked to a Collibra asset UUID |
| `limit` | No | Max results (default: 20, max: 100) |
| `cursor` | No | Pagination cursor from previous response |

---

### get_lineage_entity

Get details about a single technical lineage entity.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `entity_id` | Yes | Technical lineage entity ID |

---

### get_lineage_upstream

Get upstream lineage — what data flows INTO an entity.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `entity_id` | Yes | Technical lineage entity ID |
| `entity_type` | No | Filter results by entity type (e.g. `Column`, `Table`, `Database`) |
| `limit` | No | Max results (default: 20, max: 100) |
| `cursor` | No | Pagination cursor from previous response |

---

### get_lineage_downstream

Get downstream lineage — where an entity's data flows TO.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `entity_id` | Yes | Technical lineage entity ID |
| `entity_type` | No | Filter results by entity type (e.g. `Column`, `Table`, `Database`) |
| `limit` | No | Max results (default: 20, max: 100) |
| `cursor` | No | Pagination cursor from previous response |

---

### get_lineage_transformation

Retrieve the SQL or script body for a technical lineage transformation by ID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `transformation_id` | Yes | Technical lineage transformation ID |

**Returns:** Transformation name, description, and the full SQL/script text.

---

### search_lineage_transformations

Search technical lineage transformations by name.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name_contains` | No | Partial name to filter transformations |
| `limit` | No | Max results (default: 20, max: 100) |
| `cursor` | No | Pagination cursor from previous response |

---

## Asset Creation

Use the two-step `prepare` → `create` workflow. `prepare_create_asset` resolves names to IDs and catches duplicates before any write occurs.

### prepare_create_asset

Pre-flight check before creating a new asset. Resolves asset type and domain by name or UUID, checks for duplicates, and returns a readiness status.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_name` | Yes | Name of the asset to create |
| `asset_type_id` | No* | UUID of the asset type (`*` provide either this or `asset_type_name`) |
| `asset_type_name` | No* | Name of the asset type (e.g. `Business Term`, `Table`) |
| `domain_id` | No* | UUID of the target domain (`*` provide either this or `domain_name`) |
| `domain_name` | No* | Name of the target domain |

**Returns:** Status (`ready` / `incomplete` / `needs_clarification` / `duplicate_found`), resolved type/domain IDs, and any duplicate details.

---

### create_asset

Create any Collibra asset with optional attribute values.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Asset name |
| `asset_type_id` | Yes | UUID of the asset type |
| `domain_id` | Yes | UUID of the target domain |
| `status_id` | No | UUID of the initial workflow status (e.g. Candidate). Use `get_asset_statuses` to find valid IDs. |
| `display_name` | No | Optional display name (defaults to `name`) |
| `attributes` | No | Object mapping attribute type UUIDs to their values |

**Returns:** New asset ID, name, Collibra URL, type, domain, and any attribute creation results.

---

## Business Term Creation

### prepare_add_business_term

Pre-flight check before adding a Business Term. Resolves the glossary domain, checks for duplicate terms, and hydrates the available attribute schema.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Name of the business term to create |
| `domain_id` | No* | UUID of the target glossary domain |
| `domain_name` | No* | Name of the target glossary domain |

**Returns:** Status (`ready` / `duplicate_found` / `incomplete`), resolved domain ID, and available attribute types.

---

### add_business_term

Create a Business Term in a Collibra Glossary domain with an optional definition and additional attributes.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Business term name |
| `domain_id` | Yes | UUID of the target glossary domain |
| `definition` | No | Definition text (written to the standard Definition attribute) |
| `attributes` | No | Array of `{ type_id, value }` objects for additional attributes |

**Returns:** New term ID, name, Collibra URL, and attribute creation results.

---

## Operating Model Management

These write tools create or find communities, domains, asset relations, and operating model definitions (asset types, relation types). All are **idempotent** — if the item already exists it is returned unchanged without creating a duplicate.

### create_community

Create a community or sub-community. If a community with the same name already exists under the same parent, the existing community is returned.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|--------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Name of the community to create |
| `description` | No | Description for the community |
| `parent_id` | No | UUID of the parent community. Omit for a top-level community; provide to create a sub-community. |

**Returns:** `action` (`created` or `existing`), community `id`, `name`, `description`, and `parent`.

---

### create_domain

Create a domain inside a community. If a domain with the same name already exists in the same community, the existing domain is returned.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|--------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Name of the domain |
| `community_id` | Yes | UUID of the community that owns the domain |
| `type_id` | Yes | UUID of the domain type (from `get_domain_types`). Determines content kind (Glossary, Physical Data Dictionary, etc.) |
| `description` | No | Description for the domain |

**Returns:** `action` (`created` or `existing`), domain `id`, `name`, `type`, and `community`.

---

### create_relation

Create a typed relationship between two assets. If a relation of the same type already exists between the two assets, the existing relation is returned.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|--------------|
| `instance_name` | Yes | Collibra instance name |
| `source_asset_id` | Yes | UUID of the source asset (the "role" side of the relation type) |
| `target_asset_id` | Yes | UUID of the target asset (the "co-role" side of the relation type) |
| `relation_type_id` | Yes | UUID of the relation type. Use `get_relation_types` to find valid IDs. |

**Returns:** `action` (`created` or `existing`), relation `id`, `type` (role/co-role), `source`, and `target`.

---

### create_asset_type

Create an asset type in the operating model. If an asset type with the same name already exists, the existing type is returned.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|--------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | Yes | Name of the new asset type |
| `description` | No | Description for the asset type |
| `parent_id` | No | UUID of the parent asset type (for sub-types). Use `get_asset_types` to find parent UUIDs. |
| `color` | No | Hex color code for the asset type icon (e.g. `#0078D4`) |
| `symbol_type` | No | Symbol/icon identifier for the asset type |

**Returns:** `action` (`created` or `existing`), asset type `id`, `name`, `description`, `publicId`, and `parent`.

---

### create_relation_type

Create a relation type in the operating model. If a relation type with the same role, co-role, source type, and target type already exists, the existing type is returned.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|--------------|
| `instance_name` | Yes | Collibra instance name |
| `role` | Yes | Label for the relation in the source→target direction (e.g. `contains`) |
| `corole` | Yes | Label for the relation in the target→source direction (e.g. `is contained by`) |
| `source_asset_type_id` | Yes | UUID of the source asset type. Use `get_asset_types` to find this. |
| `target_asset_type_id` | Yes | UUID of the target asset type. Use `get_asset_types` to find this. |
| `description` | No | Description for the relation type |

**Returns:** `action` (`created` or `existing`), relation type `id`, `role`, `corole`, `sourceType`, and `targetType`.

---

## Data Classification

### search_data_class

Search Collibra data classes from the Classification service.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | No | Filter by data class name (partial match) |
| `description` | No | Filter by description (partial match) |
| `contains_rules` | No | `true` to return only data classes that have classification rules |
| `limit` | No | Max results (default: 50) |
| `offset` | No | Skip results for pagination (default: 0) |

---

### add_data_classification_match

Associate a data class with a Collibra asset.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset to classify |
| `classification_id` | Yes | UUID of the data class to associate |

---

### search_data_classification_match

Search existing classification matches with optional filters.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_ids` | No | Array of asset UUIDs to filter by |
| `statuses` | No | Array of statuses: `ACCEPTED`, `REJECTED`, `SUGGESTED` |
| `classification_ids` | No | Array of data class UUIDs to filter by |
| `asset_type_ids` | No | Array of asset type UUIDs to filter by |
| `limit` | No | Max results (default: 50) |
| `offset` | No | Skip results for pagination (default: 0) |

---

### remove_data_classification_match

Remove a classification match from an asset. Uses the two-step preview/confirm pattern.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `classification_match_id` | Yes | UUID of the classification match to remove |
| `confirm` | No | `true` to delete, `false` to preview (default) |

---

## Data Contracts

### list_data_contract

List data contracts with cursor-based pagination.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `manifest_id` | No | Filter by manifest ID |
| `cursor` | No | Pagination cursor from previous response |
| `limit` | No | Max results (default: 100, max: 500) |

---

### pull_data_contract_manifest

Download the active YAML manifest for a data contract.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `data_contract_id` | Yes | UUID of the data contract |

**Returns:** Raw YAML manifest text of the active version.

---

### push_data_contract_manifest

Upload a new version of a data contract manifest. Supports the Open Data Contract Standard (ODCS) — manifest ID and version are auto-parsed from ODCS files.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `manifest` | Yes | Full content of the manifest file (YAML) |
| `manifest_id` | No | Data contract UUID (auto-parsed from ODCS manifests) |
| `version` | No | Version string (auto-parsed from ODCS manifests) |
| `force` | No | `true` to overwrite an existing version with the same version value (default: false) |
| `active` | No | `true` to make this the active version (default: true) |

---

## Assessments

These tools integrate with the Collibra Assessments REST API (`/rest/assessments/v2`). Assessments capture structured Q&A against a template and are commonly linked to AI Use Case assets.

### list_assessments

List assessments, sorted by `lastModifiedOn` descending. Use `asset_id` to retrieve all assessments linked to a specific asset (e.g., an AI Use Case UUID).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name from config.json |
| `asset_id` | No | UUID of the linked asset (e.g., AI Use Case) to filter by |
| `status` | No | Filter by status: `DRAFT`, `SUBMITTED`, or `OBSOLETE` (case-insensitive) |
| `name` | No | Filter by assessment name (case-insensitive contains match) |
| `template_id` | No | UUID of the assessment template to filter by |
| `template_version` | No | Template version string — use with `template_id`. Use `LATEST` for the latest version. |
| `last_modified_from` | No | ISO 8601 start of the lastModifiedOn range (inclusive). Example: `2023-07-10T15:03:10.433Z` |
| `last_modified_to` | No | ISO 8601 end of the lastModifiedOn range (exclusive) |
| `limit` | No | Max results per page (default: 10, max: 50) |
| `cursor` | No | Pagination cursor from `nextCursor` of a previous response |

**Tip:** To find all assessments for an AI Use Case, call `list_assessments` with `asset_id=<AI Use Case UUID>`. Then use `get_assessment` to read the full Q&A answers for any result.

---

### get_assessment

Retrieve full details of a single assessment by UUID, including all Q&A content with question names, answer values, and comments.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assessment_id` | Yes | UUID of the assessment |

**Returns:** `id`, `name`, `status`, `template` (name, version, assetType), `asset`, `owner`, `assignees`, `isVisibleToEveryone`, `content[]` (questions + answers), `createdOn`, `createdBy`, `lastModifiedOn`, `lastModifiedBy`, `submittedOn`, `submittedBy`, `assessmentReview` asset ID, and `originAssessment` if this is a retake.

---

### get_assessment_by_review

Reverse lookup — find an assessment by its associated Assessment Review asset UUID in the Collibra catalog.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assessment_review_id` | Yes | UUID of the Assessment Review asset in Collibra |

**Returns:** Same full assessment structure as `get_assessment`.

---

### list_assessment_templates

Browse available assessment templates. Use this to find a `template_id` before creating a new assessment.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `name` | No | Filter by template name (case-insensitive contains match) |
| `status` | No | Filter by template status: `DRAFT`, `PUBLISHED`, or `OBSOLETE` |
| `asset_type_id` | No | UUID of an asset type — returns templates applicable to that type (e.g., the AI Use Case asset type UUID) |
| `latest_version_only` | No | `true` to return only the latest version of each template (default: false) |
| `limit` | No | Max results per page (default: 10, max: 50) |
| `cursor` | No | Pagination cursor from `nextCursor` of a previous response |

**Returns:** Template list sorted alphabetically by name, each with `id`, `name`, `version`, `status`, `assetType`, `notification`, and `retakePermission`.

---

### get_assessment_template

Get full details of a single assessment template.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `template_id` | Yes | UUID of the template |

**Returns:** `id`, `name`, `version`, `status`, `assetType`, `notification` (boolean), `retakePermission` (`All` / `Owner` / `OwnerAndAssignees`).

---

### list_assessment_attachments

List file attachments for a specific assessment.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assessment_id` | Yes | UUID of the assessment |

**Returns:** Array of attachment objects each with `id`, `fileName`, `createdBy` (user UUID), and `createdOn` timestamp.

---

### create_assessment

Create a new assessment from a template, optionally linked to a Collibra asset.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `template_id` | Yes | UUID of the template to use. Find IDs with `list_assessment_templates`. |
| `asset_id` | No | UUID of the Collibra asset to link (e.g., AI Use Case). When provided, the asset's name is used as the assessment name. |
| `name` | No | Assessment name. Required when `asset_id` is not provided. |
| `status` | No | Initial status: `DRAFT` (default) or `SUBMITTED` |
| `owner_id` | No | UUID of the assessment owner. Defaults to the authenticated user. |
| `assignees` | No | Raw JSON string. Example: `[{"type":"USER","id":"uuid"},{"type":"GROUP","id":"uuid"}]` |
| `is_visible_to_everyone` | No | `true` to make visible to all users. Default: `false` (owner + assignees only). |
| `assessment_review_domain_id` | No | UUID of the domain where the Assessment Review asset will be created. |
| `content` | No | Raw JSON string of initial Q&A answers. Example: `[{"id":"questionId","answer":{"type":"BOOLEAN","value":true},"comments":"note"}]` |

**Answer types:** `TEXT`, `HTML`, `DATE` (yyyy-MM-dd), `BOOLEAN`, `ITEMS`, `NUMBER`, `EXPRESSION`, `ASSETS`, `USERORGROUPS`, `ATTACHMENTS`.

---

### update_assessment

Update an existing assessment. All fields are optional — only provided fields are changed.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assessment_id` | Yes | UUID of the assessment to update |
| `status` | No | New status: `DRAFT`, `SUBMITTED`, or `OBSOLETE` |
| `name` | No | New assessment name |
| `owner_id` | No | UUID of the new owner |
| `assignees` | No | Raw JSON string replacing all assignees. Example: `[{"type":"USER","id":"uuid"}]` |
| `is_visible_to_everyone` | No | Update visibility (`true` / `false`) |
| `assessment_review_domain_id` | No | UUID of the domain for the Assessment Review asset |
| `content` | No | Raw JSON string replacing all Q&A answers |

---

### retake_assessment

Start a new revision of an existing assessment. Creates a new assessment referencing the original via `originAssessment`.

> **Write operation** — set `"readOnly": false` in `config.json` to enable.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assessment_id` | Yes | UUID of the assessment to retake |
| `owner_id` | No | UUID of the owner for the new assessment. Defaults to the authenticated user. |
| `asset_id` | No | UUID of the asset to link to the new assessment. Defaults to the original's asset. |

**Note:** The template's `retakePermission` policy (`All`, `Owner`, or `OwnerAndAssignees`) governs who can call this.

---

## Write Operations

> **Read-Only Mode:** If `"readOnly": true` is set in `config.json`, none of the tools in this section will appear in the AI's tool list. They are hidden at the protocol level and cannot be called. Set `"readOnly": false` to enable them.

All write tools use a **two-step preview/confirm** pattern:
1. Call with `confirm=false` (default) to see current vs. proposed values
2. Call again with `confirm=true` to apply

### update_asset_description

Update the Description attribute of a single asset.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset |
| `new_description` | Yes | New description text |
| `confirm` | No | `true` to apply, `false` to preview (default) |

---

### bulk_update_asset_descriptions

Update descriptions for multiple assets in a single bulk operation.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `updates` | Yes | Array of `{ asset_id, new_description }` objects |
| `confirm` | No | `true` to apply, `false` to preview (default) |

---

### update_asset_attribute

Update any attribute on a single asset by specifying the attribute type ID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset |
| `attribute_type_id` | Yes | UUID of the attribute type (use `get_attribute_types` to find) |
| `new_value` | Yes | New value as string (`"true"`/`"false"` for booleans, etc.) |
| `confirm` | No | `true` to apply, `false` to preview (default) |

---

### bulk_update_asset_attributes

Update the same attribute type across multiple assets in one bulk operation.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `attribute_type_id` | Yes | UUID of the attribute type |
| `updates` | Yes | Array of `{ asset_id, new_value }` objects |
| `confirm` | No | `true` to apply, `false` to preview (default) |

---

### create_asset

See full reference in the [Asset Creation](#asset-creation) section.

---

### add_business_term

See full reference in the [Business Term Creation](#business-term-creation) section.

---

### add_data_classification_match

See full reference in the [Data Classification](#data-classification) section.

---

### remove_data_classification_match

See full reference in the [Data Classification](#data-classification) section.

---

### push_data_contract_manifest

See full reference in the [Data Contracts](#data-contracts) section.

---

### create_assessment

See full reference in the [Assessments](#assessments) section.

---

### update_assessment

See full reference in the [Assessments](#assessments) section.

---

### retake_assessment

See full reference in the [Assessments](#assessments) section.

---

### create_community

See full reference in the [Operating Model Management](#operating-model-management) section.

---

### create_domain

See full reference in the [Operating Model Management](#operating-model-management) section.

---

### create_relation

See full reference in the [Operating Model Management](#operating-model-management) section.

---

### create_asset_type

See full reference in the [Operating Model Management](#operating-model-management) section.

---

### create_relation_type

See full reference in the [Operating Model Management](#operating-model-management) section.

---

## Operating Model Intelligence

These tools rely on a local operating model cache. Call `refresh_operating_model` once per session (or when the model changes) before using the other tools in this section.

### refresh_operating_model

Crawl a Collibra instance and persist an operating model snapshot to a local cache.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `force` | No | Re-crawl even if a cache already exists (default: false) |
| `max_age_hours` | No | Reuse existing cache if younger than this (default: 24 hours) |

**Returns:** Snapshot counts (asset types, domain types, attribute types, relation types, statuses), snapshot hash, `refreshedAt` timestamp, and whether an existing cache was reused.

---

### get_operating_model_summary

Return a compact, AI-friendly digest of the cached operating model.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |

**Returns:** Top-level asset type families (by child count), attribute-type kind distribution, status names, domain types, and total relation type count. Ideal for cheap context priming at conversation start.

---

### describe_asset_type

Full description of a specific asset type from the cache, including on-demand assignment data fetched from the live instance.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_type_id` | No* | UUID of the asset type (`*` provide this or `name`) |
| `name` | No* | Asset type name — case-insensitive contains match |

**Returns:** Parent/sub types, list of assignable attribute types (id, name, kind, description), assignable relation types (with direction, role/co-role label, and the other asset type), eligible workflow statuses.

---

### describe_domain_type

Describe a domain type from the cache and list asset type families whose names overlap with it.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `domain_type_id` | No* | UUID of the domain type (`*` provide this or `name`) |
| `name` | No* | Domain type name — case-insensitive contains match |

**Returns:** Domain type metadata plus a heuristic list of likely asset types for that domain.

---

### resolve_model_term

Fuzzy-resolve a free-text term against every kind of element in the cached model.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `term` | Yes | Free-text term to resolve (case-insensitive contains match) |
| `categories` | No | Restrict to: `assetType`, `domainType`, `attributeType`, `relationType`, `status`. Default: all. |
| `limit_per_category` | No | Max matches per category (default: 10) |

**Returns:** Ranked candidate matches per category, each with UUID, name, and match score.

---

### plan_asset_creation

Produce a portable, executable plan for creating an asset that conforms to the instance's operating model. Makes no API calls when reading from cache.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_name` | Yes | Proposed asset name |
| `asset_type_id` | No* | UUID of the asset type (`*` provide this or `asset_type_name`) |
| `asset_type_name` | No* | Asset type name (case-insensitive contains match) |
| `domain_id` | No* | UUID of the target domain (`*` provide this or `domain_name`) |
| `domain_name` | No* | Domain name (case-insensitive contains match) |
| `domain_type_id` | No | Domain type UUID hint when domain is not yet chosen |
| `preferred_status_name` | No | Preferred initial status name (e.g. `"Candidate"`) |

**Returns:** Resolved asset type UUID, domain UUID, assignable attribute types, recommended status, and a `nextAction` pointing at `prepare_create_asset` / `create_asset` with all resolved IDs.

---

### find_traversal_path

Find the shortest sequence of relation types connecting two asset types in the cached model.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `source_asset_type_id` | No* | UUID of the source asset type (`*` provide ID or name) |
| `source_asset_type_name` | No* | Source asset type name (case-insensitive contains match) |
| `target_asset_type_id` | No* | UUID of the target asset type |
| `target_asset_type_name` | No* | Target asset type name |
| `max_depth` | No | Maximum path length to consider (default: 5) |
| `max_paths` | No | Maximum number of paths to return (default: 3) |

**Returns:** Up to `max_paths` shortest paths. Each path is an ordered list of steps: `fromType`, `toType`, `relationTypeId`, `role`, `direction` (OUTGOING/INCOMING).

---

### validate_against_model

Pre-flight a proposed write against the cached model and return violations before any API call.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `proposal_type` | Yes | `asset`, `relation`, or `attribute` |
| `asset_type_id` | No | For `asset`: UUID to validate |
| `status_id` | No | For `asset`: status UUID to validate |
| `attribute_type_ids` | No | For `asset`: array of attribute type UUIDs to validate |
| `relation_type_id` | No | For `relation`: UUID to validate |
| `source_asset_type_id` | No | For `relation`: source asset type UUID |
| `target_asset_type_id` | No | For `relation`: target asset type UUID |
| `attribute_type_id` | No | For `attribute`: UUID to validate |

**Returns:** `valid: true/false`, list of violations (if any) with descriptions.

---

### plan_write_operation

Pure-logic decision helper — returns the recommended write tool and rationale. Makes no API calls.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `kind` | Yes | One of: `create_asset`, `create_relation`, `create_community`, `create_domain`, `update_attribute`, `update_description`, `add_business_term`, `delete_asset`, `delete_relation`, `multi_op_one_asset` |
| `items_count` | Yes | Number of items the operation involves |
| `same_target_type` | No | For `update_attribute`: are all updates targeting the same `attribute_type_id`? (default: true) |
| `affects_single_asset` | No | For `multi_op_one_asset`: confirm all ops target the same asset UUID (default: false) |

**Returns:** Recommended tool name plus rationale (why single vs. bulk vs. `edit_asset` is preferred for that combination).

---

## Bulk Operations

All bulk tools use the two-step **preview/confirm** pattern: call with `confirm=false` (default) to preview, then `confirm=true` to apply.

> **Write operation** — all bulk tools are hidden when `"readOnly": true`.

### bulk_create_assets

Create multiple Collibra assets in a single `POST /rest/2.0/assets/bulk` call with an optional `POST /rest/2.0/attributes/bulk` pass for attributes. Far more efficient than calling `create_asset` N times.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `assets` | Yes | Array of assets to create. Each entry: `name` (req), `asset_type_id` (req), `domain_id` (req), `display_name`, `status_id`, `attributes` (map of type UUID → value) |
| `confirm` | No | `true` to apply, `false` to preview (default). Preview detects existing `(domain_id, name)` pairs. |
| `skip_existing` | No | Skip assets whose `(domain_id, name)` already exists in confirm mode (default: true) |

---

### bulk_create_relations

Create multiple typed relations in a single `POST /rest/2.0/relations/bulk` call. Idempotent — existing `(source, target, type)` triples are detected in preview and skipped on apply.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `relations` | Yes | Array of relations to create. Each entry: `source_asset_id` (req), `target_asset_id` (req), `relation_type_id` (req) |
| `confirm` | No | `true` to apply, `false` to preview (default). Preview classifies each as NEW or EXISTING. |

---

### bulk_delete_assets

Permanently delete multiple assets in a single `DELETE /rest/2.0/assets/bulk` call.

> **DESTRUCTIVE** — all attributes, relations, attachments, and comments for each asset are removed. Cannot be undone.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_ids` | Yes | Array of asset UUIDs to delete |
| `confirm` | No | `true` to delete, `false` to preview (default). Preview shows name, type, domain, and URL for each asset. |

---

### bulk_delete_relations

Permanently delete multiple relations in a single `DELETE /rest/2.0/relations/bulk` call.

> **DESTRUCTIVE** — relations are removed permanently; linked assets are untouched.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `relation_ids` | Yes | Array of relation UUIDs to delete |
| `confirm` | No | `true` to delete, `false` to preview (default). Preview shows source asset, target asset, and relation type for each. |

---

### edit_asset

Apply a list of typed edits to a single asset in one tool call. Attribute changes are batched via `/attributes/bulk`; relation changes are batched via `/relations/bulk`.

> **Write operation** — hidden when `"readOnly": true`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `instance_name` | Yes | Collibra instance name |
| `asset_id` | Yes | UUID of the asset to edit |
| `operations` | Yes | Ordered list of edit operations (see below) |
| `confirm` | No | `true` to apply, `false` to preview (default). Preview shows current vs. proposed value for each op. |

**Operation types:**

| `op` | Required extra fields | Description |
|------|-----------------------|-------------|
| `update_attribute` | `attribute_type_id`, `value` | PATCH existing attribute; POST if not present |
| `add_attribute` | `attribute_type_id`, `value` | Always POST a new attribute value |
| `remove_attribute` | `attribute_type_id` | DELETE all attribute values for that type on this asset |
| `update_property` | `property` (`name`/`displayName`/`statusId`), `value` | PATCH the asset's top-level property |
| `add_relation` | `target_asset_id`, `relation_type_id` | Create a typed relation (idempotent) |
| `remove_relation` | `target_asset_id`, `relation_type_id` | Delete a typed relation |

---

## Common Workflows

### Data Discovery
```
get_communities → get_domains → search_assets_by_name → get_asset_by_id
```

### Understand a Table's Business Meaning
```
search_assets_by_name (find the table) → get_table_semantics
```

### Find Where a Business Term Lives in Data
```
search_assets_by_name (find the term) → get_business_term_data
```

### Trace Data Lineage
```
search_lineage_entities (find entity ID) → get_lineage_upstream / get_lineage_downstream
```

### Governance Audit
```
get_asset_by_id (includes responsibilities) or get_asset_responsibilities (with include_inherited=true)
```

### AI Use Case — Find and Read Assessments
```
search_assets_by_name (find the AI Use Case) → list_assessments (asset_id=<uuid>) → get_assessment (read Q&A)
```

### AI Use Case — Create and Submit an Assessment
```
list_assessment_templates (find template) → create_assessment (template_id, asset_id) → update_assessment (status=SUBMITTED)
```

### Bulk Attribute Update
```
get_attribute_types (find type ID) → bulk_update_asset_attributes (preview) → bulk_update_asset_attributes (confirm)
```

### Operating Model — Prime Context Before Writing
```
refresh_operating_model → get_operating_model_summary → describe_asset_type (or resolve_model_term)
```

### Discover How Two Asset Types Relate
```
refresh_operating_model → find_traversal_path (source_asset_type_name, target_asset_type_name)
```

### Plan and Validate an Asset Before Creating It
```
refresh_operating_model → plan_asset_creation → validate_against_model → prepare_create_asset → create_asset
```

### Bulk-Create Assets from a List
```
plan_write_operation (kind=create_asset, items_count=N) → bulk_create_assets (confirm=false) → bulk_create_assets (confirm=true)
```

### Multi-Op Edit on a Single Asset
```
plan_write_operation (kind=multi_op_one_asset) → edit_asset (confirm=false preview) → edit_asset (confirm=true)
```
