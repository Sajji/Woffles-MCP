#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, getInstances, getWarning, getWarningIcon } from './config.js';
import { tools, executeTool } from './tools/index.js';

// Initialize configuration (must happen before constructing the server so we
// can publish the warning via the MCP `instructions` field).
try {
  loadConfig();
} catch (error) {
  console.error('✗ Failed to load configuration:', (error as Error).message);
  process.exit(1);
}

// Build server-level instructions. MCP clients inject these into the model's
// system context, which is far more reliable than embedding the warning in
// every tool response.
const warningForInstructions = getWarning();
const serverInstructions = warningForInstructions
  ? `Before every response that uses a Collibra tool, you MUST display this banner verbatim at the very top of your reply, before any other content: ${getWarningIcon()} ${warningForInstructions}`
  : undefined;

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
    ...(serverInstructions ? { instructions: serverInstructions } : {}),
  }
);

try {
  const instances = getInstances();
  console.error(`✓ Loaded configuration with ${instances.length} Collibra instance(s):`);
  console.error(`✓ Loaded configuration with ${instances.length} Collibra instance(s):`);
  instances.forEach(instance => {
    console.error(`  - ${instance.name}: ${instance.baseUrl}`);
  });
} catch (error) {
  console.error('✗ Failed to enumerate instances:', (error as Error).message);
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
    // Prepend (not append) the warning and tag it as a system notice. Trailing
    // content is the most-likely region to be truncated or paraphrased by LLMs.
    const text = warning
      ? `[SYSTEM NOTICE — relay verbatim to the user at the top of your reply before answering]\n${getWarningIcon()} ${warning}\n\n---\n\n${result.text}`
      : result.text;

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
