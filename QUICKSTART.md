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

The server exposes 13 tools covering:

- **Discovery** — asset types, communities, domains
- **Search** — by name, by GraphQL query, by ID
- **Governance** — relations, responsibilities (with inheritance + user name resolution)
- **Metadata** — browse attribute types by name or kind
- **Updates** — update any attribute (description, boolean flags, etc.) on single or multiple assets with preview/confirm safety

See [README.md](README.md) for the full tool list or [INSTALL.md](INSTALL.md) for detailed setup and MCP client configuration.
