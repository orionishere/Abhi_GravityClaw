/**
 * errors.ts
 *
 * Centralized error handling, logging, and retry logic.
 *
 * Principles:
 *   1. Never silently swallow errors — always log at minimum
 *   2. Classify errors as transient (retry) or permanent (fail fast)
 *   3. Provide a retry wrapper for API calls
 *   4. Structured logging so you can grep logs effectively
 */

// ============================
// ERROR CLASSIFICATION
// ============================

/**
 * Is this a transient error that might succeed on retry?
 * (network glitch, timeout, temporary server error)
 */
export function isTransientError(error: any): boolean {
    const msg = (error?.message || '').toLowerCase();
    const status = error?.status || error?.statusCode || 0;

    // HTTP 5xx = server error (transient)
    if (status >= 500 && status < 600) return true;

    // HTTP 429 = rate limit (transient, handled by circuit breaker but also retryable)
    if (status === 429) return true;

    // Network-level errors
    if (msg.includes('etimedout')) return true;
    if (msg.includes('econnreset')) return true;
    if (msg.includes('econnrefused')) return true;
    if (msg.includes('enotfound')) return true;
    if (msg.includes('socket hang up')) return true;
    if (msg.includes('network')) return true;
    if (msg.includes('timeout')) return true;
    if (msg.includes('fetch failed')) return true;

    // Provider-specific transient errors
    if (msg.includes('overloaded')) return true;
    if (msg.includes('resource_exhausted')) return true;
    if (msg.includes('service unavailable')) return true;
    if (msg.includes('bad gateway')) return true;
    if (msg.includes('gateway timeout')) return true;

    return false;
}

// ============================
// STRUCTURED LOGGING
// ============================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log with structured context. Always includes timestamp and module name.
 */
export function log(level: LogLevel, module: string, message: string, extra?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const prefix = {
        debug: '🔍',
        info:  'ℹ️',
        warn:  '⚠️',
        error: '❌',
    }[level];

    const extraStr = extra ? ` | ${JSON.stringify(extra)}` : '';

    switch (level) {
        case 'debug':
            if (process.env.DEBUG) console.log(`${prefix} [${timestamp}] [${module}] ${message}${extraStr}`);
            break;
        case 'info':
            console.log(`${prefix} [${timestamp}] [${module}] ${message}${extraStr}`);
            break;
        case 'warn':
            console.warn(`${prefix} [${timestamp}] [${module}] ${message}${extraStr}`);
            break;
        case 'error':
            console.error(`${prefix} [${timestamp}] [${module}] ${message}${extraStr}`);
            break;
    }
}

/**
 * Log an error with full context. Use this instead of silent catch blocks.
 */
export function logError(module: string, action: string, error: any): void {
    const message = error?.message || String(error);
    const status = error?.status || error?.statusCode;
    const extra: Record<string, any> = { action };
    if (status) extra.status = status;
    if (error?.code) extra.code = error.code;

    log('error', module, message, extra);
}

// ============================
// RETRY WITH BACKOFF
// ============================

interface RetryOptions {
    /** Maximum number of attempts (including the first try) */
    maxAttempts?: number;
    /** Initial delay in ms before first retry */
    initialDelayMs?: number;
    /** Multiplier for exponential backoff (default: 2) */
    backoffMultiplier?: number;
    /** Maximum delay between retries in ms */
    maxDelayMs?: number;
    /** Module name for logging */
    module?: string;
    /** Action description for logging */
    action?: string;
    /** Only retry if this returns true for the error */
    shouldRetry?: (error: any) => boolean;
}

/**
 * Retry an async function with exponential backoff.
 * Only retries on transient errors by default.
 *
 * Usage:
 *   const result = await retry(() => fetch('https://api.example.com'), {
 *       maxAttempts: 3,
 *       module: 'MyModule',
 *       action: 'fetch data'
 *   });
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        initialDelayMs = 1000,
        backoffMultiplier = 2,
        maxDelayMs = 30000,
        module = 'Retry',
        action = 'operation',
        shouldRetry = isTransientError,
    } = options;

    let lastError: any;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Don't retry permanent errors
            if (!shouldRetry(error)) {
                throw error;
            }

            // Don't retry on last attempt
            if (attempt === maxAttempts) {
                log('error', module, `${action} failed after ${maxAttempts} attempts: ${error.message}`);
                throw error;
            }

            // Log retry
            log('warn', module, `${action} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${error.message}`);

            // Wait with backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        }
    }

    throw lastError;
}

// ============================
// SAFE WRAPPERS
// ============================

/**
 * Run a function and return a default value if it throws.
 * ALWAYS logs the error — never silent.
 */
export function safeSync<T>(module: string, action: string, fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch (error: any) {
        logError(module, action, error);
        return fallback;
    }
}

/**
 * Async version of safeSync.
 */
export async function safeAsync<T>(module: string, action: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        logError(module, action, error);
        return fallback;
    }
}
