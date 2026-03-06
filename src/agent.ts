import OpenAI from 'openai';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { config } from './config.js';
import { tools as internalTools, executeTool as executeInternalTool } from './tools/index.js';
import { executeMCPTool, getMCPToolsSchema } from './mcp.js';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Security: Max iteration limit on the agent loop
const MAX_ITERATIONS = 15;

// Token optimization: Max characters for a single tool result
const MAX_TOOL_RESULT_LENGTH = 4000;

// Token optimization: Approximate token threshold for compaction
const COMPACTION_CHAR_THRESHOLD = 50000; // ~12,500 tokens

// ============================
// SMART ROUTING CONFIG
// ============================
type TaskTier = 'light' | 'analysis' | 'code';

const MODEL_MAP = {
    light: 'gemini-2.5-flash',
    analysis: 'gemini-3.1-pro-preview',
    code: 'o4-mini',
    vision: 'gpt-4o'
};

// Budget: max heavy calls per day
const HEAVY_BUDGET_PER_DAY = 10;
let heavyCallsToday = 0;
let budgetResetDate = new Date().toDateString();

function checkAndResetBudget(): void {
    const today = new Date().toDateString();
    if (today !== budgetResetDate) {
        heavyCallsToday = 0;
        budgetResetDate = today;
        console.log('[Router] Daily heavy-call budget reset.');
    }
}

function canUseHeavyModel(): boolean {
    checkAndResetBudget();
    return heavyCallsToday < HEAVY_BUDGET_PER_DAY;
}

function useHeavyCall(): void {
    heavyCallsToday++;
    console.log(`[Router] Heavy call used (${heavyCallsToday}/${HEAVY_BUDGET_PER_DAY} today).`);
}

// ============================
// TASK CLASSIFIER
// ============================
async function classifyTask(text: string): Promise<TaskTier> {
    // If budget is exhausted, always use light
    if (!canUseHeavyModel()) {
        console.log('[Router] Heavy budget exhausted. Routing to Flash.');
        return 'light';
    }

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are a task classifier. Given the user's message, respond with EXACTLY one word:
- "light" if the task is simple: greetings, questions, simple lookups, file listing, reading, checking status, reminders, scheduling
- "code" if the task involves writing code, building projects, debugging, creating scripts, programming
- "analysis" if the task involves complex reasoning, research, deep analysis, summarization of large data, strategic planning, comparing options

User message: "${text.substring(0, 500)}"

Classification:`
        });

        const classification = (result.text || '').trim().toLowerCase();

        if (classification.includes('code')) return 'code';
        if (classification.includes('analysis')) return 'analysis';
        return 'light';

    } catch (e: any) {
        console.error('[Router] Classification failed, defaulting to light:', e.message);
        return 'light';
    }
}

// ============================
// OBSIDIAN / SYSTEM PROMPT
// ============================
const OBSIDIAN_ROOT = config.obsidianPath;
const SOUL_PATH = path.join(OBSIDIAN_ROOT, 'SOUL.md');
const SKILLS_DIR = path.join(OBSIDIAN_ROOT, 'skills');

// Token usage tracker
let sessionTokenEstimate = 0;

function buildSystemPrompt(): string {
    let prompt = '';

    try {
        prompt += fs.readFileSync(SOUL_PATH, 'utf8');
    } catch {
        prompt += 'You are Gravity Claw, a personal AI agent. Use your tools to help the user. Do not ask for API keys.';
    }

    try {
        if (fs.existsSync(SKILLS_DIR)) {
            const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory());
            for (const dir of skillDirs) {
                const skillFile = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    const skillContent = fs.readFileSync(skillFile, 'utf8');
                    prompt += `\n\n---\n## Skill: ${dir.name}\n${skillContent}`;
                }
            }
        }
    } catch {
        // Skills are optional
    }

    return prompt;
}

// ============================
// TOOL HELPERS
// ============================
function getAllToolsForGemini() {
    const allTools = getAllToolsForOpenAI();
    return [{
        functionDeclarations: allTools.map(t => {
            const decl: FunctionDeclaration = {
                name: t.function.name,
                description: t.function.description || '',
                parameters: t.function.parameters as any
            };
            return decl;
        })
    }];
}

function getAllToolsForOpenAI(): OpenAI.Chat.ChatCompletionTool[] {
    const mcpTools = getMCPToolsSchema();
    return [...internalTools, ...mcpTools] as OpenAI.Chat.ChatCompletionTool[];
}

async function routeToolExecution(name: string, args: any): Promise<any> {
    if (name.startsWith('mcp__')) {
        return await executeMCPTool(name, args);
    } else {
        return await executeInternalTool(name, args);
    }
}

function truncateResult(result: any): string {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (text.length > MAX_TOOL_RESULT_LENGTH) {
        return text.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n...[truncated]';
    }
    return text;
}

