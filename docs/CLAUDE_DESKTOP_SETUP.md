# Connecting Claude Desktop to Your Collibra MCP Server

## Step-by-Step Instructions

### Step 1: Locate Your Claude Desktop Configuration File

The configuration file location depends on your operating system:

**macOS/Linux:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

### Step 2: Find Your Project Paths

You need two absolute paths:
1. Path to your compiled MCP server: `/path/to/collibra-mcp/dist/index.js`
2. Path to your config file: `/path/to/collibra-mcp/config.json`

**To find your absolute path:**

**macOS/Linux:**
```bash
cd /path/to/collibra-mcp
pwd
# This will print something like: /Users/yourname/projects/collibra-mcp
```

**Windows (PowerShell):**
```powershell
cd C:\path\to\collibra-mcp
$pwd.Path
# This will print something like: C:\Users\yourname\projects\collibra-mcp
```

### Step 3: Edit the Claude Desktop Configuration

Open the `claude_desktop_config.json` file in a text editor.

**If the file doesn't exist**, create it with this content:

**macOS/Linux:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "/absolute/path/to/collibra-mcp/dist/index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "/absolute/path/to/collibra-mcp/config.json"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\collibra-mcp\\dist\\index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "C:\\absolute\\path\\to\\collibra-mcp\\config.json"
      }
    }
  }
}
```

**If the file already exists** with other MCP servers, add your Collibra server to the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "existing-server": {
      "command": "...",
      "args": ["..."]
    },
    "collibra": {
      "command": "node",
      "args": [
        "/absolute/path/to/collibra-mcp/dist/index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "/absolute/path/to/collibra-mcp/config.json"
      }
    }
  }
}
```

### Step 4: Replace the Placeholder Paths

**Example for macOS:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "/Users/johnsmith/projects/collibra-mcp/dist/index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "/Users/johnsmith/projects/collibra-mcp/config.json"
      }
    }
  }
}
```

**Example for Windows:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "C:\\Users\\johnsmith\\projects\\collibra-mcp\\dist\\index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "C:\\Users\\johnsmith\\projects\\collibra-mcp\\config.json"
      }
    }
  }
}
```

### Step 5: Save and Restart Claude Desktop

1. **Save** the `claude_desktop_config.json` file
2. **Completely quit** Claude Desktop (not just close the window)
   - **macOS:** Right-click the Claude icon in the Dock → Quit
   - **Windows:** Right-click the system tray icon → Exit
3. **Restart** Claude Desktop

### Step 6: Verify It's Working

When Claude Desktop starts, you should see your Collibra tools available:

1. Start a new conversation
2. Look for the tools icon or hammer icon
3. You should see either 16 or 20 Collibra tools depending on your `readOnly` setting:
   - get_asset_types
   - query_assets
   - search_assets_by_name
   - get_asset_by_id
   - get_asset_relations
   - get_domains
   - get_communities
   - get_asset_responsibilities
   - get_attribute_types
   - get_relation_types
   - get_table_semantics
   - get_business_term_data
   - get_lineage_upstream
   - get_lineage_downstream
   - get_lineage_entity
   - search_lineage_entities
   - update_asset_description
   - bulk_update_asset_descriptions
   - update_asset_attribute
   - bulk_update_asset_attributes

4. Try asking Claude: **"List all communities from my Production Collibra instance"**

> **Note:** If `"readOnly": true` is set in your `config.json` (the default), write tools (`update_asset_description`, `bulk_update_asset_descriptions`, `update_asset_attribute`, `bulk_update_asset_attributes`) will **not** appear in the list. This is intentional — it prevents the AI from making changes without your explicit authorisation. You will see 16 tools instead of 20.

---

## 🔧 Troubleshooting

### Issue 1: "MCP server not showing up"

**Check:**
- JSON syntax is valid (no trailing commas, proper quotes)
- Paths are absolute (not relative like `./dist/index.js`)
- Forward slashes on macOS/Linux: `/path/to/file`
- Backslashes on Windows: `C:\\path\\to\\file`
- Node.js is installed: `node --version`
- Project is built: Check that `dist/index.js` exists

**Fix:**
```bash
cd /path/to/collibra-mcp
npm run build
# Verify dist/index.js was created
ls dist/
```

### Issue 2: "Configuration file not found"

**Error in Claude Desktop logs:**
```
Configuration file not found at /path/...
```

**Fix:**
- Verify `config.json` exists in your project directory
- Check the path in `COLLIBRA_CONFIG_PATH` is correct
- Make sure you copied `config.example.json` to `config.json`

