/**
 * ollama.ts
 *
 * Local LLM client using Ollama's REST API.
 * Used as the cheapest tier for rote tasks: cron jobs, greetings, observations.
 *
 * Ollama must be running on the same machine: ollama serve
 * Default endpoint: http://localhost:11434
 */

import { config } from './config.js';

const OLLAMA_BASE = config.ollamaBaseUrl;
const OLLAMA_MODEL = config.ollamaModel;
const OLLAMA_TIMEOUT = 120_000; // 120s — local models are slow on CPU

// ============================
// HEALTH CHECK
// ============================
let _ollamaAvailable: boolean | null = null;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60_000; // Re-check every 60s

export async function isOllamaAvailable(): Promise<boolean> {
    // Cache the result for 60s to avoid hammering the endpoint
    if (_ollamaAvailable !== null && Date.now() - _lastHealthCheck < HEALTH_CHECK_INTERVAL) {
        return _ollamaAvailable;
    }

    if (!OLLAMA_BASE || !OLLAMA_MODEL) {
        _ollamaAvailable = false;
        return false;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
            _ollamaAvailable = false;
            _lastHealthCheck = Date.now();
            return false;
        }

        // Check if our desired model is actually pulled
        const data = await res.json() as { models: Array<{ name: string }> };
        const modelNames = data.models.map(m => m.name);
        const found = modelNames.some(name =>
            name === OLLAMA_MODEL || name.startsWith(OLLAMA_MODEL + ':')
        );

        if (!found) {
            console.warn(`[Ollama] Model "${OLLAMA_MODEL}" not found. Available: ${modelNames.join(', ')}`);
            _ollamaAvailable = false;
        } else {
            _ollamaAvailable = true;
        }
    } catch (e: any) {
        // Only log on first failure or if DEBUG is set (avoid spamming when Ollama isn't installed)
        if (_ollamaAvailable !== false) {
            console.warn(`[Ollama] Health check failed: ${(e as Error).message || 'connection refused'}`);
        }
        _ollamaAvailable = false;
    }

    _lastHealthCheck = Date.now();
    return _ollamaAvailable;
}

// ============================
// SIMPLE COMPLETION (no tools)
// ============================
export async function ollamaGenerate(prompt: string, systemPrompt?: string): Promise<string> {
    const body: any = {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
            temperature: 0.7,
            num_predict: 1024,
        }
    };

    if (systemPrompt) {
        body.system = systemPrompt;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    try {
        const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json() as { response: string };
        return data.response?.trim() || 'No response generated.';
    } catch (e: any) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            throw new Error('Ollama timed out (model may still be loading)');
        }
        throw e;
    }
}

// ============================
// CHAT COMPLETION WITH TOOLS
// ============================
interface OllamaTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{
        function: { name: string; arguments: Record<string, any> };
    }>;
}

export async function ollamaChat(
    messages: OllamaMessage[],
    tools?: OllamaTool[],
    maxIterations = 5
): Promise<{ reply: string; toolCalls: Array<{ name: string; args: any }> }> {

    const body: any = {
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: {
            temperature: 0.3, // Lower temp for tool-calling reliability
            num_predict: 2048,
        }
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    try {
        const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            throw new Error(`Ollama chat error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json() as {
            message: {
                role: string;
                content: string;
                tool_calls?: Array<{
                    function: { name: string; arguments: Record<string, any> };
                }>;
            };
        };

        const toolCalls = (data.message.tool_calls || []).map(tc => ({
            name: tc.function.name,
            args: tc.function.arguments,
        }));

        return {
            reply: data.message.content?.trim() || '',
            toolCalls,
        };
    } catch (e: any) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            throw new Error('Ollama chat timed out');
        }
        throw e;
    }
}
