#!/usr/bin/env node
import { createServer as createHttpServer } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { loadConfig, getInstances, isReadOnly } from './config.js';
import { tools, executeTool } from './tools/index.js';

// Initialize configuration (must happen before constructing the server so we
// can publish the warning via the MCP `instructions` field).
try {
  loadConfig();
} catch (error) {
  console.error('✗ Failed to load configuration:', (error as Error).message);
  process.exit(1);
}

// ── Optional warn-only output validation (config `validateOutput: true`) ──
const validateOutput = loadConfig().validateOutput === true;
const ajv = new (Ajv as any)({ strict: false, allowUnionTypes: true });
const validatorByTool = new Map<string, any>();

function validateStructured(toolName: string, structured: unknown): void {
  if (!validateOutput || structured === undefined) return;
  try {
    let validate = validatorByTool.get(toolName);
    if (validate === undefined) {
      const schema = tools.find((t) => t.name === toolName)?.outputSchema;
      validate = schema ? ajv.compile(schema) : null;
      validatorByTool.set(toolName, validate);
    }
    if (validate && !validate(structured)) {
      console.error(
        `⚠ [validateOutput] ${toolName} output does not match its outputSchema: ${ajv.errorsText(validate.errors)}`,
      );
    }
  } catch (err) {
    console.error(`⚠ [validateOutput] schema check failed for ${toolName}: ${(err as Error).message}`);
  }
}

/**
 * Build a fully wired MCP Server. A factory (rather than a singleton) so the
 * stateless HTTP transport can create one instance per request.
 */
function buildServer(): Server {
  const server = new Server(
    {
      name: 'collibra-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'Every tool requires an "instance_name" argument identifying a configured Collibra instance. ' +
        'Call get_instances first (no arguments) to discover the valid instance names before calling any other tool. ' +
        'Call list_collibra_skills to discover workflow guides for multi-step tasks.' +
        (isReadOnly() ? ' This server is running in read-only mode: write tools are disabled.' : ''),
    }
  );

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
      const text = result.text;

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
        validateStructured(name, result.structured);
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

  return server;
}

try {
  const instances = getInstances();
  console.error(`✓ Loaded configuration with ${instances.length} Collibra instance(s):`);
  instances.forEach(instance => {
    console.error(`  - ${instance.name}: ${instance.baseUrl}`);
    if (instance.insecure) {
      console.error(`  ⚠ WARNING: TLS certificate verification is DISABLED for "${instance.name}" (insecure: true) — do not use in production`);
    }
  });
} catch (error) {
  console.error('✗ Failed to enumerate instances:', (error as Error).message);
  process.exit(1);
}

/** Resolve HTTP mode from --http[=port] CLI flag, env var, or config. */
function resolveHttpMode(): { enabled: boolean; port: number } {
  const cfg = loadConfig().http || {};
  let enabled = cfg.enabled === true;
  let port = cfg.port ?? 3399;
  const arg = process.argv.find((a) => a === '--http' || a.startsWith('--http='));
  if (arg) {
    enabled = true;
    const eq = arg.split('=')[1];
    if (eq) port = Number(eq);
  }
  if (process.env.COLLIBRA_MCP_HTTP_PORT) {
    enabled = true;
    port = Number(process.env.COLLIBRA_MCP_HTTP_PORT);
  }
  return { enabled, port };
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Collibra MCP Server running on stdio');
}

/**
 * Stateless streamable-HTTP mode: one Server + transport pair per request.
 * Binds to localhost only — do not expose beyond the local machine (requests
 * use the server-configured Collibra credentials).
 */
async function runHttp(port: number): Promise<void> {
  const httpServer = createHttpServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed — stateless mode supports POST only.' }, id: null }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf-8');
      const parsedBody = raw ? JSON.parse(raw) : undefined;

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error('HTTP request handling failed:', (error as Error).message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }),
        );
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
  console.error(`Collibra MCP Server running on http://127.0.0.1:${port} (streamable HTTP, stateless, localhost only)`);
}

// Start the server
async function main() {
  const { enabled, port } = resolveHttpMode();
  if (enabled) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid HTTP port: ${port}`);
    }
    await runHttp(port);
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
