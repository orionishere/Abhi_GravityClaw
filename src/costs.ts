/**
 * costs.ts
 *
 * Token usage tracking and cost estimation for ALL providers.
 *
 * Tracks estimated input/output tokens per API call and calculates
 * approximate spend. Sends budget alerts via Discord when daily
 * or monthly thresholds are crossed.
 *
 * Token counts are ESTIMATES (~4 chars per token). The goal is
 * directional awareness ("am I spending $2/day or $20/day?"),
 * not accounting-grade precision.
 *
 * Pricing as of March 2026 (USD per million tokens):
 *
 * ANTHROPIC:
 *   Opus 4.5/4.6     = $5.00 input / $25.00 output
 *   Sonnet 4.5/4.6   = $3.00 input / $15.00 output
 *   Haiku 4.5        = $1.00 input / $5.00 output
 *
 * OPENAI:
 *   GPT-4o           = $2.50 input / $10.00 output
 *   GPT-4o-mini      = $0.15 input / $0.60 output
 *   o4-mini          = $1.10 input / $4.40 output
 *   GPT-4.1          = $2.00 input / $8.00 output
 *
 * GOOGLE GEMINI:
 *   2.5 Pro          = $1.25 input / $10.00 output
 *   2.5 Flash        = $0.15 input / $0.60 output
 *
 * OLLAMA (local):
 *   Any model         = $0.00 / $0.00
 */

import { db } from './db.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// ============================
// PRICING TABLE (per million tokens)
// ============================
interface ModelPricing {
    input: number;
    output: number;
}

const PRICING: Record<string, ModelPricing> = {
    // --- Anthropic ---
    'claude-opus-4-6':      { input: 5.00,  output: 25.00 },
    'claude-opus-4-5':      { input: 5.00,  output: 25.00 },
    'claude-sonnet-4-6':    { input: 3.00,  output: 15.00 },
    'claude-sonnet-4-5':    { input: 3.00,  output: 15.00 },
    'claude-haiku-4-5':     { input: 1.00,  output: 5.00  },

    // --- OpenAI ---
    'gpt-4o':               { input: 2.50,  output: 10.00 },
    'gpt-4o-mini':          { input: 0.15,  output: 0.60  },
    'o4-mini':              { input: 1.10,  output: 4.40  },
    'gpt-4.1':              { input: 2.00,  output: 8.00  },
    'gpt-4.1-mini':         { input: 0.40,  output: 1.60  },

    // --- Google Gemini ---
    'gemini-2.5-pro-preview-03-25': { input: 1.25, output: 10.00 },
    'gemini-2.5-pro':       { input: 1.25,  output: 10.00 },
    'gemini-2.5-flash':     { input: 0.15,  output: 0.60  },
    'gemini-2.0-flash':     { input: 0.10,  output: 0.40  },

    // --- Ollama (local, free) ---
    'llama3.1:8b':          { input: 0, output: 0 },
    'mistral:7b':           { input: 0, output: 0 },
};

// Fallback pricing by model family keyword
const FAMILY_PRICING: Array<{ pattern: string; pricing: ModelPricing }> = [
    { pattern: 'opus',       pricing: { input: 5.00, output: 25.00 } },
    { pattern: 'sonnet',     pricing: { input: 3.00, output: 15.00 } },
    { pattern: 'haiku',      pricing: { input: 1.00, output: 5.00  } },
    { pattern: 'gpt-4o-mini',pricing: { input: 0.15, output: 0.60  } },
    { pattern: '4o-mini',    pricing: { input: 0.15, output: 0.60  } },
    { pattern: 'gpt-4o',     pricing: { input: 2.50, output: 10.00 } },
    { pattern: 'gpt-4.1-mini', pricing: { input: 0.40, output: 1.60 } },
    { pattern: 'gpt-4.1',   pricing: { input: 2.00, output: 8.00  } },
    { pattern: 'o4-mini',    pricing: { input: 1.10, output: 4.40  } },
    { pattern: 'flash',      pricing: { input: 0.15, output: 0.60  } },
    { pattern: 'pro',        pricing: { input: 1.25, output: 10.00 } },
    { pattern: 'llama',      pricing: { input: 0, output: 0 } },
    { pattern: 'mistral',    pricing: { input: 0, output: 0 } },
    { pattern: 'qwen',       pricing: { input: 0, output: 0 } },
    { pattern: 'gemma',      pricing: { input: 0, output: 0 } },
    { pattern: 'deepseek',   pricing: { input: 0, output: 0 } },
];

