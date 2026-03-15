import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { getModel } from '../modelSelector.js';
import { tools as internalTools, executeTool as executeInternalTool } from './index.js';
import { executeMCPTool, getMCPToolsSchema } from '../mcp.js';

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Sub-agents are intentionally capped at lighter models (never Opus/Sonnet)
const SUB_AGENT_MAX_ITERATIONS = 5;

export const delegateSchema = {
    type: 'function',
    function: {
        name: 'delegate',
        description: 'Delegate a focused sub-task to a sub-agent. The sub-agent gets its own isolated conversation, full tool access, and a 5-iteration limit. Use this for complex research, multi-step data gathering, or any task that benefits from focused execution. The sub-agent CANNOT delegate further (depth limit of 1).',
        parameters: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'A clear, specific task description for the sub-agent'
                },
                context: {
                    type: 'string',
                    description: 'Optional background info the sub-agent needs'
                }
            },
            required: ['task'],
            additionalProperties: false
        }
    }
};

// ============================
// TOOL HELPERS
// ============================

function getSubAgentToolsOpenAI(): OpenAI.Chat.ChatCompletionTool[] {
    const safeInternalTools = internalTools.filter((t: any) => t.function.name !== 'delegate');
    return [...safeInternalTools, ...getMCPToolsSchema()] as OpenAI.Chat.ChatCompletionTool[];
}

function getSubAgentToolsAnthropic(): Anthropic.Tool[] {
    return getSubAgentToolsOpenAI().map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: (t.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool['input_schema']
    }));
}

function getSubAgentToolsGemini() {
    return [{
        functionDeclarations: getSubAgentToolsOpenAI().map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters as any
        }))
    }];
}

async function routeSubAgentTool(name: string, args: any): Promise<any> {
    if (name === 'delegate') return 'Error: Sub-agents cannot delegate further.';
    return name.startsWith('mcp__') ? await executeMCPTool(name, args) : await executeInternalTool(name, args);
}

function truncate(result: any): string {
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return text.length > 4000 ? text.substring(0, 4000) + '...[truncated]' : text;
}

// ============================
// SUB-AGENT: CLAUDE HAIKU (Primary)
// ============================
async function delegateViaClaude(prompt: string, task: string): Promise<string> {
    console.log('[Swarm] Sub-agent using Claude Haiku...');
    const tools = getSubAgentToolsAnthropic();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }];
    let iterations = 0;

    while (iterations < SUB_AGENT_MAX_ITERATIONS) {
        iterations++;
        console.log(`[Swarm-Claude] Iteration ${iterations}/${SUB_AGENT_MAX_ITERATIONS}...`);

        const response = await anthropic.messages.create({
            model: getModel('anthropic', 'heartbeat'), // Haiku — never use Opus for sub-agents
            max_tokens: 4096,
            system: prompt,
            tools,
            messages
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;
                console.log(`[Swarm-Claude] Tool: ${block.name}`);
                try {
                    const result = await routeSubAgentTool(block.name, block.input);
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: truncate(result) });
                } catch (e: any) {
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
                }
            }
            messages.push({ role: 'user', content: toolResults });
            continue;
        }

        const reply = response.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
        console.log(`[Swarm-Claude] Completed in ${iterations} iteration(s).`);
        return `[Sub-agent result]\n${reply}`;
    }
    return '[Sub-agent reached iteration limit]';
}

