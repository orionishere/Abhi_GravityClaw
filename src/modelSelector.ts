/**
 * modelSelector.ts
 *
 * Automatically discovers the best available model per tier by querying
 * each provider's models API. Results are cached for 24 hours in
 * data/model_cache.json and refreshed on the next boot after expiry.
 *
 * TIER HIERARCHY:
 *   analysis  → most capable model (Opus / GPT-4 class / Gemini Pro)
 *   code      → strong reasoning model (Sonnet / o-series / Gemini Flash)
 *   light     → general mid-tier (Sonnet / GPT-4o / Gemini Flash)
 *   heartbeat → cheapest/fastest (Haiku / GPT-4o-mini / Gemini Flash)
 *
 * To override any model, set the corresponding env var in .env:
 *   CLAUDE_ANALYSIS_MODEL, OPENAI_CODE_MODEL, GEMINI_LIGHT_MODEL, etc.
 *   Env-var overrides always win over auto-selected models.
 */

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

// ============================
// TYPES
// ============================
export type ModelTier = 'analysis' | 'code' | 'light' | 'heartbeat';
export type Provider = 'anthropic' | 'openai' | 'gemini';

interface ModelCache {
    updatedAt: number; // unix ms
    anthropic: Record<ModelTier, string>;
    openai: Record<ModelTier, string>;
    gemini: Record<ModelTier, string>;
}

// ============================
// HARDCODED FALLBACKS
// (used only if API query fails AND no env override exists)
// ============================
const FALLBACKS: Record<Provider, Record<ModelTier, string>> = {
    anthropic: {
        analysis:  'claude-opus-4-5',
        code:      'claude-sonnet-4-5',
        light:     'claude-sonnet-4-5',
        heartbeat: 'claude-haiku-4-5',
    },
    openai: {
        analysis:  'gpt-4o',
        code:      'o4-mini',
        light:     'gpt-4o-mini',
        heartbeat: 'gpt-4o-mini',
    },
    gemini: {
        analysis:  'gemini-2.5-pro-preview-03-25',
        code:      'gemini-2.5-flash',
        light:     'gemini-2.5-flash',
        heartbeat: 'gemini-2.5-flash',
    }
};

// Env-var overrides (always win)
const ENV_OVERRIDES: Record<Provider, Record<ModelTier, string | undefined>> = {
    anthropic: {
        analysis:  process.env.CLAUDE_ANALYSIS_MODEL,
        code:      process.env.CLAUDE_CODE_MODEL,
        light:     process.env.CLAUDE_LIGHT_MODEL,
        heartbeat: process.env.CLAUDE_HEARTBEAT_MODEL,
    },
    openai: {
        analysis:  process.env.OPENAI_ANALYSIS_MODEL,
        code:      process.env.OPENAI_CODE_MODEL,
        light:     process.env.OPENAI_LIGHT_MODEL,
        heartbeat: process.env.OPENAI_HEARTBEAT_MODEL,
    },
    gemini: {
        analysis:  process.env.GEMINI_ANALYSIS_MODEL,
        code:      process.env.GEMINI_LIGHT_MODEL,
        light:     process.env.GEMINI_LIGHT_MODEL,
        heartbeat: process.env.GEMINI_HEARTBEAT_MODEL,
    }
};

// ============================
// CACHE
// ============================
const CACHE_FILE = path.join(config.dataPath, 'model_cache.json');
const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

let _cache: ModelCache | null = null;

function loadCache(): ModelCache | null {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8');
            return JSON.parse(raw) as ModelCache;
        }
    } catch { }
    return null;
}

function saveCache(cache: ModelCache): void {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e: any) {
        console.error('[ModelSelector] Failed to save model cache:', e.message);
    }
}