const DEFAULT_PRICING: ModelPricing = { input: 3.00, output: 15.00 };

function getPricing(model: string): ModelPricing {
    if (PRICING[model]) return PRICING[model];

    const lower = model.toLowerCase();

    // Try exact substring match in pricing table
    for (const [key, pricing] of Object.entries(PRICING)) {
        if (lower.includes(key) || key.includes(lower)) return pricing;
    }

    // Try family keyword match
    for (const { pattern, pricing } of FAMILY_PRICING) {
        if (lower.includes(pattern)) return pricing;
    }

    return DEFAULT_PRICING;
}

// ============================
// DATABASE SETUP
// ============================
export function initCosts(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            tier TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd REAL NOT NULL DEFAULT 0,
            task_source TEXT NOT NULL DEFAULT 'user'
        )
    `);

    console.log('[Costs] Token usage tracking initialized.');
}

// ============================
// TOKEN ESTIMATION
// ============================
export function estimateTokens(text: string): number {
    return Math.ceil((text?.length || 0) / 4);
}

/**
 * Estimate input tokens for a full message array (system prompt + history).
 */
export function estimateInputTokens(systemPrompt: string, messages: any[]): number {
    let total = estimateTokens(systemPrompt);
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            total += estimateTokens(msg.content);
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') total += estimateTokens(part);
                else if (part.text) total += estimateTokens(part.text);
                else if (part.content) total += estimateTokens(typeof part.content === 'string' ? part.content : JSON.stringify(part.content));
            }
        }
    }
    return total;
}

// ============================
// LOG TOKEN USAGE
// ============================
export function logTokenUsage(opts: {
    provider: string;
    model: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
    taskSource?: string;
}): void {
    const pricing = getPricing(opts.model);
    const cost = (opts.inputTokens * pricing.input / 1_000_000) +
                 (opts.outputTokens * pricing.output / 1_000_000);

    try {
        db.prepare(`
            INSERT INTO token_usage (provider, model, tier, input_tokens, output_tokens, estimated_cost_usd, task_source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            opts.provider,
            opts.model,
            opts.tier,
            opts.inputTokens,
            opts.outputTokens,
            Math.round(cost * 1_000_000) / 1_000_000,
            opts.taskSource || 'user',
        );
    } catch (e: any) {
        console.error('[Costs] Failed to log token usage:', e.message);
    }
}

// ============================
// QUERIES
// ============================

/** Today's total spend */
export function getTodaySpend(): { totalUsd: number; callCount: number; inputTokens: number; outputTokens: number } {
    const row = db.prepare(`
        SELECT
            COALESCE(SUM(estimated_cost_usd), 0) as totalUsd,
            COUNT(*) as callCount,
            COALESCE(SUM(input_tokens), 0) as inputTokens,
            COALESCE(SUM(output_tokens), 0) as outputTokens
        FROM token_usage
        WHERE DATE(timestamp) = DATE('now')
    `).get() as any;
    return row;
}

/** Spend over the last N days */
export function getSpendByPeriod(days: number): { totalUsd: number; callCount: number } {
    const row = db.prepare(`
        SELECT
            COALESCE(SUM(estimated_cost_usd), 0) as totalUsd,
            COUNT(*) as callCount
        FROM token_usage
        WHERE timestamp > datetime('now', '-' || ? || ' days')
    `).get(days) as any;
    return row;
}

/** Spend broken down by provider */
export function getSpendByProvider(days = 7): any[] {
    return db.prepare(`
        SELECT
            provider,
            COUNT(*) as calls,
            SUM(input_tokens) as total_input_tokens,
            SUM(output_tokens) as total_output_tokens,
            ROUND(SUM(estimated_cost_usd), 4) as total_usd,
            ROUND(AVG(estimated_cost_usd), 6) as avg_cost_per_call
        FROM token_usage
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY provider
        ORDER BY total_usd DESC
    `).all(days) as any[];
}

/** Spend broken down by model */
export function getSpendByModel(days = 7): any[] {
    return db.prepare(`
        SELECT
            provider,
            model,
            tier,
            COUNT(*) as calls,
            SUM(input_tokens) as total_input_tokens,
            SUM(output_tokens) as total_output_tokens,
            ROUND(SUM(estimated_cost_usd), 4) as total_usd
        FROM token_usage
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY provider, model, tier
        ORDER BY total_usd DESC
    `).all(days) as any[];
}

