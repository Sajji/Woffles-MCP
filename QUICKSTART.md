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

## What's Available

The server exposes **66 tools** covering:

- **Discovery** — asset types, statuses, communities, domains, domain types, relation types, attribute types, REST API catalog
- **Search & retrieval** — POST search, GraphQL queries, full asset details
- **Governance** — relations, responsibilities (with inheritance + full user name resolution)
- **Semantic traversal** — Table ↔ Column ↔ Data Attribute ↔ Business Term ↔ Measure
- **Technical lineage** — upstream/downstream entities and transformation SQL/script bodies
- **Asset & operating-model creation** — assets, business terms, communities, domains, relations, asset types, relation types
- **Operating model intelligence** — cache the model once (`refresh_operating_model`), then describe asset types, find relation paths, validate writes, and plan creations without extra API calls
- **Bulk operations** — create/delete multiple assets or relations in 1–2 round trips with preview/confirm safety
- **Compound edit** — `edit_asset` applies multiple attribute, property, and relation ops to a single asset in one call
- **Data classification** — search data classes; add/remove/search classification matches
- **Data contracts** — list, pull, push manifests
- **Assessments** — list/get/create/update/retake assessments and templates (Collibra Assessments API)
- **Write operations** — single + bulk attribute / description updates with preview→confirm safety

Set `"readOnly": true` in `config.json` (the default) to hide all 22 write tools from the AI. Set it to `false` to enable them.

See [README.md](README.md) for the full tool list, [docs/TOOLS_REFERENCE.md](docs/TOOLS_REFERENCE.md) for per-parameter details, and [INSTALL.md](INSTALL.md) for MCP-client setup.
