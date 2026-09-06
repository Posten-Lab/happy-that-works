/**
 * Talos MCP server
 * Provides Talos CLI specific tools including chat session title management
 *
 * Uses stateless StreamableHTTP: each request gets a fresh McpServer + transport.
 * This is required by MCP SDK >=1.27 which rejects reuse of an already-connected transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { detectSupportedImageType } from "@/codex/utils/imageInput";

const MAX_PUBLISHED_IMAGE_BYTES = 10 * 1024 * 1024;

export async function publishLocalImage(client: ApiSessionClient, path: string, alt?: string) {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
        throw new Error('Image path is not a file');
    }
    if (fileStat.size > MAX_PUBLISHED_IMAGE_BYTES) {
        throw new Error('Image exceeds the 10 MB attachment limit');
    }

    const data = new Uint8Array(await readFile(path));
    const detected = detectSupportedImageType(data);
    if (!detected) {
        throw new Error('Only PNG, JPEG, GIF, and WebP images can be published');
    }

    const envelope = await client.uploadLocalImageAttachmentEnvelope({
        data,
        mimeType: detected.mimeType,
        name: alt?.trim() || basename(path),
    }, {}, 'agent');
    client.sendSessionProtocolMessage(envelope);
    return envelope;
}

function createMcpServer(
    titleHandler: (title: string) => Promise<{ success: boolean; error?: string }>,
    imageHandler: (path: string, alt?: string) => Promise<void>,
): McpServer {
    const mcp = new McpServer({
        name: "Talos MCP",
        version: "1.0.0",
    });

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
            title: z.string().describe('The new title for the chat session'),
        },
    }, async (args) => {
        const response = await titleHandler(args.title);
        logger.debug('[talosMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('present_image', {
        description: 'Publish a local image into the current Talos chat so remote clients can load it. Use this instead of Markdown image links for local files or private/authenticated URLs.',
        title: 'Present Image',
        inputSchema: {
            path: z.string().describe('Absolute path to a local PNG, JPEG, GIF, or WebP image'),
            alt: z.string().optional().describe('Optional accessible image label'),
        },
    }, async (args) => {
        try {
            await imageHandler(args.path, args.alt);
            return {
                content: [{ type: 'text', text: `Published image: ${args.alt?.trim() || basename(args.path)}` }],
                isError: false,
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Failed to publish image: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });

    return mcp;
}

export async function startTalosServer(client: ApiSessionClient) {
    logger.debug(`[talosMCP] server:start sessionId=${client.sessionId}`);

    const titleHandler = async (title: string) => {
        logger.debug('[talosMCP] Changing title to:', title);
        try {
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };
    const imageHandler = async (path: string, alt?: string) => {
        await publishLocalImage(client, path, alt);
    };

    const server = createServer(async (req, res) => {
        const mcp = createMcpServer(titleHandler, imageHandler);
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
            res.on('close', () => {
                transport.close();
                mcp.close();
            });
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
            mcp.close();
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[talosMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title', 'present_image'],
        stop: () => {
            logger.debug(`[talosMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    }
}