function estimateHistoryChars(history: any[]): number {
    let total = 0;
    for (const msg of history) {
        if (typeof msg.content === 'string') {
            total += msg.content.length;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.text) total += part.text.length;
            }
        }
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                total += (tc.function?.arguments?.length || 0);
            }
        }
    }
    return total;
}

// ============================
// CONVERSATION COMPACTION
// ============================
const geminiHistory: any[] = [];

async function compactConversation(): Promise<void> {
    const charCount = estimateHistoryChars(geminiHistory);
    if (charCount < COMPACTION_CHAR_THRESHOLD) return;

    console.log(`[Compact] History is ${Math.round(charCount / 1000)}K chars. Compacting...`);

    const keepCount = Math.min(4, geminiHistory.length);
    const toSummarize = geminiHistory.slice(0, -keepCount);
    const toKeep = geminiHistory.slice(-keepCount);

    if (toSummarize.length === 0) return;

    let summaryInput = '';
    for (const msg of toSummarize) {
        const role = msg.role || 'unknown';
        const content = typeof msg.content === 'string' ? msg.content :
            Array.isArray(msg.content) ? msg.content.map((p: any) => p.text || '').join(' ') :
                JSON.stringify(msg.content || '');
        if (content.length > 0) {
            summaryInput += `[${role}]: ${content.substring(0, 500)}\n`;
        }
    }

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Summarize this conversation history in 2-3 concise sentences. Focus on what was discussed, what tools were used, and what was accomplished:\n\n${summaryInput.substring(0, 5000)}`
        });

        const summary = result.text || 'Previous conversation context.';
        console.log(`[Compact] Summarized ${toSummarize.length} messages → "${summary.substring(0, 100)}..."`);

        geminiHistory.length = 0;
        geminiHistory.push({ role: 'user', parts: [{ text: `[Prior conversation summary]: ${summary}` }] });
        geminiHistory.push({ role: 'model', parts: [{ text: 'Understood, I have context from our prior conversation.' }] });
        geminiHistory.push(...toKeep);

    } catch (e: any) {
        console.error('[Compact] Summarization failed:', e.message);
        geminiHistory.length = 0;
        geminiHistory.push(...toKeep);
    }
}

// Reset conversation (for /reset command)
export function resetConversation(): void {
    geminiHistory.length = 0;
    sessionTokenEstimate = 0;
    console.log('[Agent] Conversation history cleared.');
}

// ============================
// MAIN HANDLER — SMART ROUTING
// ============================
export interface MediaAttachment {
    type: 'image' | 'document';
    url: string;
    filename: string;
    localPath: string;
}

export async function handleUserMessage(text: string, attachments: MediaAttachment[] = []): Promise<string> {
    const imageAttachments = attachments.filter(a => a.type === 'image');
    const docAttachments = attachments.filter(a => a.type === 'document');

    // Route 1: Vision → GPT-4o
    if (imageAttachments.length > 0) {
        console.log(`[Router] 🎨 Vision detected → ${MODEL_MAP.vision}`);
        return await handleVisionMessage(text, imageAttachments, docAttachments);
    }

    // Build user message text
    let userText = text || '';
    if (docAttachments.length > 0) {
        const docList = docAttachments.map(d => `- ${d.filename} (saved at ${d.localPath})`).join('\n');
        userText += `\n\nThe user uploaded these files:\n${docList}\nUse your exec or filesystem tools to read/process them.`;
    }

    // Classify the task
    const tier = await classifyTask(userText);
    console.log(`[Router] Task classified as: ${tier.toUpperCase()} → ${MODEL_MAP[tier]}`);

    // Route based on tier
    if (tier === 'code') {
        useHeavyCall();
        return await handleCodeTask(userText);
    } else if (tier === 'analysis') {
        useHeavyCall();
        return await handleGeminiTask(userText, MODEL_MAP.analysis);
    } else {
        return await handleGeminiTask(userText, MODEL_MAP.light);
    }
}

// ============================
// GEMINI HANDLER (Flash + Pro)
// ============================
async function handleGeminiTask(userText: string, model: string): Promise<string> {
    await compactConversation();
    geminiHistory.push({ role: 'user', parts: [{ text: userText }] });

    let iterations = 0;
    const chat = ai.chats.create({
        model: model,
        config: {
            systemInstruction: buildSystemPrompt(),
            tools: getAllToolsForGemini()
        },
        history: geminiHistory.slice(0, -1)
    });

    while (iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`[Agent-${model}] Iteration ${iterations}/${MAX_ITERATIONS}...`);

        try {
            const inputMsg = iterations === 1
                ? { message: userText }
                : (geminiHistory[geminiHistory.length - 1] as any);

            const response = await chat.sendMessage(inputMsg);

            sessionTokenEstimate += Math.round((userText.length + (response.text?.length || 0)) / 4);

            if (response.functionCalls && response.functionCalls.length > 0) {
                const functionResponses = [];

                for (const call of response.functionCalls) {
                    console.log(`[Agent-${model}] Calling tool: ${call.name}`);
                    try {
                        const result = await routeToolExecution(call.name!, call.args);
                        const output = truncateResult(result);
                        functionResponses.push({
                            name: call.name!,
                            response: { result: output }
                        });
                    } catch (error: any) {
                        console.error(`[Agent-${model}] Tool error (${call.name}):`, error.message);
                        functionResponses.push({
                            name: call.name!,
                            response: { error: error.message }
                        });
                    }
                }

                const nextResponse = await chat.sendMessage({ message: functionResponses as any });

                if (!nextResponse.functionCalls || nextResponse.functionCalls.length === 0) {
                    const reply = nextResponse.text || 'Task completed.';
                    geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
                    console.log(`[Token] Session estimate: ~${sessionTokenEstimate} tokens`);
                    return reply;
                }
                continue;

            } else {
                const reply = response.text || 'No response generated.';
                geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
                console.log(`[Token] Session estimate: ~${sessionTokenEstimate} tokens`);
                return reply;
            }

        } catch (error: any) {
            console.error(`[Agent-${model}] Error:`, error.message);

            // If Pro fails, try Flash as fallback
            if (model !== MODEL_MAP.light) {
                console.log(`[Router] ${model} failed, falling back to Flash...`);
                geminiHistory.pop(); // Remove the user message we added
                return await handleGeminiTask(userText, MODEL_MAP.light);
            }

            return `Sorry, I encountered an error: ${error.message}`;
        }
    }

    return "Error: Exceeded maximum tool iterations. The agent was safely halted.";
}

// ============================
// OPENAI o4-mini HANDLER (Code)
// ============================
async function handleCodeTask(userText: string): Promise<string> {
    console.log(`[Agent-o4-mini] Processing code task...`);

    await compactConversation();
    geminiHistory.push({ role: 'user', parts: [{ text: userText }] });

    try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: userText }
        ];

        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            console.log(`[Agent-o4-mini] Iteration ${iterations}/${MAX_ITERATIONS}...`);

            const response = await openai.chat.completions.create({
                model: 'o4-mini',
                messages,
                // @ts-ignore
                tools: getAllToolsForOpenAI(),
                tool_choice: 'auto'
            });

            const choice = response.choices[0];
            const message = choice.message;
            messages.push(message);

            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    console.log(`[Agent-o4-mini] Calling tool: ${toolCall.function.name}`);
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        const result = await routeToolExecution(toolCall.function.name, args);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: truncateResult(result),
                        });
                    } catch (error: any) {
                        console.error(`[Agent-o4-mini] Tool error (${toolCall.function.name}):`, error.message);
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: `Error: ${error.message}`,
                        });
                    }
                }
                continue;
            }

            if (message.content) {
                geminiHistory.push({ role: 'model', parts: [{ text: message.content }] });
                console.log(`[Token] Session estimate: ~${sessionTokenEstimate} tokens`);
                return message.content;
            }

            return 'Code task completed with no output.';
        }

        return "Error: Exceeded maximum iterations on code task.";

    } catch (error: any) {
        console.error('[Agent-o4-mini] Error:', error.message);

        // Fallback: if o4-mini fails, try Gemini Pro
        console.log('[Router] o4-mini failed, falling back to Gemini Pro...');
        geminiHistory.pop(); // Remove user message we added
        return await handleGeminiTask(userText, MODEL_MAP.analysis);
    }
}

// ============================
// OPENAI VISION HANDLER (GPT-4o)
// ============================
async function handleVisionMessage(text: string, images: MediaAttachment[], docs: MediaAttachment[]): Promise<string> {
    console.log('[Agent-GPT4o] Processing vision task...');

    const contentParts: any[] = [];

    let textContent = text || '';
    if (docs.length > 0) {
        const docList = docs.map(d => `- ${d.filename} (saved at ${d.localPath})`).join('\n');
        textContent += `\n\nThe user uploaded these files:\n${docList}\nUse your exec or filesystem tools to read/process them.`;
    }
    if (textContent) {
        contentParts.push({ type: 'text', text: textContent });
    }
    for (const img of images) {
        contentParts.push({
            type: 'image_url',
            image_url: { url: img.url, detail: 'auto' }
        });
    }

    try {
        const response = await openai.chat.completions.create({
            model: MODEL_MAP.vision,
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: contentParts }
            ],
            max_tokens: 1000
        });

        const reply = response.choices[0]?.message?.content || 'I can see the image but generated no response.';
        geminiHistory.push({ role: 'user', parts: [{ text: text || 'User sent an image.' }] });
        geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
        return reply;
    } catch (e: any) {
        return `Vision processing error: ${e.message}`;
    }
}

// Exported for heartbeat (always uses Flash)
export async function handleHeartbeatTask(text: string): Promise<string> {
    console.log('[Heartbeat] Using Gemini Flash for scheduled task...');
    return await handleGeminiTask(text, MODEL_MAP.light);
}