/** Spend broken down by task source */
export function getSpendBySource(days = 7): any[] {
    return db.prepare(`
        SELECT
            task_source,
            COUNT(*) as calls,
            ROUND(SUM(estimated_cost_usd), 4) as total_usd,
            ROUND(SUM(CASE WHEN provider = 'ollama' THEN estimated_cost_usd ELSE 0 END), 4) as local_usd,
            ROUND(SUM(CASE WHEN provider != 'ollama' THEN estimated_cost_usd ELSE 0 END), 4) as paid_usd
        FROM token_usage
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY task_source
        ORDER BY total_usd DESC
    `).all(days) as any[];
}

/** Daily spend for the last N days */
export function getDailySpend(days = 14): any[] {
    return db.prepare(`
        SELECT
            DATE(timestamp) as date,
            COUNT(*) as calls,
            ROUND(SUM(estimated_cost_usd), 4) as total_usd,
            SUM(CASE WHEN provider = 'ollama' THEN 1 ELSE 0 END) as free_calls,
            SUM(CASE WHEN provider != 'ollama' THEN 1 ELSE 0 END) as paid_calls,
            ROUND(SUM(CASE WHEN provider != 'ollama' THEN estimated_cost_usd ELSE 0 END), 4) as paid_usd
        FROM token_usage
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
    `).all(days) as any[];
}

/** Savings from Ollama: how much would those calls have cost on Haiku? */
export function getOllamaSavings(days = 7): { localCalls: number; estimatedSavedUsd: number } {
    const rows = db.prepare(`
        SELECT input_tokens, output_tokens
        FROM token_usage
        WHERE provider = 'ollama'
          AND timestamp > datetime('now', '-' || ? || ' days')
    `).all(days) as any[];

    // Calculate what these calls would have cost on Haiku ($1/$5 per MTok)
    let savedUsd = 0;
    for (const row of rows) {
        savedUsd += (row.input_tokens * 1.00 / 1_000_000) + (row.output_tokens * 5.00 / 1_000_000);
    }

    return {
        localCalls: rows.length,
        estimatedSavedUsd: Math.round(savedUsd * 10000) / 10000,
    };
}

// ============================
// BUDGET ALERTS
// ============================
const DAILY_BUDGET_USD = parseFloat(process.env.DAILY_BUDGET_USD || '5.00');
const MONTHLY_BUDGET_USD = parseFloat(process.env.MONTHLY_BUDGET_USD || '50.00');

let _lastDailyAlert: string = '';
let _lastMonthlyAlert: string = '';

/**
 * Check if budget thresholds are crossed. Returns alert message or null.
 * Call this after logging token usage.
 */
export function checkBudgetAlerts(): string | null {
    const today = new Date().toDateString();
    const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    // Daily check
    if (_lastDailyAlert !== today) {
        const todaySpend = getTodaySpend();
        if (todaySpend.totalUsd >= DAILY_BUDGET_USD) {
            _lastDailyAlert = today;
            return `⚠️ **Daily budget alert**: You've spent ~$${todaySpend.totalUsd.toFixed(2)} today (budget: $${DAILY_BUDGET_USD.toFixed(2)}). ${todaySpend.callCount} API calls so far.`;
        }
    }

    // Monthly check
    if (_lastMonthlyAlert !== thisMonth) {
        const monthSpend = getSpendByPeriod(30);
        if (monthSpend.totalUsd >= MONTHLY_BUDGET_USD) {
            _lastMonthlyAlert = thisMonth;
            return `🚨 **Monthly budget alert**: Estimated ~$${monthSpend.totalUsd.toFixed(2)} in the last 30 days (budget: $${MONTHLY_BUDGET_USD.toFixed(2)}). Consider moving more tasks to the local model.`;
        }
    }

    return null;
}

