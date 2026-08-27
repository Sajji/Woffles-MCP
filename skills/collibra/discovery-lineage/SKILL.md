# Data Discovery & Lineage Workflow

Find data assets, understand their business meaning, and trace where the data comes from and goes.

## When to use

- "Find the table/column with X", "what does this column mean", "where does this data come from"

## Steps

1. Start broad: **`search_assets_by_name`** (keyword) or **`search_catalog_columns`** (metadata filters: description, data type, steward, related business term).
2. Popularity signal when the user is exploring: **`get_asset_view_stats`** (most_viewed).
3. Drill in: **`get_asset_by_id`** (add `include_breadcrumb=true` for the community/domain path; `include_assignable_schema=true` when editing is planned).
4. Business meaning:
   - Table → **`get_table_semantics`** (columns → data attributes → measures)
   - Column → **`get_column_semantics`** (data attributes → business terms / measures)
   - Business Term → **`get_business_term_data`** (reverse: term → columns/tables)
5. Technical lineage:
   - **`search_lineage_entities`** to find the lineage node for a DGC asset
   - **`get_lineage_upstream`** / **`get_lineage_downstream`** for sources/consumers
   - **`get_lineage_transformation`** for the SQL behind an edge
6. Trust signals: **`find_ratings`**, **`find_comments`**, and **`get_activities`** (recent changes) on the asset.

## Rules

- `search_catalog_columns` needs the Knowledge Graph GraphQL API enabled; fall back to `query_assets` + client-side filtering if it errors.
- Lineage entity IDs are NOT asset UUIDs — always resolve via `search_lineage_entities` first.
