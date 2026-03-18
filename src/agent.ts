import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, FunctionDeclaration } from '@google/genai';
import { config } from './config.js';
import { getModel } from './modelSelector.js';
import { tools as internalTools, executeTool as executeInternalTool } from './tools/index.js';
import { executeMCPTool, getMCPToolsSchema } from './mcp.js';
import { getPreconsciousBuffer } from './observe.js';
import fs from 'fs';
import path from 'path';

// ============================
// CLIENTS
// ============================
const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ============================
// CONSTANTS
// ============================
// Dynamic iteration limit — complex tasks get more room
function getMaxIterations(tier: TaskTier): number {
    switch (tier) {
        case 'analysis': return 30;  // deep research, multi-step reasoning
        case 'code':     return 30;  // multi-file projects, debugging cycles
        case 'light':    return 15;  // general questions, lookups
        case 'heartbeat':return 10;  // quick background tasks
        default:         return 15;
    }
}
const MAX_TOOL_RESULT_LENGTH = 4000;
const COMPACTION_CHAR_THRESHOLD = 50000;

// ============================
// TIER ROUTING
// ============================
type TaskTier = 'analysis' | 'code' | 'light' | 'heartbeat';

// MODEL_MAP reads live from modelSelector (auto-discovers best available models)
// Env-var overrides in .env always win. Falls back to hardcoded defaults.
function getModelMap() {
    return {
        claude: {
            analysis:  getModel('anthropic', 'analysis'),
            code:      getModel('anthropic', 'code'),
            light:     getModel('anthropic', 'light'),
            heartbeat: getModel('anthropic', 'heartbeat'),
        },
        openai: {
            analysis:  getModel('openai', 'analysis'),
            code:      getModel('openai', 'code'),
            light:     getModel('openai', 'light'),
            heartbeat: getModel('openai', 'heartbeat'),
        },
        gemini: {
            analysis:  getModel('gemini', 'analysis'),
            code:      getModel('gemini', 'code'),
            light:     getModel('gemini', 'light'),
            heartbeat: getModel('gemini', 'heartbeat'),
        }
    };
}

// ============================
// BUDGET (heavy model cap)
// ============================
const BUDGET_FILE = path.join(config.dataPath, 'budget.json');

function loadBudget(): { heavyCallsToday: number; budgetResetDate: string } {
    try {
        if (fs.existsSync(BUDGET_FILE)) return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
    } catch { }
    return { heavyCallsToday: 0, budgetResetDate: new Date().toDateString() };
}

function saveBudget(): void {
    try { fs.writeFileSync(BUDGET_FILE, JSON.stringify({ heavyCallsToday, budgetResetDate })); } catch { }
}

const HEAVY_BUDGET_PER_DAY = 10;
const _saved = loadBudget();
let heavyCallsToday = _saved.heavyCallsToday;
let budgetResetDate = _saved.budgetResetDate;

function checkAndResetBudget(): void {
    const today = new Date().toDateString();
    if (today !== budgetResetDate) { heavyCallsToday = 0; budgetResetDate = today; saveBudget(); }
}

function canUseHeavyModel(): boolean { checkAndResetBudget(); return heavyCallsToday < HEAVY_BUDGET_PER_DAY; }
function useHeavyCall(): void { heavyCallsToday++; saveBudget(); console.log(`[Router] Heavy call used (${heavyCallsToday}/${HEAVY_BUDGET_PER_DAY} today).`); }

// ============================
// CIRCUIT BREAKERS
// ============================
let anthropicCooldownUntil: number | null = null;
let geminiCooldownUntil: number | null = null;
const COOLDOWN_MS = 60_000;

function isRateLimitError(e: any): boolean {
    const msg = (e?.message || '').toLowerCase();
    return msg.includes('429') || msg.includes('resource_exhausted') ||
        msg.includes('quota') || msg.includes('rate limit') ||
        msg.includes('overloaded') || e?.status === 429;
}

function isProviderAvailable(until: number | null): boolean {
    if (until === null) return true;
    if (Date.now() > until) return true;
    return false;
}