// ============================
// ANTHROPIC MODEL RANKING
// ============================
async function fetchAnthropicModels(): Promise<Record<ModelTier, string>> {
    const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
            'x-api-key': config.anthropicApiKey,
            'anthropic-version': '2023-06-01',
        }
    });
    if (!res.ok) throw new Error(`Anthropic models API: ${res.status}`);
    const data = await res.json() as { data: Array<{ id: string; display_name: string }> };
    const ids = data.data.map(m => m.id);

    // Score each model: family priority × 1000 + version score
    function scoreAnthropic(id: string): number {
        const lower = id.toLowerCase();
        const familyScore = lower.includes('opus') ? 1000 :
            lower.includes('sonnet') ? 500 :
            lower.includes('haiku') ? 100 : 0;
        // Extract numeric version from id (e.g. claude-3-5-sonnet → 3.5, claude-sonnet-4-5 → 4.5)
        const nums = lower.match(/(\d+)/g)?.map(Number) || [];
        const versionScore = nums.reduce((acc, n, i) => acc + n * Math.pow(10, 4 - i * 2), 0);
        return familyScore + versionScore;
    }

    const opus    = ids.filter(id => id.toLowerCase().includes('opus')).sort((a, b) => scoreAnthropic(b) - scoreAnthropic(a))[0];
    const sonnets = ids.filter(id => id.toLowerCase().includes('sonnet')).sort((a, b) => scoreAnthropic(b) - scoreAnthropic(a));
    const sonnet  = sonnets[0];
    const haiku   = ids.filter(id => id.toLowerCase().includes('haiku')).sort((a, b) => scoreAnthropic(b) - scoreAnthropic(a))[0];

    // Fallback chain: if a tier's target family is missing, use the next best
    return {
        analysis:  opus    || sonnet || haiku   || FALLBACKS.anthropic.analysis,
        code:      sonnet  || opus   || haiku   || FALLBACKS.anthropic.code,
        light:     sonnet  || haiku  || opus    || FALLBACKS.anthropic.light,
        heartbeat: haiku   || sonnet || opus    || FALLBACKS.anthropic.heartbeat,
    };
}

// ============================
// OPENAI MODEL RANKING
// ============================
async function fetchOpenAIModels(): Promise<Record<ModelTier, string>> {
    const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${config.openaiApiKey}` }
    });
    if (!res.ok) throw new Error(`OpenAI models API: ${res.status}`);
    const data = await res.json() as { data: Array<{ id: string }> };
    const ids = data.data.map(m => m.id).filter(id =>
        // Only text generation models (exclude whisper, dall-e, embeddings, etc.)
        /^(gpt-|o\d|chatgpt)/.test(id) && !id.includes('instruct') && !id.includes('embed')
    );

    function scoreOpenAI(id: string): number {
        const lower = id.toLowerCase();
        // Generation bonuses
        const genScore = lower.match(/gpt-(\d+)/) ? parseInt(lower.match(/gpt-(\d+)/)![1]) * 100 :
            lower.match(/^o(\d+)/) ? parseInt(lower.match(/^o(\d+)/)![1]) * 200 + 500 : 0;
        // Penalise mini / nano / smaller variants
        const sizePenalty = lower.includes('mini') ? -150 :
            lower.includes('nano') ? -300 :
            lower.includes('preview') ? -10 : 0;
        // Recency bonus from trailing version numbers
        const versionNums = lower.match(/\d+(\.\d+)?/g)?.map(parseFloat) || [];
        const versionScore = versionNums.reduce((a, n) => a + n, 0);
        return genScore + sizePenalty + versionScore;
    }

    const sorted = [...ids].sort((a, b) => scoreOpenAI(b) - scoreOpenAI(a));
    const minis  = sorted.filter(id => id.includes('mini') || id.includes('nano'));
    const reasoning = sorted.filter(id => /^o\d/.test(id) && !id.includes('mini'));
    const flagship = sorted.filter(id => !id.includes('mini') && !id.includes('nano') && !/^o\d/.test(id));

    return {
        analysis:  flagship[0]  || reasoning[0] || FALLBACKS.openai.analysis,
        code:      reasoning[0] || flagship[0]  || FALLBACKS.openai.code,
        light:     flagship[0]  || minis[0]     || FALLBACKS.openai.light,
        heartbeat: minis[0]     || flagship[0]  || FALLBACKS.openai.heartbeat,
    };
}

// ============================
// GEMINI MODEL RANKING
// ============================
async function fetchGeminiModels(): Promise<Record<ModelTier, string>> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}`
    );
    if (!res.ok) throw new Error(`Gemini models API: ${res.status}`);
    const data = await res.json() as { models: Array<{ name: string; displayName: string; supportedGenerationMethods: string[] }> };

    // Only keep models that support generateContent
    const ids = data.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', '')); // strip "models/" prefix

    function scoreGemini(id: string): number {
        const lower = id.toLowerCase();
        const proScore = lower.includes('pro') ? 1000 : 0;
        const flashPenalty = lower.includes('flash') ? -500 : 0;
        const expPenalty = lower.includes('exp') || lower.includes('preview') ? -20 : 0;
        const versionNums = lower.match(/\d+(\.\d+)?/g)?.map(parseFloat) || [];
        const versionScore = versionNums.reduce((a, n) => a + n * 50, 0);
        return proScore + flashPenalty + expPenalty + versionScore;
    }

    const sorted = [...ids].sort((a, b) => scoreGemini(b) - scoreGemini(a));
    const pros   = sorted.filter(id => id.toLowerCase().includes('pro'));
    const flashes = sorted.filter(id => id.toLowerCase().includes('flash'));

    return {
        analysis:  pros[0]    || sorted[0] || FALLBACKS.gemini.analysis,
        code:      flashes[0] || pros[0]   || FALLBACKS.gemini.code,
        light:     flashes[0] || sorted[0] || FALLBACKS.gemini.light,
        heartbeat: flashes[0] || sorted[0] || FALLBACKS.gemini.heartbeat,
    };
}

