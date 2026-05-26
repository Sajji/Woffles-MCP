#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, getInstances, getWarning, getWarningIcon } from './config.js';
import { tools, executeTool } from './tools/index.js';

// Create server instance
const server = new Server(
  {
    name: 'collibra-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize configuration
try {
  loadConfig();
  const instances = getInstances();
  console.error(`✓ Loaded configuration with ${instances.length} Collibra instance(s):`);
  instances.forEach(instance => {
    console.error(`  - ${instance.name}: ${instance.baseUrl}`);
  });
} catch (error) {
  console.error('✗ Failed to load configuration:', (error as Error).message);
  process.exit(1);
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await executeTool(name, args || {});
    const warning = getWarning();
    const text = warning ? `${result.text}\n\n---\n${getWarningIcon()} ${warning}` : result.text;

    const response: any = {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };

    // Emit MCP structuredContent when the tool produced a structured payload.
    if (result.structured !== undefined) {
      response.structuredContent = result.structured;
    }

    return response;
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: true,
            message: (error as Error).message,
            tool: name,
            arguments: args,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Collibra MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
