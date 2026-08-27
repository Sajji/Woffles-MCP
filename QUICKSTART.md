# Quick Start

Get the Collibra MCP Server running in under 5 minutes.

```bash
# 1. Install
npm install

# 2. Configure
cp config.example.json config.json
# Edit config.json with your Collibra URL and credentials

# 3. Build & run
npm run build
npm start
```

You should see:

```
✓ Loaded configuration with 1 Collibra instance(s):
  - Production: https://your-instance.collibra.com
Collibra MCP Server running on stdio
```

## Try It Out

Once connected to an MCP client, try these prompts:

- *"List all asset types from my Production Collibra instance"*
- *"Search for assets with 'customer' in the name"*
- *"Show me the communities and their hierarchy"*
- *"Get the full details of asset \<id\>"*
- *"What attribute types are available? Find ones related to PII."*
- *"Update the Personally Identifiable Information attribute to true for asset \<id\>"*
- *"Tell me everything my catalog **and** the Star Wars API know about Luke Skywalker"*

## What's Available

The server exposes **94 tools** (plus 3 chip-compatible aliases) covering:

- **Discovery** — configured instances, asset types, statuses, communities, domains, domain types, relation types, attribute types, REST API catalog
- **Search & retrieval** — POST search, GraphQL queries, full asset details
- **Governance** — relations, responsibilities (with inheritance + full user name resolution)
- **Semantic traversal** — Table ↔ Column ↔ Data Attribute ↔ Business Term ↔ Measure
- **Technical lineage** — upstream/downstream entities and transformation SQL/script bodies
- **Asset & operating-model creation** — assets, business terms, communities, domains, relations, asset types, relation types
- **Operating model intelligence** — cache the model once (`refresh_operating_model`), then describe asset types, find relation paths, validate writes, and plan creations without extra API calls
- **Bulk operations** — create/delete multiple assets or relations in 1–2 round trips with preview/confirm safety
- **Compound edit** — `edit_asset` applies multiple attribute, property, relation, tag, and responsibility ops to a single asset in one call
- **Data classification** — search data classes; add/remove/search classification matches
- **Data contracts** — initialize, list, pull, push manifests
- **Assessments** — list/get/create/retake assessments and templates, plus typed atomic edits via `edit_assessment` (Collibra Assessments API)
- **Workflows** — list definitions and open tasks, start instances, and complete tasks (with form-field previews)
- **Collaboration & audit** — comments (read/add/reply), user ratings, and the activity stream (who changed what, when)
- **Catalog metadata search** — `search_catalog_columns` finds Column assets by description, data type, steward, or related business asset via the Knowledge Graph
- **Mappings & migration** — external-system mappings (find/add/remove) for idempotent integrations
- **Output Module** — run report-style TableViewConfig/ViewConfig queries and get JSON inline
- **Skills** — embedded workflow guides the AI can list and load (`list_collibra_skills` / `load_collibra_skill`), extensible via `skillsDir`
- **Context specifications** — Semantic Blueprint specs and per-asset generated YAML context
- **Multi-API federation** — one MCP server, many APIs: `search_subject` fans a single query across every Collibra instance **and** the public Star Wars API at once (see README)
- **Write operations** — single + bulk attribute / description updates with preview→confirm safety; Markdown is auto-converted to HTML for rich-text attributes

Set `"readOnly": true` in `config.json` (the default) to hide all 31 write tools from the AI. Set it to `false` to enable them. You can further narrow the surface with `enabledTools` / `disabledTools` (see README).

See [README.md](README.md) for the full tool list, [docs/TOOLS_REFERENCE.md](docs/TOOLS_REFERENCE.md) for per-parameter details, and [INSTALL.md](INSTALL.md) for MCP-client setup.