// ============================
// COST REPORT
// ============================
export function generateCostReport(): string {
    const providerStats = getSpendByProvider(7);
    const modelStats = getSpendByModel(7);
    const sourceStats = getSpendBySource(7);
    const dailyStats = getDailySpend(7);
    const savings = getOllamaSavings(7);
    const todaySpend = getTodaySpend();
    const monthSpend = getSpendByPeriod(30);

    let report = `# Gravity Claw — Cost Report\n`;
    report += `Generated: ${new Date().toISOString().split('T')[0]}\n\n`;

    // Summary
    report += `## Summary\n\n`;
    report += `| Period | Estimated Spend | API Calls |\n`;
    report += `|--------|----------------|----------|\n`;
    report += `| Today | $${todaySpend.totalUsd.toFixed(4)} | ${todaySpend.callCount} |\n`;
    report += `| Last 7 days | $${providerStats.reduce((s: number, r: any) => s + r.total_usd, 0).toFixed(4)} | ${providerStats.reduce((s: number, r: any) => s + r.calls, 0)} |\n`;
    report += `| Last 30 days | $${monthSpend.totalUsd.toFixed(4)} | ${monthSpend.callCount} |\n\n`;

    // Ollama savings
    if (savings.localCalls > 0) {
        report += `## Ollama Savings (Last 7 Days)\n\n`;
        report += `${savings.localCalls} tasks ran on local LLM for free.\n`;
        report += `Estimated savings: **$${savings.estimatedSavedUsd.toFixed(4)}** (what it would have cost on Haiku).\n\n`;
    }

    // By provider
    report += `## Spend by Provider (Last 7 Days)\n\n`;
    if (providerStats.length === 0) {
        report += `No usage recorded yet.\n\n`;
    } else {
        report += `| Provider | Calls | Input Tokens | Output Tokens | Cost |\n`;
        report += `|----------|-------|-------------|--------------|------|\n`;
        for (const r of providerStats) {
            report += `| ${r.provider} | ${r.calls} | ${r.total_input_tokens?.toLocaleString()} | ${r.total_output_tokens?.toLocaleString()} | $${r.total_usd} |\n`;
        }
        report += `\n`;
    }

    // By model
    report += `## Spend by Model (Last 7 Days)\n\n`;
    if (modelStats.length > 0) {
        report += `| Provider | Model | Tier | Calls | Cost |\n`;
        report += `|----------|-------|------|-------|------|\n`;
        for (const r of modelStats) {
            report += `| ${r.provider} | ${r.model} | ${r.tier} | ${r.calls} | $${r.total_usd} |\n`;
        }
        report += `\n`;
    }

    // By source
    report += `## Spend by Task Source (Last 7 Days)\n\n`;
    if (sourceStats.length > 0) {
        report += `| Source | Calls | Paid Cost | Free (Ollama) |\n`;
        report += `|--------|-------|-----------|---------------|\n`;
        for (const r of sourceStats) {
            report += `| ${r.task_source} | ${r.calls} | $${r.paid_usd} | $${r.local_usd} |\n`;
        }
        report += `\n`;
    }

    // Daily trend
    report += `## Daily Trend\n\n`;
    if (dailyStats.length > 0) {
        report += `| Date | Paid Calls | Free Calls | Paid Cost |\n`;
        report += `|------|-----------|------------|----------|\n`;
        for (const r of dailyStats) {
            report += `| ${r.date} | ${r.paid_calls} | ${r.free_calls} | $${r.paid_usd} |\n`;
        }
        report += `\n`;
    }

    // Budget status
    report += `## Budget Status\n\n`;
    report += `| Budget | Limit | Current | Status |\n`;
    report += `|--------|-------|---------|--------|\n`;
    const dailyPct = Math.round((todaySpend.totalUsd / DAILY_BUDGET_USD) * 100);
    const monthlyPct = Math.round((monthSpend.totalUsd / MONTHLY_BUDGET_USD) * 100);
    report += `| Daily | $${DAILY_BUDGET_USD.toFixed(2)} | $${todaySpend.totalUsd.toFixed(4)} | ${dailyPct}% ${dailyPct >= 100 ? '⚠️' : '✅'} |\n`;
    report += `| Monthly (30d) | $${MONTHLY_BUDGET_USD.toFixed(2)} | $${monthSpend.totalUsd.toFixed(4)} | ${monthlyPct}% ${monthlyPct >= 100 ? '🚨' : '✅'} |\n\n`;

    return report;
}

/** Save cost report to Obsidian vault */
export function saveCostReport(): void {
    try {
        const report = generateCostReport();
        const reportsDir = path.join(config.obsidianPath, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const date = new Date().toISOString().split('T')[0];
        fs.writeFileSync(path.join(reportsDir, `cost-report-${date}.md`), report);
        console.log(`[Costs] Saved cost report for ${date}.`);
    } catch (e: any) {
        console.error('[Costs] Failed to save report:', e.message);
    }
}
