import OpenAI from 'openai';
import { config } from '../config.js';
import { tools as internalTools, executeTool as executeInternalTool } from './index.js';
import { executeMCPTool, getMCPToolsSchema } from '../mcp.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Sub-agent iteration limit (tighter than parent's 15)
const SUB_AGENT_MAX_ITERATIONS = 5;

// Tool Schema
export const delegateSchema = {
    type: 'function',
    function: {
        name: 'delegate',
        description: 'Delegate a focused sub-task to a sub-agent. The sub-agent gets its own isolated conversation, tool access, and a 5-iteration limit. Use this for complex research, multi-step data gathering, or any task that benefits from focused execution. The sub-agent CANNOT delegate further (depth limit of 1).',
        parameters: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'A clear, specific task description for the sub-agent (e.g., "Use browser_navigate to find the current stock prices of AAPL, MSFT, and GOOGL from Yahoo Finance")'
                },
                context: {
                    type: 'string',
                    description: 'Optional context or background info the sub-agent needs to complete the task'
                }
            },
            required: ['task'],
            additionalProperties: false
        }
    }
};

// Helper to get all tools EXCEPT delegate (prevents recursive delegation)
function getSubAgentTools(): OpenAI.Chat.ChatCompletionTool[] {
    const mcpTools = getMCPToolsSchema();
    // Include all internal tools EXCEPT delegate itself
    const safeInternalTools = internalTools.filter((t: any) => t.function.name !== 'delegate');
    return [...safeInternalTools, ...mcpTools] as OpenAI.Chat.ChatCompletionTool[];
}

// Sub-agent tool execution router (same as parent, minus delegate)
async function routeSubAgentTool(name: string, args: any): Promise<any> {
    if (name.startsWith('mcp__')) {
        return await executeMCPTool(name, args);
    } else if (name !== 'delegate') {
        return await executeInternalTool(name, args);
    } else {
        return 'Error: Sub-agents cannot delegate further. Depth limit reached.';
    }
}

// Main executor
export async function delegate(args: any): Promise<string> {
    const { task, context } = args;

    console.log(`[Swarm] Spawning sub-agent for task: "${task.substring(0, 80)}..."`);

    const subAgentPrompt = `You are a focused sub-agent of Gravity Claw. You have been delegated a specific task.
Your job is to complete the task using your available tools and return a clear, complete result.
You have a maximum of ${SUB_AGENT_MAX_ITERATIONS} tool-call iterations. Be efficient.
You CANNOT use the delegate tool — you must do the work yourself.
Do NOT ask for clarification. Do your best with the information provided.

${context ? `Context: ${context}\n` : ''}
Task: ${task}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: subAgentPrompt },
        { role: 'user', content: task }
    ];

    const tools = getSubAgentTools();
    let iterations = 0;

    while (iterations < SUB_AGENT_MAX_ITERATIONS) {
        iterations++;
        console.log(`[Swarm] Sub-agent iteration ${iterations}/${SUB_AGENT_MAX_ITERATIONS}...`);

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages,
                // @ts-ignore
                tools,
                tool_choice: 'auto'
            });

            const choice = response.choices[0];
            const message = choice.message;

            messages.push(message);

            // If the sub-agent wants to call tools
            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    console.log(`[Swarm] Sub-agent calling tool: ${toolCall.function.name}`);
                    try {
                        const toolArgs = JSON.parse(toolCall.function.arguments);
                        const result = await routeSubAgentTool(toolCall.function.name, toolArgs);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        });
                    } catch (error: any) {
                        console.error(`[Swarm] Sub-agent tool error (${toolCall.function.name}):`, error.message);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: `Error: ${error.message}`,
                        });
                    }
                }
                continue;
            }

            // Sub-agent returned a final text response
            if (message.content) {
                console.log(`[Swarm] Sub-agent completed task in ${iterations} iteration(s).`);
                return `[Sub-agent result]\n${message.content}`;
            }

            return '[Sub-agent completed with no output]';

        } catch (error: any) {
            console.error(`[Swarm] Sub-agent error:`, error.message);
            return `[Sub-agent error] ${error.message}`;
        }
    }

    return '[Sub-agent reached iteration limit without completing the task]';
}