### Issue 3: "Authentication failed"

**Error when using tools:**
```
REST API call failed: 401 Unauthorized
```

**Fix:**
- Verify credentials in `config.json` are correct
- Test credentials by logging into Collibra web interface
- Check that the baseUrl doesn't have a trailing slash

### Issue 4: "Node not found"

**Error:**
```
command not found: node
```

**Fix (macOS/Linux):**
```bash
which node
# If nothing appears, Node.js is not installed or not in PATH
```

**Fix (Windows):**
```powershell
node --version
# If error, Node.js is not installed or not in PATH
```

Install Node.js from: https://nodejs.org/

### Issue 5: "Invalid JSON in config"

**Symptoms:**
- Claude Desktop doesn't start
- MCP server list is empty

**Fix:**
- Validate your JSON at https://jsonlint.com/
- Common issues:
  - Trailing commas: `"key": "value",}` ❌
  - Missing commas: `"key": "value" "key2"` ❌
  - Single quotes: `'key': 'value'` ❌
  - Unescaped backslashes on Windows: `C:\path` ❌ → `C:\\path` ✅

---

## 📋 Full Configuration Template

Copy this and replace the paths:

**macOS/Linux:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "/REPLACE/WITH/YOUR/PATH/collibra-mcp/dist/index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "/REPLACE/WITH/YOUR/PATH/collibra-mcp/config.json"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "collibra": {
      "command": "node",
      "args": [
        "C:\\REPLACE\\WITH\\YOUR\\PATH\\collibra-mcp\\dist\\index.js"
      ],
      "env": {
        "COLLIBRA_CONFIG_PATH": "C:\\REPLACE\\WITH\\YOUR\\PATH\\collibra-mcp\\config.json"
      }
    }
  }
}
```

---

## 🎯 Testing Your Tools in Claude Desktop

Once configured, try these example prompts:

### Example 1: List Communities
```
"List all communities from my Production Collibra instance"
```

Claude will use: `get_communities`

### Example 2: Search for Assets
```
"Search for assets with 'customer' in the name in my Production instance"
```

Claude will use: `search_assets_by_name`

### Example 3: Get Asset Details
```
"Get complete details for asset ID abc-123-def in Production"
```

Claude will use: `get_asset_by_id`

### Example 4: Explore Structure
```
"Show me the domains in the Finance community"
```

Claude will use: `get_communities` (to find Finance) then `get_domains`

### Example 5: Complex Workflow
```
"Find the asset called 'Customer Data', then show me what it's related to"
```

Claude will use: `search_assets_by_name` → `get_asset_relations`

---

## 🔍 Viewing MCP Server Logs

If you need to debug, you can view the MCP server logs:

**macOS:**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

**Windows:**
```powershell
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Wait -Tail 50
```

The logs will show:
- When the server starts
- Which instances are loaded
- Any errors that occur
- Tool executions

---

## ✅ Quick Checklist

Before asking for help, verify:

- [ ] `dist/index.js` exists (run `npm run build` if not)
- [ ] `config.json` exists with valid Collibra credentials
- [ ] Paths in `claude_desktop_config.json` are absolute
- [ ] Node.js is installed and in PATH
- [ ] Claude Desktop was completely quit and restarted
- [ ] JSON configuration is valid (no syntax errors)
- [ ] You can connect to Collibra web interface with same credentials

---

## 🎉 Success Indicators

You'll know it's working when:

1. ✅ Claude Desktop starts without errors
2. ✅ You see 🔌 or 🔨 icon showing available tools
3. ✅ You can see 13 Collibra tools in the list
4. ✅ Claude responds to queries using your Collibra data
5. ✅ Tool responses contain actual data from your instances

---

## 💡 Pro Tips

1. **Keep the server terminal open** when developing to see real-time logs
2. **Use descriptive instance names** in config.json (e.g., "Production", "Dev", "UAT")
3. **Test with VS Code first** before trying Claude Desktop
4. **Check logs** if something doesn't work
5. **Validate JSON** before restarting Claude Desktop

---

## 🆘 Still Having Issues?

If you're still stuck:

1. Check the MCP server logs (see "Viewing MCP Server Logs" above)
2. Verify your `claude_desktop_config.json` syntax at jsonlint.com
3. Test your MCP server standalone:
   ```bash
   cd /path/to/collibra-mcp
   npm start
   # Should show: "✓ Loaded configuration with X Collibra instance(s)"
   ```
4. Check Claude Desktop logs for errors
5. Ensure your Collibra instances are accessible from your network

---

Need more help? Share the error message and I can help troubleshoot!