// ============================
// SUB-AGENT: OPENAI (Fallback 1)
// ============================
async function delegateViaOpenAI(prompt: string, task: string): Promise<string> {
    console.log('[Swarm] Sub-agent falling back to OpenAI gpt-4o-mini...');
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: prompt },
        { role: 'user', content: task }
    ];
    let iterations = 0;

    while (iterations < SUB_AGENT_MAX_ITERATIONS) {
        iterations++;
        const response = await openai.chat.completions.create({
            model: getModel('openai', 'heartbeat'), // gpt-4o-mini — corresponds to Haiku
            messages,
            // @ts-ignore
            tools: getSubAgentToolsOpenAI(),
            tool_choice: 'auto'
        });

        const message = response.choices[0].message;
        messages.push(message);

        if (message.tool_calls?.length) {
            for (const tc of message.tool_calls) {
                console.log(`[Swarm-OpenAI] Tool: ${tc.function.name}`);
                try {
                    const result = await routeSubAgentTool(tc.function.name, JSON.parse(tc.function.arguments));
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: truncate(result) });
                } catch (e: any) {
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${e.message}` });
                }
            }
            continue;
        }

        if (message.content) {
            return `[Sub-agent result (OpenAI)]\n${message.content}`;
        }
        return '[Sub-agent completed with no output]';
    }
    return '[Sub-agent reached iteration limit]';
}

// ============================
// SUB-AGENT: GEMINI FLASH (Fallback 2)
// ============================
async function delegateViaGemini(prompt: string, task: string): Promise<string> {
    console.log('[Swarm] Sub-agent falling back to Gemini Flash...');
    const chat = gemini.chats.create({
        model: getModel('gemini', 'heartbeat'), // Flash — corresponds to Haiku
        config: { systemInstruction: prompt, tools: getSubAgentToolsGemini() }
    });

    let iterations = 0;
    let nextInput: any = { message: task };

    while (iterations < SUB_AGENT_MAX_ITERATIONS) {
        iterations++;
        const response = await chat.sendMessage(nextInput);

        if (response.functionCalls?.length) {
            const functionResponses = [];
            for (const call of response.functionCalls) {
                console.log(`[Swarm-Gemini] Tool: ${call.name}`);
                try {
                    const result = await routeSubAgentTool(call.name!, call.args);
                    functionResponses.push({ name: call.name!, response: { result: truncate(result) } });
                } catch (e: any) {
                    functionResponses.push({ name: call.name!, response: { error: e.message } });
                }
            }
            nextInput = { message: functionResponses.map((r: any) => ({ functionResponse: r })) };
            continue;
        }

        const text = response.text || '[Sub-agent completed with no output]';
        return `[Sub-agent result (Gemini)]\n${text}`;
    }
    return '[Sub-agent reached iteration limit]';
}

// ============================
// MAIN DELEGATE EXECUTOR
// ============================
export async function delegate(args: any): Promise<string> {
    const { task, context } = args;
    console.log(`[Swarm] Spawning sub-agent: "${task.substring(0, 80)}..."`);

    const subAgentPrompt = `You are a focused sub-agent of Gravity Claw delegated to complete a specific task.
Complete the task using your available tools and return a clear, complete result.
You have a maximum of ${SUB_AGENT_MAX_ITERATIONS} tool-call iterations. Be efficient.
You CANNOT use the delegate tool — do the work yourself.
Do NOT ask for clarification. Do your best with the information provided.

${context ? `Context: ${context}\n` : ''}Task: ${task}`;

    // 1️⃣ Try Claude Haiku
    if (config.anthropicApiKey) {
        try { return await delegateViaClaude(subAgentPrompt, task); }
        catch (e: any) {
            const isRateLimit = (e?.message || '').toLowerCase().includes('429') || (e?.message || '').toLowerCase().includes('overloaded');
            console.error(`[Swarm] Claude sub-agent failed${isRateLimit ? ' (rate limited)' : ''}:`, e.message);
        }
    }

    // 2️⃣ Try OpenAI gpt-4o-mini
    try { return await delegateViaOpenAI(subAgentPrompt, task); }
    catch (e: any) { console.error('[Swarm] OpenAI sub-agent failed:', e.message); }

    // 3️⃣ Try Gemini Flash
    try { return await delegateViaGemini(subAgentPrompt, task); }
    catch (e: any) { return `[Sub-agent failed on all providers: ${e.message}]`; }
}