function tripBreaker(who: 'anthropic' | 'gemini', e: any): void {
    const retryMatch = e?.message?.match(/(\d+)s/);
    const cooldownMs = Math.max((retryMatch ? parseInt(retryMatch[1]) : 60) * 1000, COOLDOWN_MS);
    if (who === 'anthropic') { anthropicCooldownUntil = Date.now() + cooldownMs; }
    else { geminiCooldownUntil = Date.now() + cooldownMs; }
    console.warn(`[Router] ⚠️ ${who} tripped. Cooling down for ${Math.round(cooldownMs / 1000)}s.`);
}

function isAnthropicAvailable(): boolean {
    if (isProviderAvailable(anthropicCooldownUntil)) {
        if (anthropicCooldownUntil !== null && Date.now() > anthropicCooldownUntil) {
            anthropicCooldownUntil = null; console.log('[Router] Anthropic cooldown expired.');
        }
        return anthropicCooldownUntil === null;
    }
    return false;
}

function isGeminiAvailable(): boolean {
    if (isProviderAvailable(geminiCooldownUntil)) {
        if (geminiCooldownUntil !== null && Date.now() > geminiCooldownUntil) {
            geminiCooldownUntil = null; console.log('[Router] Gemini cooldown expired.');
        }
        return geminiCooldownUntil === null;
    }
    return false;
}

// ============================
// TASK CLASSIFIER
// ============================
async function classifyTask(text: string): Promise<TaskTier> {
    if (!canUseHeavyModel()) return 'light';

    // Use cheapest available model to classify
    const classifyPrompt = `You are a task classifier. Respond with EXACTLY one word:
- "analysis" if the task requires deep reasoning, strategic planning, research, or complex decision-making
- "code" if the task involves writing code, debugging, creating scripts, or programming
- "light" if simple: greetings, questions, lookups, file reading, status checks, reminders

User message: "${text.substring(0, 500)}"
Classification:`;

    // Try Anthropic Haiku first (cheapest + fastest)
    if (isAnthropicAvailable() && config.anthropicApiKey) {
        try {
            const result = await anthropic.messages.create({
                model: config.claudeHeartbeatModel,
                max_tokens: 10,
                messages: [{ role: 'user', content: classifyPrompt }]
            });
            const classification = (result.content[0] as any)?.text?.trim().toLowerCase() || '';
            if (classification.includes('code')) return 'code';
            if (classification.includes('analysis')) return 'analysis';
            return 'light';
        } catch (e: any) {
            if (isRateLimitError(e)) tripBreaker('anthropic', e);
            // fall through to Gemini
        }
    }

    // Fall back to Gemini Flash for classification
    if (isGeminiAvailable() && config.geminiApiKey) {
        try {
            const result = await gemini.models.generateContent({ model: config.geminiHeartbeatModel, contents: classifyPrompt });
            const classification = (result.text || '').trim().toLowerCase();
            if (classification.includes('code')) return 'code';
            if (classification.includes('analysis')) return 'analysis';
            return 'light';
        } catch (e: any) {
            if (isRateLimitError(e)) tripBreaker('gemini', e);
        }
    }

    return 'light'; // safe default
}

// ============================
// OBSIDIAN / SYSTEM PROMPT
// ============================
const SOUL_PATH = path.join(config.obsidianPath, 'SOUL.md');
const SKILLS_DIR = path.join(config.obsidianPath, 'skills');

function buildSystemPrompt(): string {
    let prompt = '';
    try { prompt += fs.readFileSync(SOUL_PATH, 'utf8'); }
    catch { prompt += 'You are Gravity Claw, a personal AI agent. Use your tools to help the user. Do not ask for API keys.'; }
    try {
        if (fs.existsSync(SKILLS_DIR)) {
            for (const dir of fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory())) {
                const skillFile = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    prompt += `\n\n---\n## Skill: ${dir.name}\n${fs.readFileSync(skillFile, 'utf8')}`;
                }
            }
        }
    } catch { }
    const buffer = getPreconsciousBuffer();
    if (buffer) prompt += buffer;
    return prompt;
}

// ============================
// TOOL SCHEMA CONVERTERS
// ============================

// OpenAI format (existing tool definitions)
function getAllToolsForOpenAI(): OpenAI.Chat.ChatCompletionTool[] {
    return [...internalTools, ...getMCPToolsSchema()] as OpenAI.Chat.ChatCompletionTool[];
}

