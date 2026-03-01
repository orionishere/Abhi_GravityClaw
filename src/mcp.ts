import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

// Docker execution command wrapper
function createDockerCommand(command: string, args: string[]): { command: string, args: string[] } {
    return {
        command: "docker",
        args: [
            "run",
            "--rm",
            "-v", "/Users/abhismac/Desktop/GravityClaw/data/sandbox:/sandbox",
            "node:18-alpine", // Using Node.js alpine image for npx
            "/bin/sh", "-c",
            `${[command, ...args.map(arg => arg.replace("/Users/abhismac/Desktop/GravityClaw/data/sandbox", "/sandbox"))].join(' ')}`
        ]
    };
}

// Hardcoded explicit list of MCP servers we trust and want to run
export const mcpConfig = {
    servers: {
        "filesystem-mcp": createDockerCommand("npx", [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "/sandbox"
        ]),
    }
};

interface MCPServerInstance {
    client: Client;
    tools: any[];
}

export const mcpServers: Record<string, MCPServerInstance> = {};

export async function initMCPs() {
    // Ensure the sandbox directory exists
    const sandboxDir = "/Users/abhismac/Desktop/GravityClaw/data/sandbox";
    if (!fs.existsSync(sandboxDir)) {
        fs.mkdirSync(sandboxDir, { recursive: true });
        console.log(`[MCP] Created sandbox directory at ${sandboxDir}`);
    }

    console.log(`[MCP] Initializing trusted server bridges...`);

    for (const [serverName, config] of Object.entries(mcpConfig.servers)) {
        try {
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args
            });

            const client = new Client(
                { name: "gravity-claw-host", version: "1.0.0" },
                { capabilities: {} }
            );

            await client.connect(transport);

            // Fetch available tools from this MCP server
            const toolsList = await client.listTools();
            console.log(`[MCP] Connected to ${serverName}. Loaded ${toolsList.tools.length} dynamic tools.`);

            mcpServers[serverName] = {
                client,
                tools: toolsList.tools
            };
        } catch (e: any) {
            console.error(`[MCP] Failed to initialize server ${serverName}:`, e.message);
        }
    }
}

// Transform MCP tools into OpenAI schema format
export function getMCPToolsSchema(): OpenAI.Chat.ChatCompletionTool[] {
    const allTools: OpenAI.Chat.ChatCompletionTool[] = [];

    for (const [serverName, instance] of Object.entries(mcpServers)) {
        for (const tool of instance.tools) {
            allTools.push({
                type: 'function' as const,
                function: {
                    name: `mcp__${serverName}__${tool.name}`,
                    description: tool.description || `Dynamic MCP Tool from ${serverName}`,
                    parameters: tool.inputSchema as any
                }
            });
        }
    }

    return allTools;
}

// Route a specific namespaced tool call back to the correct MCP server transport
export async function executeMCPTool(namespacedName: string, args: any): Promise<any> {
    const rawParts = namespacedName.split('__');
    if (rawParts.length !== 3 || rawParts[0] !== 'mcp') {
        throw new Error(`Invalid MCP tool namespace format: ${namespacedName}`);
    }

    const serverName = rawParts[1];
    const actualToolName = rawParts[2];

    const instance = mcpServers[serverName];
    if (!instance) {
        throw new Error(`Target MCP server '${serverName}' is not running or connected.`);
    }

    console.log(`[MCP] proxying tool '${actualToolName}' to server '${serverName}'`);
    const result = await instance.client.callTool({
        name: actualToolName,
        arguments: args
    });

    const resultContents = result.content as any[];
    if (resultContents && resultContents.length > 0) {
        return resultContents
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
    }

    return result.isError ? "MCP Execution resulted in an error." : "MCP Tool execution completed with no output.";
}
