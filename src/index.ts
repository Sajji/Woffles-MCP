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
import { readFileSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import { loadConfig, getInstances, isReadOnly, getPlaintextPasswordInstances, getConfiguredSecrets, getCompliancePosture, getComplianceWarnings, getAuditSettings } from './config.js';
import { redactSecrets } from './utils/secrets.js';
import { failureMessage } from './utils/tool-result.js';

const PKG: { name: string; version: string } = (() => {
  try {
    const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return { name: p.name, version: p.version };
  } catch {
    return { name: 'collibra-mcp-server', version: '0.0.0' };
  }
})();

// Initialize configuration (must happen before constructing the server so we
// can publish the warning via the MCP `instructions` field).
try {
  loadConfig();
} catch (error) {
  console.error('✗ Failed to load configuration:', (error as Error).message);
  process.exit(1);
}

// Imported only after config validation: the registry reads config at import time.
const { tools, executeTool } = await import('./tools/index.js');

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
      name: PKG.name,
      title: 'Woffles MCP Server for Collibra',
      version: PKG.version,
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
      instructions:
        'Most tools take an "instance_name" argument identifying a configured Collibra instance. ' +
        'Call get_instances first (no arguments) to discover the valid instance names. ' +
        'A result with isError=true means the call failed; read its message before retrying. ' +
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
      const secrets = getConfiguredSecrets();
      const text = redactSecrets(result.text, secrets);

      const response: any = {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
      // Tools report most failures as a structured payload rather than throwing;
      // flag them so clients and agents can tell a failed call from a successful one.
      if (failureMessage(result) !== undefined) response.isError = true;

      // Emit MCP structuredContent when the tool produced a structured payload.
      if (result.structured !== undefined) {
        const json = JSON.stringify(result.structured);
        const redacted = redactSecrets(json, secrets);
        response.structuredContent = redacted === json ? result.structured : JSON.parse(redacted);
        validateStructured(name, response.structuredContent);
      }

      return response;
    } catch (error) {
      const text = JSON.stringify({
        error: true,
        message: (error as Error).message,
        tool: name,
        arguments: args,
      }, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: redactSecrets(text, getConfiguredSecrets()),
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
      console.error(`  ⚠ WARNING: TLS certificate verification is DISABLED for "${instance.name}" (insecure: true) — do not use in production. Prefer tls.caFile.`);
    }
  });
  const plaintext = getPlaintextPasswordInstances();
  if (plaintext.length) {
    console.error(
      `  ⚠ WARNING: plaintext password in config.json for: ${plaintext.join(', ')}. ` +
        'Use a secret reference instead: "${env:NAME}", "${file:/path}" or "${keychain:target}".',
    );
  }
  const posture = getCompliancePosture();
  if (posture.mode) {
    console.error(`✓ Compliance mode: ${posture.mode} (audit: on${posture.audit.logReads ? ', including reads' : ''}; FIPS: ${posture.fips ? 'on' : 'off'})`);
  }
  for (const w of getComplianceWarnings()) console.error(`  ⚠ COMPLIANCE: ${w}`);
  const audit = getAuditSettings();
  if (audit.enabled) console.error(`✓ Audit log: ${audit.path}`);
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
  // DNS-rebinding protection: a malicious web page can resolve its own hostname
  // to 127.0.0.1 and drive this server from the browser. Only accept requests
  // addressed to a loopback host, and browser requests from a loopback origin.
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const allowedOrigins = allowedHosts.map((h) => `http://${h}`);
  const token = loadConfig().http?.token;
  const jsonError = (res: any, status: number, code: number, message: string) =>
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));

  const httpServer = createHttpServer(async (req, res) => {
    try {
      if (!allowedHosts.includes(req.headers.host ?? '')) {
        return jsonError(res, 403, -32000, 'Forbidden: invalid Host header.');
      }
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        return jsonError(res, 403, -32000, 'Forbidden: invalid Origin header.');
      }
      if (token && !bearerMatches(req.headers.authorization, token)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return jsonError(res, 401, -32001, 'Unauthorized: a valid bearer token is required.');
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed — stateless mode supports POST only.' }, id: null }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf-8');
      let parsedBody: unknown;
      try {
        parsedBody = raw ? JSON.parse(raw) : undefined;
      } catch {
        return jsonError(res, 400, -32700, 'Parse error: request body is not valid JSON.');
      }

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts,
        allowedOrigins,
      });
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
  console.error(
    `Collibra MCP Server running on http://127.0.0.1:${port} (streamable HTTP, stateless, localhost only` +
      `${token ? ', bearer token required' : ''})`,
  );
}

/** Constant-time comparison of an `Authorization: Bearer <token>` header. */
function bearerMatches(header: string | undefined, token: string): boolean {
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '', 'utf-8');
  const expected = Buffer.from(token, 'utf-8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
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