// Anthropic format
function getAllToolsForAnthropic(): Anthropic.Tool[] {
    return getAllToolsForOpenAI().map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: (t.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool['input_schema']
    }));
}

// Gemini format
function getAllToolsForGemini() {
    return [{
        functionDeclarations: getAllToolsForOpenAI().map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters as any
        } as FunctionDeclaration))
    }];
}

async function routeToolExecution(name: string, args: any): Promise<any> {
    return name.startsWith('mcp__') ? await executeMCPTool(name, args) : await executeInternalTool(name, args);
}

function truncateResult(result: any): string {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return text.length > MAX_TOOL_RESULT_LENGTH ? text.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n...[truncated]' : text;
}

// ============================
// CONVERSATION HISTORY
// ============================
// We maintain two parallel histories — Anthropic and Gemini formats.
// OpenAI handler builds its own messages each time (stateless).
const claudeHistory: Anthropic.MessageParam[] = [];
const geminiHistory: any[] = [];

let sessionTokenEstimate = 0;

export function resetConversation(): void {
    claudeHistory.length = 0;
    geminiHistory.length = 0;
    sessionTokenEstimate = 0;
    console.log('[Agent] Conversation history cleared.');
}

// ============================
// CONVERSATION COMPACTION
// ============================
function estimateHistoryChars(history: any[]): number {
    let total = 0;
    for (const msg of history) {
        if (typeof msg.content === 'string') total += msg.content.length;
        else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') total += part.length;
                else if (part.text) total += part.text.length;
            }
        }
    }
    return total;
}

async function compactConversation(): Promise<void> {
    const charCount = estimateHistoryChars(claudeHistory);
    if (charCount < COMPACTION_CHAR_THRESHOLD) return;

    console.log(`[Compact] History is ${Math.round(charCount / 1000)}K chars. Compacting...`);
    const keepCount = Math.min(4, claudeHistory.length);
    const toSummarize = claudeHistory.slice(0, -keepCount);
    const toKeep = claudeHistory.slice(-keepCount);
    if (toSummarize.length === 0) return;

    let summaryInput = toSummarize.map(m => {
        const content = typeof m.content === 'string' ? m.content :
            Array.isArray(m.content) ? m.content.map((p: any) => p.text || '').join(' ') : '';
        return `[${m.role}]: ${content.substring(0, 500)}`;
    }).join('\n');

    const summaryPrompt = `Summarize this conversation in 2-3 sentences. Focus on what was discussed, tools used, and outcomes:\n\n${summaryInput.substring(0, 5000)}`;

    let summary = 'Previous conversation context.';
    try {
        if (isAnthropicAvailable() && config.anthropicApiKey) {
            const r = await anthropic.messages.create({ model: config.claudeHeartbeatModel, max_tokens: 200, messages: [{ role: 'user', content: summaryPrompt }] });
            summary = (r.content[0] as any)?.text || summary;
        } else if (isGeminiAvailable()) {
            const r = await gemini.models.generateContent({ model: config.geminiHeartbeatModel, contents: summaryPrompt });
            summary = r.text || summary;
        }
    } catch { }

    claudeHistory.length = 0;
    claudeHistory.push({ role: 'user', content: `[Prior conversation summary]: ${summary}` });
    claudeHistory.push({ role: 'assistant', content: 'Understood, I have context from our prior conversation.' });
    claudeHistory.push(...toKeep);

    geminiHistory.length = 0;
    geminiHistory.push({ role: 'user', parts: [{ text: `[Prior conversation summary]: ${summary}` }] });
    geminiHistory.push({ role: 'model', parts: [{ text: 'Understood.' }] });
}

// ============================
// ATTACHMENT TYPES
// ============================
export interface MediaAttachment {
    type: 'image' | 'document';
    url: string;
    filename: string;
    localPath: string;
}

