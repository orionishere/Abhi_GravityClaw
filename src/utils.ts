/**
 * utils.ts
 *
 * Pure utility functions extracted for testability.
 * These have no side effects, no database calls, no API calls.
 * Every function here should be easy to unit test.
 */

// ============================
// MESSAGE SPLITTING (from bot.ts)
// ============================

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 * Splits at newlines when possible, then spaces, never mid-word.
 */
export function splitMessage(text: string, maxLength = 1900): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        let splitAt = remaining.lastIndexOf('\n', maxLength);

        if (splitAt <= 0) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }

        if (splitAt <= 0) {
            splitAt = maxLength;
        }

        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
}

// ============================
// PATH VALIDATION (from browser.ts)
// ============================

/**
 * Check if a resolved path stays within a given base directory.
 * Prevents path traversal attacks (../../etc/passwd).
 */
export function isPathWithinBase(requestedPath: string, basePath: string): boolean {
    const path = require('path');
    const resolved = path.resolve(basePath, requestedPath);
    const baseResolved = path.resolve(basePath);
    return resolved.startsWith(baseResolved + path.sep) || resolved === baseResolved;
}

// ============================
// URL VALIDATION (from browser.ts)
// ============================

const BLOCKED_HOSTS = [
    'localhost', '127.0.0.1', '0.0.0.0', '[::1]',
    '169.254.',  // AWS metadata
    '10.',       // Private class A
    '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.',
    '172.24.', '172.25.', '172.26.', '172.27.',
    '172.28.', '172.29.', '172.30.', '172.31.',  // Private class B
    '192.168.',  // Private class C
];

/**
 * Validate a URL for browser navigation.
 * Returns null if valid, or an error message string if blocked.
 */
export function validateBrowserUrl(url: string): string | null {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return `Only http:// and https:// URLs are allowed.`;
    }

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (BLOCKED_HOSTS.some(b => hostname.startsWith(b) || hostname === b)) {
            return `Cannot access internal/local network addresses.`;
        }
    } catch {
        return `Invalid URL.`;
    }

    return null; // Valid
}

// ============================
// PACKAGE NAME VALIDATION (from exec.ts)
// ============================

const SAFE_PACKAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*([<>=!~]+[a-zA-Z0-9.*]+)?$/;

/**
 * Validate a pip package name against PEP 508 naming rules.
 */
export function isValidPackageName(name: string): boolean {
    return SAFE_PACKAGE_PATTERN.test(name);
}

// ============================
// TOKEN ESTIMATION (from costs.ts)
// ============================

/**
 * Estimate token count from character count (~4 chars per token).
 */
export function estimateTokenCount(text: string): number {
    return Math.ceil((text?.length || 0) / 4);
}

// ============================
// COST CALCULATION (from costs.ts)
// ============================

interface ModelPricing {
    input: number;
    output: number;
}

const PRICING: Record<string, ModelPricing> = {
    'claude-opus-4-6':      { input: 5.00,  output: 25.00 },
    'claude-opus-4-5':      { input: 5.00,  output: 25.00 },
    'claude-sonnet-4-6':    { input: 3.00,  output: 15.00 },
    'claude-sonnet-4-5':    { input: 3.00,  output: 15.00 },
    'claude-haiku-4-5':     { input: 1.00,  output: 5.00  },
    'gpt-4o':               { input: 2.50,  output: 10.00 },
    'gpt-4o-mini':          { input: 0.15,  output: 0.60  },
    'o4-mini':              { input: 1.10,  output: 4.40  },
    'gemini-2.5-pro':       { input: 1.25,  output: 10.00 },
    'gemini-2.5-flash':     { input: 0.15,  output: 0.60  },
    'llama3.1:8b':          { input: 0,     output: 0     },
};

const FAMILY_PRICING: Array<{ pattern: string; pricing: ModelPricing }> = [
    { pattern: 'opus',       pricing: { input: 5.00, output: 25.00 } },
    { pattern: 'sonnet',     pricing: { input: 3.00, output: 15.00 } },
    { pattern: 'haiku',      pricing: { input: 1.00, output: 5.00  } },
    { pattern: 'gpt-4o-mini',pricing: { input: 0.15, output: 0.60  } },
    { pattern: 'gpt-4o',     pricing: { input: 2.50, output: 10.00 } },
    { pattern: 'flash',      pricing: { input: 0.15, output: 0.60  } },
    { pattern: 'pro',        pricing: { input: 1.25, output: 10.00 } },
    { pattern: 'llama',      pricing: { input: 0, output: 0 } },
    { pattern: 'mistral',    pricing: { input: 0, output: 0 } },
];

const DEFAULT_PRICING: ModelPricing = { input: 3.00, output: 15.00 };

/**
 * Get pricing for a model by name. Returns $/million tokens for input and output.
 */
export function getModelPricing(model: string): ModelPricing {
    if (PRICING[model]) return PRICING[model];

    const lower = model.toLowerCase();
    for (const [key, pricing] of Object.entries(PRICING)) {
        if (lower.includes(key) || key.includes(lower)) return pricing;
    }
    for (const { pattern, pricing } of FAMILY_PRICING) {
        if (lower.includes(pattern)) return pricing;
    }

    return DEFAULT_PRICING;
}

/**
 * Calculate estimated cost for a single API call.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = getModelPricing(model);
    return (inputTokens * pricing.input / 1_000_000) + (outputTokens * pricing.output / 1_000_000);
}

// ============================
// SKILL TIER RECOMMENDATION (from tracker.ts)
// ============================

/**
 * Compute recommended model tier based on execution history.
 */
export function computeRecommendedTier(
    avgToolCalls: number,
    maxToolCalls: number,
    successRate: number,
    localSuccessCount: number,
    localFailCount: number,
): string {
    if (localFailCount >= 3 && localSuccessCount < localFailCount) return 'heartbeat';
    if (avgToolCalls > 3 || maxToolCalls > 5) return 'light';
    if (avgToolCalls > 1.5 && successRate > 0.8) return 'heartbeat';
    if (avgToolCalls <= 2 && successRate > 0.7) return 'local';
    if (avgToolCalls === 0) return 'local';
    return 'heartbeat';
}

// ============================
// MCP VOLUME VALIDATION (from mcp.ts)
// ============================

/**
 * Check if a Docker volume mount string targets an allowed host path.
 */
export function isVolumeMountAllowed(volumeMount: string, allowedPrefixes: string[]): boolean {
    const path = require('path');
    const hostPath = volumeMount.split(':')[0];
    if (!hostPath) return false;
    const resolved = path.resolve(hostPath);
    return allowedPrefixes.some(prefix => {
        const prefixResolved = path.resolve(prefix);
        return resolved.startsWith(prefixResolved + path.sep) || resolved === prefixResolved;
    });
}

// ============================
// ENV VARIABLE KEY VALIDATION (from mcp.ts)
// ============================

/**
 * Validate that an environment variable key name is safe.
 */
export function isValidEnvKey(key: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}
