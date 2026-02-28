import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";

// Hardcoded explicit list of MCP servers we trust and want to run
// For Level 4, we will configure a basic filesystem/shell MCP as requested
export const mcpConfig = {
    servers: {
        // We will install an executable sqlite/filesystem/shell provider later if requested,
        // For now, this is the architecture to mount a local shell MCP safely
        "filesystem-mcp": {
            command: "npx",
            args: [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "/Users/abhismac/Desktop/GravityClaw"
            ],
            // Note: Securely restricts access to the bot's own root directory
        }
    }
};

interface MCPServerInstance {
    client: Client;
    tools: any[];
}

export const mcpServers: Record<string, MCPServerInstance> = {};

export async function initMCPs() {
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
                    name: `mcp__${serverName}__${tool.name}`, // Namespaced to prevent collision
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

    // MCP servers return standard content blocks (text/image)
    const resultContents = result.content as any[];
    if (resultContents && resultContents.length > 0) {
        // Merge text blocks back into a string for our LLM context
        return resultContents
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
    }

    return result.isError ? "MCP Execution resulted in an error." : "MCP Tool execution completed with no output.";
}