// ============================
// MAIN HANDLER — SMART ROUTING
// ============================
export async function handleUserMessage(text: string, attachments: MediaAttachment[] = []): Promise<string> {
    const imageAttachments = attachments.filter(a => a.type === 'image');
    const docAttachments = attachments.filter(a => a.type === 'document');

    // Vision → Claude first (it supports vision), then GPT-4o fallback
    if (imageAttachments.length > 0) {
        console.log('[Router] 🎨 Vision detected → Claude (with GPT-4o fallback)');
        return await handleVisionMessage(text, imageAttachments, docAttachments);
    }

    let userText = text || '';
    if (docAttachments.length > 0) {
        const docList = docAttachments.map(d => `- ${d.filename} (saved at ${d.localPath})`).join('\n');
        userText += `\n\nThe user uploaded these files:\n${docList}\nUse your exec or filesystem tools to read/process them.`;
    }

    const tier = await classifyTask(userText);
    const models = getModelMap();
    console.log(`[Router] Task tier: ${tier.toUpperCase()}`);

    if (tier === 'analysis' || tier === 'code') useHeavyCall();
    return await routeWithFallback(userText, tier, false, getMaxIterations(tier));
}

// ============================
// PROVIDER FALLBACK CASCADE
// ============================
async function routeWithFallback(text: string, tier: TaskTier, alreadyPushed: boolean, maxIter: number = 0): Promise<string> {
    const models = getModelMap();
    if (maxIter === 0) maxIter = getMaxIterations(tier);

    // 1️⃣ Try Claude (Primary)
    if (isAnthropicAvailable() && config.anthropicApiKey) {
        const model = models.claude[tier];
        console.log(`[Router] → Claude ${model}`);
        try {
            return await handleClaudeTask(text, model, alreadyPushed, maxIter);
        } catch (e: any) {
            if (isRateLimitError(e)) {
                tripBreaker('anthropic', e);
                console.log('[Router] Claude rate-limited, falling back to OpenAI...');
            } else {
                console.error('[Router] Claude error:', e.message, '— falling back to OpenAI...');
            }
            alreadyPushed = true;
        }
    }

    // 2️⃣ Try OpenAI (Fallback 1)
    const openaiModel = models.openai[tier];
    console.log(`[Router] → OpenAI ${openaiModel}`);
    try {
        return await handleOpenAITask(text, openaiModel, alreadyPushed, maxIter);
    } catch (e: any) {
        console.error('[Router] OpenAI error:', e.message, '— falling back to Gemini...');
        alreadyPushed = true;
    }

    // 3️⃣ Try Gemini (Fallback 2)
    if (isGeminiAvailable() && config.geminiApiKey) {
        const geminiModel = models.gemini[tier];
        console.log(`[Router] → Gemini ${geminiModel}`);
        try {
            return await handleGeminiTask(text, geminiModel, alreadyPushed, maxIter);
        } catch (e: any) {
            if (isRateLimitError(e)) tripBreaker('gemini', e);
            return `Sorry, all providers are currently unavailable. Please try again in a moment. (${e.message})`;
        }
    }

    return 'Sorry, no AI providers are currently available. Please try again later.';
}

// ============================
// CLAUDE HANDLER (Primary)
// ============================
async function handleClaudeTask(userText: string, model: string, _alreadyPushed = false, maxIter = 15): Promise<string> {
    await compactConversation();

    if (!_alreadyPushed) {
        claudeHistory.push({ role: 'user', content: userText });
        geminiHistory.push({ role: 'user', parts: [{ text: userText }] });
    }

    const tools = getAllToolsForAnthropic();
    let iterations = 0;

    // Build rolling messages array from history
    const messages: Anthropic.MessageParam[] = [...claudeHistory];

    while (iterations < maxIter) {
        iterations++;
        console.log(`[Agent-Claude/${model}] Iteration ${iterations}/${maxIter}...`);

        const response = await anthropic.messages.create({
            model,
            max_tokens: 8096,
            system: buildSystemPrompt(),
            tools,
            messages
        });

        // Add assistant message to rolling context
        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
            // Execute all tool calls and collect results
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;
                console.log(`[Agent-Claude] Tool: ${block.name}`);
                try {
                    const result = await routeToolExecution(block.name, block.input);
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: truncateResult(result) });
                } catch (err: any) {
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
                }
            }
            messages.push({ role: 'user', content: toolResults });
            continue;
        }

        // Final text response
        const reply = response.content
            .filter(b => b.type === 'text')
            .map(b => (b as any).text)
            .join('\n')
            .trim() || 'No response generated.';

        // Commit to persistent history
        claudeHistory.push({ role: 'assistant', content: reply });
        geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
        return reply;
    }

    return 'Error: Exceeded maximum tool iterations.';
}

