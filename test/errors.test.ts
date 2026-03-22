import { describe, it, expect } from 'vitest';
import { isTransientError, retry } from '../src/errors.js';

// ============================
// ERROR CLASSIFICATION
// ============================
describe('isTransientError', () => {
    it('identifies timeout errors as transient', () => {
        expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
        expect(isTransientError(new Error('Request timeout'))).toBe(true);
    });

    it('identifies connection errors as transient', () => {
        expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
        expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isTransientError(new Error('socket hang up'))).toBe(true);
    });

    it('identifies 5xx status as transient', () => {
        expect(isTransientError({ status: 500, message: 'Internal Server Error' })).toBe(true);
        expect(isTransientError({ status: 502, message: 'Bad Gateway' })).toBe(true);
        expect(isTransientError({ status: 503, message: 'Service Unavailable' })).toBe(true);
    });

    it('identifies rate limit (429) as transient', () => {
        expect(isTransientError({ status: 429, message: 'Too Many Requests' })).toBe(true);
    });

    it('identifies provider overload as transient', () => {
        expect(isTransientError(new Error('overloaded_error: server is overloaded'))).toBe(true);
        expect(isTransientError(new Error('resource_exhausted'))).toBe(true);
    });

    it('does NOT identify auth errors as transient', () => {
        expect(isTransientError({ status: 401, message: 'Unauthorized' })).toBe(false);
        expect(isTransientError({ status: 403, message: 'Forbidden' })).toBe(false);
    });

    it('does NOT identify 4xx client errors as transient', () => {
        expect(isTransientError({ status: 400, message: 'Bad Request' })).toBe(false);
        expect(isTransientError({ status: 404, message: 'Not Found' })).toBe(false);
        expect(isTransientError({ status: 422, message: 'Unprocessable' })).toBe(false);
    });

    it('does NOT identify generic errors as transient', () => {
        expect(isTransientError(new Error('Cannot read property of undefined'))).toBe(false);
        expect(isTransientError(new Error('Invalid JSON'))).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
        expect(isTransientError({})).toBe(false);
    });
});

// ============================
// RETRY WITH BACKOFF
// ============================
describe('retry', () => {
    it('returns immediately on success', async () => {
        let calls = 0;
        const result = await retry(async () => {
            calls++;
            return 'ok';
        }, { maxAttempts: 3 });

        expect(result).toBe('ok');
        expect(calls).toBe(1);
    });

    it('retries on transient errors', async () => {
        let calls = 0;
        const result = await retry(async () => {
            calls++;
            if (calls < 3) throw new Error('ECONNRESET');
            return 'recovered';
        }, { maxAttempts: 3, initialDelayMs: 10 });

        expect(result).toBe('recovered');
        expect(calls).toBe(3);
    });

    it('does NOT retry permanent errors', async () => {
        let calls = 0;
        await expect(retry(async () => {
            calls++;
            const err: any = new Error('Invalid API key');
            err.status = 401;
            throw err;
        }, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow('Invalid API key');

        expect(calls).toBe(1); // Only tried once
    });

    it('gives up after maxAttempts', async () => {
        let calls = 0;
        await expect(retry(async () => {
            calls++;
            throw new Error('ETIMEDOUT');
        }, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow('ETIMEDOUT');

        expect(calls).toBe(3);
    });

    it('respects custom shouldRetry function', async () => {
        let calls = 0;
        await expect(retry(async () => {
            calls++;
            throw new Error('custom error');
        }, {
            maxAttempts: 3,
            initialDelayMs: 10,
            shouldRetry: (e) => e.message === 'custom error',
        })).rejects.toThrow('custom error');

        expect(calls).toBe(3); // Retried because custom shouldRetry returned true
    });
});
