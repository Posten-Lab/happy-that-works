/**
 * Talos MCP STDIO Bridge
 *
 * Minimal STDIO MCP server exposing Talos's session tools.
 * On invocation it forwards the tool call to an existing Talos HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `TALOS_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { findMuseSessionBridge } from '@/muse/museSessionBridge';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

async function main() {
  // Resolve target HTTP MCP URL
  const { url: urlFromArgs } = parseArgs(process.argv.slice(2));
  const museSession = process.argv.includes('--muse-session');
  const baseUrl = museSession ? await findMuseSessionBridge() : urlFromArgs || process.env.TALOS_HTTP_MCP_URL || '';

  if (!baseUrl && !museSession) {
    // Write to stderr; never stdout.
    process.stderr.write(
      '[talos-mcp] Missing target URL. Set TALOS_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
    );
    process.exit(2);
  }

  let httpClient: Client | null = null;

  async function ensureHttpClient(): Promise<Client> {
    if (httpClient) return httpClient;
    const client = new Client(
      { name: 'talos-stdio-bridge', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl!));
    await client.connect(transport);
    httpClient = client;
    return client;
  }

  // Native harnesses can invoke the same tools when a resumed MCP catalog is unavailable.
  const callIndex = process.argv.indexOf('--call');
  if (callIndex !== -1) {
    const name = process.argv[callIndex + 1];
    if (!['change_title', 'present_image'].includes(name)) throw new Error('Unknown Talos session tool');
    if (!baseUrl) throw new Error('No launching Talos session found');
    const argumentsIndex = process.argv.indexOf('--arguments');
    if (argumentsIndex === -1) throw new Error('Pass tool arguments as JSON with --arguments');
    const args = JSON.parse(process.argv[argumentsIndex + 1]);
    const client = await ensureHttpClient();
    try {
      const response = await client.callTool({ name, arguments: args });
      process.stdout.write(`${JSON.stringify(response)}\n`);
      if (response.isError) process.exitCode = 1;
    } finally { await client.close(); }
    return;
  }

  // Create STDIO MCP server
  const server = new McpServer({
    name: 'Talos MCP Bridge',
    version: '1.0.0',
  }, { capabilities: { tools: {} } });
  if (!baseUrl) server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

  // Register the single tool and forward to HTTP MCP
  if (baseUrl) server.registerTool(
    'change_title',
    {
      description: 'Change the title of the current Talos chat session. Call at the start of a new conversation with a concise title matching the task, when the topic changes substantially, or whenever the user asks to rename this chat.',
      title: 'Change Chat Title',
      inputSchema: {
        title: z.string().describe('The new title for the chat session'),
      },
    },
    async (args) => {
      try {
        const client = await ensureHttpClient();
        const response = await client.callTool({ name: 'change_title', arguments: args });
        // Pass-through response from HTTP server
        return response as any;
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Failed to change chat title: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    }
  );

  if (baseUrl) server.registerTool(
    'present_image',
    {
      description: 'Publish a local image into the current Talos chat so remote clients can load it. Use this instead of Markdown image links for local files or private/authenticated URLs.',
      title: 'Present Image',
      inputSchema: {
        path: z.string().describe('Absolute path to a local PNG, JPEG, GIF, or WebP image'),
        alt: z.string().optional().describe('Optional accessible image label'),
      },
    },
    async (args) => {
      try {
        const client = await ensureHttpClient();
        return await client.callTool({ name: 'present_image', arguments: args }) as any;
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Failed to publish image: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Start STDIO transport
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

// Start and surface fatal errors to stderr only
main().catch((err) => {
  try {
    process.stderr.write(`[talos-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.exit(1);
  }
});