// ============================
// OPENAI HANDLER (Fallback 1)
// ============================
async function handleOpenAITask(userText: string, model: string, _alreadyPushed = false, maxIter = 15): Promise<string> {
    if (!_alreadyPushed) {
        claudeHistory.push({ role: 'user', content: userText });
        geminiHistory.push({ role: 'user', parts: [{ text: userText }] });
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userText }
    ];

    let iterations = 0;
    while (iterations < maxIter) {
        iterations++;
        console.log(`[Agent-OpenAI/${model}] Iteration ${iterations}/${maxIter}...`);

        const response = await openai.chat.completions.create({
            model,
            messages,
            // @ts-ignore — tools accepted by all GPT-4 class models
            tools: getAllToolsForOpenAI(),
            tool_choice: 'auto'
        });

        const message = response.choices[0].message;
        messages.push(message);

        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const tc of message.tool_calls) {
                console.log(`[Agent-OpenAI] Tool: ${tc.function.name}`);
                try {
                    const result = await routeToolExecution(tc.function.name, JSON.parse(tc.function.arguments));
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: truncateResult(result) });
                } catch (err: any) {
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${err.message}` });
                }
            }
            continue;
        }

        if (message.content) {
            claudeHistory.push({ role: 'assistant', content: message.content });
            geminiHistory.push({ role: 'model', parts: [{ text: message.content }] });
            return message.content;
        }

        return 'Completed with no output.';
    }

    return 'Error: Exceeded maximum iterations.';
}

// ============================
// GEMINI HANDLER (Fallback 2)
// ============================
async function handleGeminiTask(userText: string, model: string, _alreadyPushed = false, maxIter = 15): Promise<string> {
    if (!_alreadyPushed) {
        claudeHistory.push({ role: 'user', content: userText });
        geminiHistory.push({ role: 'user', parts: [{ text: userText }] });
    }

    let iterations = 0;
    let pendingFunctionResponses: any[] = [];
    const chat = gemini.chats.create({
        model,
        config: {
            systemInstruction: { role: 'system', parts: [{ text: buildSystemPrompt() }] },
            tools: getAllToolsForGemini()
        },
        history: geminiHistory.slice(0, -1)
    });

    while (iterations < maxIter) {
        iterations++;
        console.log(`[Agent-Gemini/${model}] Iteration ${iterations}/${maxIter}...`);

        const response = iterations === 1
            ? await chat.sendMessage({ message: userText })
            : await chat.sendMessage({ message: pendingFunctionResponses.map(pr => ({ functionResponse: pr })) });

        if (response.functionCalls && response.functionCalls.length > 0) {
            pendingFunctionResponses = [];
            for (const call of response.functionCalls) {
                console.log(`[Agent-Gemini] Tool: ${call.name}`);
                try {
                    const result = await routeToolExecution(call.name!, call.args);
                    pendingFunctionResponses.push({ id: call.id, name: call.name!, response: { result: truncateResult(result) } });
                } catch (err: any) {
                    pendingFunctionResponses.push({ id: call.id, name: call.name!, response: { error: err.message } });
                }
            }
            continue;
        }

        const reply = response.text || 'No response generated.';
        claudeHistory.push({ role: 'assistant', content: reply });
        geminiHistory.push({ role: 'model', parts: [{ text: reply }] });
        return reply;
    }

    return 'Error: Exceeded maximum iterations.';
}

// ============================
// VISION HANDLER (Claude first, GPT-4o fallback)
// ============================
async function handleVisionMessage(text: string, images: MediaAttachment[], docs: MediaAttachment[]): Promise<string> {
    const maxIter = getMaxIterations('analysis'); // Give vision tasks higher iteration limits

    let textContent = text || '';
    if (docs.length > 0) {
        textContent += `\n\nThe user uploaded these files:\n${docs.map(d => `- ${d.filename} (saved at ${d.localPath})`).join('\n')}\nUse your exec or filesystem tools to read/process them.`;
    }

    // Try Claude vision first
    if (isAnthropicAvailable() && config.anthropicApiKey) {
        try {
            console.log('[Agent-Claude] Processing vision task...');
            const imageBlocks: Anthropic.ImageBlockParam[] = await Promise.all(images.map(async img => {
                const resp = await fetch(img.url);
                const buffer = Buffer.from(await resp.arrayBuffer());
                const b64 = buffer.toString('base64');
                const mediaType = img.filename.match(/\.png$/i) ? 'image/png' :
                    img.filename.match(/\.(jpg|jpeg)$/i) ? 'image/jpeg' :
                    img.filename.match(/\.webp$/i) ? 'image/webp' : 'image/jpeg';
                return { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } } as Anthropic.ImageBlockParam;
            }));

            const userContent: Anthropic.ContentBlockParam[] = [...imageBlocks];
            if (textContent) userContent.push({ type: 'text', text: textContent });

            const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];
            let iterations = 0;
            let finalReply = '';

            while (iterations < maxIter) {
                iterations++;
                const response = await anthropic.messages.create({
                    model: config.claudeLightModel,
                    max_tokens: 4096,
                    system: buildSystemPrompt(),
                    tools: getAllToolsForAnthropic(),
                    messages
                });

                messages.push({ role: 'assistant', content: response.content });

                if (response.stop_reason === 'tool_use') {
                    const toolResults: Anthropic.ToolResultBlockParam[] = [];
                    for (const block of response.content) {
                        if (block.type !== 'tool_use') continue;
                        try {
                            const result = await routeToolExecution(block.name, block.input);
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: truncateResult(result) });
                        } catch (err: any) {
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
                        }
                    }
                    messages.push({ role: 'user', content: toolResults });
                    continue;
                }

                finalReply = response.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
                break;
            }

            if (finalReply) {
                claudeHistory.push({ role: 'user', content: text || 'User sent an image.' });
                claudeHistory.push({ role: 'assistant', content: finalReply });
                geminiHistory.push({ role: 'user', parts: [{ text: text || 'User sent an image.' }] });
                geminiHistory.push({ role: 'model', parts: [{ text: finalReply }] });
                return finalReply;
            }
        } catch (e: any) {
            if (isRateLimitError(e)) tripBreaker('anthropic', e);
            console.error('[Agent-Claude] Vision error, falling back to GPT-4o:', e.message);
        }
    }

    // Fallback: GPT-4o vision
    try {
        console.log('[Agent-GPT4o] Vision fallback...');
        const contentParts: any[] = [];
        if (textContent) contentParts.push({ type: 'text', text: textContent });
        for (const img of images) contentParts.push({ type: 'image_url', image_url: { url: img.url, detail: 'auto' } });

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: contentParts }
        ];

        let iterations = 0, finalReply = '';
        while (iterations < maxIter) {
            iterations++;
            const response = await openai.chat.completions.create({
                model: config.openaiAnalysisModel, messages,
                // @ts-ignore
                tools: getAllToolsForOpenAI(), tool_choice: 'auto', max_tokens: 2000
            });
            const message = response.choices[0]?.message;
            if (!message) break;
            messages.push(message);
            if (message.tool_calls?.length) {
                for (const tc of message.tool_calls) {
                    try {
                        const result = await routeToolExecution(tc.function.name, JSON.parse(tc.function.arguments));
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: truncateResult(result) });
                    } catch (err: any) {
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${err.message}` });
                    }
                }
                continue;
            }
            finalReply = message.content || '';
            break;
        }

        if (finalReply) {
            claudeHistory.push({ role: 'user', content: text || 'User sent an image.' });
            claudeHistory.push({ role: 'assistant', content: finalReply });
            geminiHistory.push({ role: 'user', parts: [{ text: text || 'User sent an image.' }] });
            geminiHistory.push({ role: 'model', parts: [{ text: finalReply }] });
        }
        return finalReply || 'Vision task completed with no output.';
    } catch (e: any) {
        return `Vision processing error: ${e.message}`;
    }
}

// ============================
// HEARTBEAT (Claude Haiku → OpenAI mini → Gemini Flash)
// ============================
export async function handleHeartbeatTask(text: string): Promise<string> {
    console.log('[Heartbeat] Processing scheduled task...');
    return await routeWithFallback(text, 'heartbeat', false);
}
