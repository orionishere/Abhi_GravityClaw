import OpenAI from 'openai';
import { GoogleGenAI, FunctionDeclaration } from '@google/genai';
import { config } from '../config.js';
import { tools as internalTools, executeTool as executeInternalTool } from './index.js';
import { executeMCPTool, getMCPToolsSchema } from '../mcp.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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
    const safeInternalTools = internalTools.filter((t: any) => t.function.name !== 'delegate');
    return [...safeInternalTools, ...mcpTools] as OpenAI.Chat.ChatCompletionTool[];
}

// Convert tools to Gemini format
function getSubAgentToolsForGemini() {
    return [{
        functionDeclarations: getSubAgentTools().map(t => {
            const decl: FunctionDeclaration = {
                name: t.function.name,
                description: t.function.description || '',
                parameters: t.function.parameters as any
            };
            return decl;
        })
    }];
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

// Gemini-based sub-agent (fallback when OpenAI is rate-limited)
async function delegateViaGemini(subAgentPrompt: string, task: string): Promise<string> {
    console.log('[Swarm] Switching sub-agent to Gemini fallback...');

    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: subAgentPrompt,
            tools: getSubAgentToolsForGemini()
        }
    });

    let iterations = 0;
    let nextInput: any = { message: task };

    while (iterations < SUB_AGENT_MAX_ITERATIONS) {
        iterations++;
        console.log(`[Swarm-Gemini] Sub-agent iteration ${iterations}/${SUB_AGENT_MAX_ITERATIONS}...`);

        try {
            const response = await chat.sendMessage(nextInput);

            if (response.functionCalls && response.functionCalls.length > 0) {
                const functionResponses = [];

                for (const call of response.functionCalls) {
                    console.log(`[Swarm-Gemini] Sub-agent calling tool: ${call.name}`);
                    try {
                        const result = await routeSubAgentTool(call.name!, call.args);
                        const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                        functionResponses.push({
                            name: call.name!,
                            response: { result: output }
                        });
                    } catch (error: any) {
                        console.error(`[Swarm-Gemini] Sub-agent tool error (${call.name}):`, error.message);
                        functionResponses.push({
                            name: call.name!,
                            response: { error: error.message }
                        });
                    }
                }

                nextInput = { message: functionResponses };
                continue;
            } else {
                const text = response.text || '[Sub-agent completed with no output]';
                console.log(`[Swarm-Gemini] Sub-agent completed task in ${iterations} iteration(s).`);
                return `[Sub-agent result (Gemini)]\n${text}`;
            }

        } catch (error: any) {
            console.error('[Swarm-Gemini] Sub-agent error:', error.message);
            return `[Sub-agent error (Gemini)] ${error.message}`;
        }
    }

    return '[Sub-agent reached iteration limit without completing the task]';
}

// Main executor — uses Gemini directly (token-efficient)
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

    // Sub-agents always use Gemini (free, no token cost)
    return await delegateViaGemini(subAgentPrompt, task);
}