// ============================
// MAIN: REFRESH + GET
// ============================
export async function refreshModelCache(): Promise<void> {
    console.log('[ModelSelector] Fetching latest models from all providers...');

    const results = await Promise.allSettled([
        fetchAnthropicModels(),
        fetchOpenAIModels(),
        fetchGeminiModels(),
    ]);

    const existing = loadCache() || {
        updatedAt: 0,
        anthropic: FALLBACKS.anthropic,
        openai:    FALLBACKS.openai,
        gemini:    FALLBACKS.gemini,
    };

    const newCache: ModelCache = {
        updatedAt:  Date.now(),
        anthropic: results[0].status === 'fulfilled' ? results[0].value : existing.anthropic,
        openai:    results[1].status === 'fulfilled' ? results[1].value : existing.openai,
        gemini:    results[2].status === 'fulfilled' ? results[2].value : existing.gemini,
    };

    // Log what was selected
    const tiers: ModelTier[] = ['analysis', 'code', 'light', 'heartbeat'];
    for (const tier of tiers) {
        console.log(`[ModelSelector] ${tier.padEnd(10)}: Claude=${newCache.anthropic[tier]} | OpenAI=${newCache.openai[tier]} | Gemini=${newCache.gemini[tier]}`);
    }

    if (results.some(r => r.status === 'rejected')) {
        const errors = results
            .map((r, i) => r.status === 'rejected' ? ['Anthropic', 'OpenAI', 'Gemini'][i] : null)
            .filter(Boolean);
        console.warn(`[ModelSelector] ⚠️  Failed to fetch from: ${errors.join(', ')} — using cached/fallback values.`);
    }

    saveCache(newCache);
    _cache = newCache;
}

/**
 * Returns the best model for a given provider + tier.
 * Priority: env override > auto-selected (cached) > hardcoded fallback
 */
export function getModel(provider: Provider, tier: ModelTier): string {
    // 1. Env override always wins
    const override = ENV_OVERRIDES[provider][tier];
    if (override) return override;

    // 2. Cached auto-selection
    if (_cache) return _cache[provider][tier];

    // 3. Try loading from disk (in case refreshModelCache hasn't run yet)
    const diskCache = loadCache();
    if (diskCache) {
        _cache = diskCache;
        return diskCache[provider][tier];
    }

    // 4. Hardcoded fallback
    return FALLBACKS[provider][tier];
}

/**
 * Call on startup. Refreshes if cache is older than 24h; otherwise uses cache.
 */
export async function initModelSelector(): Promise<void> {
    const cached = loadCache();
    const age = cached ? Date.now() - cached.updatedAt : Infinity;

    if (age < CACHE_TTL_MS) {
        _cache = cached;
        const days = Math.round(age / 86_400_000);
        console.log(`[ModelSelector] Using cached model selection (${days}d old). Next refresh in ${15 - days}d.`);
    } else {
        await refreshModelCache();
    }

    // Schedule refresh every 15 days
    setInterval(async () => {
        console.log('[ModelSelector] Running 15-day model refresh...');
        await refreshModelCache().catch(e => console.error('[ModelSelector] Refresh failed:', e.message));
    }, CACHE_TTL_MS);
}
