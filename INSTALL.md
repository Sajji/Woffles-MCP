# Installation Guide

## Prerequisites

- **Node.js** 18 or higher (`node --version` to check)
- Access to one or more Collibra instances
- Valid Collibra credentials (username + password)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Collibra Instances

```bash
cp config.example.json config.json
```

Edit `config.json` with your Collibra instance details:

```json
{
  "readOnly": true,
  "instances": [
    {
      "name": "Production",
      "baseUrl": "https://your-instance.collibra.com",
      "username": "your-username",
      "password": "your-password"
    }
  ]
}
```

- **readOnly** — `true` (recommended) hides all write tools from the AI so it cannot make changes; set to `false` to enable write tools
- **name** — friendly name you'll use in tool calls
- **baseUrl** — your Collibra URL (no trailing slash)
- **username / password** — Collibra credentials

You can add multiple instances to the `instances` array.

> **Safety tip:** Keep `"readOnly": true` as your default. Only set it to `false` when you explicitly need to update data, and switch it back immediately after.

### 3. Build

```bash
npm run build
```

### 4. Verify

```bash
npm start
```

You should see:

```
✓ Loaded configuration with 1 Collibra instance(s):
  - Production: https://your-instance.collibra.com
Collibra MCP Server running on stdio
```

Press `Ctrl+C` to stop.

## Connecting to an MCP Client

### Claude Desktop

See [docs/CLAUDE_DESKTOP_SETUP.md](docs/CLAUDE_DESKTOP_SETUP.md) for the full walkthrough.

**Quick version** — edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following (replace paths with your actual absolute paths):

```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "COLLIBRA_CONFIG_PATH": "/absolute/path/to/config.json"
      }
    }
  }
}
```

Restart Claude Desktop. You should see all 35 Collibra tools available (26 read-only tools when `"readOnly": true`; all 35 when `"readOnly": false`).

### VS Code (GitHub Copilot)

In your VS Code MCP settings, add the server with the same `command`, `args`, and `env` as above.

### Other MCP Clients

Any client that supports the MCP stdio transport can use this server. Point it at `node dist/index.js` and set the `COLLIBRA_CONFIG_PATH` environment variable.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Configuration file not found" | Make sure `config.json` exists, or set `COLLIBRA_CONFIG_PATH` |
| "401 Unauthorized" | Check credentials in `config.json`; verify they work in the Collibra web UI |
| "Instance not found" | `instance_name` in tool calls must exactly match a `name` in `config.json` (case-sensitive) |
| "Cannot find module" | Run `npm run build` — the `dist/` folder must exist |
| MCP server not appearing | Check JSON syntax, use absolute paths, ensure Node.js is on your PATH |
| Write tools not showing up | This is expected when `"readOnly": true` — set to `false` in `config.json` to enable them |

## Try It Out

Once connected to an MCP client, try these prompts:

- *"List all asset types from my Production Collibra instance"*
- *"Search for assets with 'customer' in the name"*
- *"Show me the communities and their hierarchy"*
- *"Get the full details of asset \<id\>"*
- *"What's the business meaning of table \<id\>?"*
- *"Show me upstream lineage for this column"*
- *"Update the description for asset \<id\>"*
- Completely quit and restart Claude Desktop
- Check Claude Desktop logs

### More Help
See `docs/CLAUDE_DESKTOP_SETUP.md` for comprehensive troubleshooting.

## Security Notes

- **Never commit** config.json to git (it's already in .gitignore)
- Use service accounts when possible
- Rotate credentials regularly
- Store config.json securely
- Use HTTPS for all Collibra URLs

## Support

For detailed documentation, see:
- README.md - Overview and features
- QUICKSTART.md - Quick reference
- docs/ folder - Comprehensive guides
- CHANGES.md - What's new

Happy data governance! 🚀
