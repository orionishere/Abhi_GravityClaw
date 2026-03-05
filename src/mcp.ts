import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { config as appConfig } from "./config.js";

// Docker execution command wrapper
function createDockerCommand(image: string, command: string, args: string[], env: Record<string, string> = {}, extraVolumes: string[] = []): { command: string, args: string[] } {
    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(env)) {
        envArgs.push("-e", `${key}=${value}`);
    }

    const volumeArgs: string[] = [];
    for (const vol of extraVolumes) {
        volumeArgs.push("-v", vol);
    }

    return {
        command: "docker",
        args: [
            "run",
            "-i", // Critical: Keep STDIN open for the bridging protocol
            "--rm",
            "-v", `${appConfig.sandboxPath}:/sandbox`,
            ...volumeArgs,
            "-e", "npm_config_update_notifier=false", // Suppress breaking stdout notices
            ...envArgs,
            image,
            command,
            ...args.map(arg => arg
                .replace(appConfig.sandboxPath, "/sandbox")
                .replace(appConfig.obsidianPath, "/obsidian")
            )
        ]
    };
}

export const mcpServers: Record<string, { client: Client, transport: StdioClientTransport, tools: any[] }> = {};

export async function initMCPs() {
    // Ensure the sandbox directory exists
    const sandboxDir = appConfig.sandboxPath;
    if (!fs.existsSync(sandboxDir)) {
        fs.mkdirSync(sandboxDir, { recursive: true });
        console.log(`[MCP] Created sandbox directory at ${sandboxDir}`);
    }

    console.log(`[MCP] Initializing trusted server bridges...`);

    const skillsPath = path.join(appConfig.dataPath, "skills.json");
    if (!fs.existsSync(skillsPath)) {
        console.error(`[MCP] No skills.json found at ${skillsPath}`);
        return;
    }

    const skillsRaw = fs.readFileSync(skillsPath, 'utf8');
    let skillsConfig;
    try {
        skillsConfig = JSON.parse(skillsRaw);
    } catch (e) {
        console.error(`[MCP] Failed to parse skills.json`, e);
        return;
    }

    // Process each skill entry
    for (const skill of skillsConfig) {
        try {
            // Replace simple env mappings from process.env if they exist
            const resolvedEnv: Record<string, string> = {};
            if (skill.env) {
                for (const [k, v] of Object.entries(skill.env)) {
                    // Extremely basic variable interpolation for strings like "${GMAIL_USER}"
                    const matchedStr = String(v).match(/^\${(.*?)}$/);
                    if (matchedStr) {
                        resolvedEnv[k] = process.env[matchedStr[1]] || '';
                    } else {
                        resolvedEnv[k] = String(v);
                    }
                }
            }

            const dockerArgs = ["-y", skill.package];
            if (skill.args && Array.isArray(skill.args)) {
                dockerArgs.push(...skill.args);
            }

            const config = createDockerCommand(
                skill.image || "node:18",
                "npx",
                dockerArgs,
                resolvedEnv,
                skill.volumes || []
            );

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
            console.log(`[MCP] Connected to ${skill.name}. Loaded ${toolsList.tools.length} dynamic tools.`);

            mcpServers[skill.name] = {
                client,
                transport,
                tools: toolsList.tools
            };
        } catch (e: any) {
            console.error(`[MCP] Failed to initialize server ${skill.name}:`, e.message);
        }
    }
}

// Function to cleanly reload all MCP connections
export async function reloadMCPServers() {
    console.log(`[MCP] Shutting down existing connections to reload skills...`);
    for (const [name, instance] of Object.entries(mcpServers)) {
        try {
            await instance.transport.close();
        } catch (e) { /* ignore cleanup errors */ }
        delete mcpServers[name];
    }
    await initMCPs();
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

    // Debug: log raw result
    console.log(`[MCP-Debug] Raw result from ${serverName}/${actualToolName}:`, JSON.stringify(result).substring(0, 500));

    if (result.isError) {
        console.error(`[MCP] Tool '${actualToolName}' returned an error:`, result.content);
        return `MCP Tool Error: ${JSON.stringify(result.content)}`;
    }

    const resultContents = result.content as any[];
    if (resultContents && resultContents.length > 0) {
        return resultContents
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
    }

    return "MCP Tool execution completed with no output.";
}
