/**
 * tracker.ts
 *
 * Skill Execution Tracker — the self-assessment system.
 *
 * Every time the agent handles a task, this module logs:
 *   - What was the task (truncated)
 *   - Which provider handled it (claude, openai, gemini, ollama)
 *   - Which model was used
 *   - How many tool calls were made
 *   - Which tools were called
 *   - Did it succeed or fail
 *   - How long it took (ms)
 *   - What tier was it routed to
 *
 * Over time, this data is used to:
 *   - Suggest which skills can be moved to local LLM
 *   - Detect skills that keep failing on local and should be moved back
 *   - Show you a dashboard of token usage patterns
 */

import { db } from './db.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// ============================
// DATABASE SETUP
// ============================
export function initTracker(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS execution_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            task_text TEXT NOT NULL,
            task_source TEXT NOT NULL DEFAULT 'user',
            tier TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            tool_count INTEGER NOT NULL DEFAULT 0,
            tools_used TEXT NOT NULL DEFAULT '[]',
            success INTEGER NOT NULL DEFAULT 1,
            error_message TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            skill_name TEXT
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS skill_stats (
            skill_name TEXT PRIMARY KEY,
            total_runs INTEGER NOT NULL DEFAULT 0,
            successful_runs INTEGER NOT NULL DEFAULT 0,
            avg_tool_calls REAL NOT NULL DEFAULT 0,
            max_tool_calls INTEGER NOT NULL DEFAULT 0,
            avg_duration_ms REAL NOT NULL DEFAULT 0,
            tools_ever_used TEXT NOT NULL DEFAULT '[]',
            current_tier TEXT NOT NULL DEFAULT 'heartbeat',
            recommended_tier TEXT,
            last_run DATETIME,
            local_success_count INTEGER NOT NULL DEFAULT 0,
            local_fail_count INTEGER NOT NULL DEFAULT 0
        )
    `);

    console.log('[Tracker] Execution tracking initialized.');
}

// ============================
// EXECUTION CONTEXT — tracks a single task execution
// ============================
export interface ExecutionContext {
    taskText: string;
    taskSource: 'user' | 'cron' | 'heartbeat' | 'delegate';
    tier: string;
    provider: string;
    model: string;
    toolCalls: string[];
    startTime: number;
    skillName?: string;
}

export function startTracking(opts: {
    taskText: string;
    taskSource: 'user' | 'cron' | 'heartbeat' | 'delegate';
    tier: string;
    provider: string;
    model: string;
    skillName?: string;
}): ExecutionContext {
    return {
        ...opts,
        toolCalls: [],
        startTime: Date.now(),
    };
}

export function trackToolCall(ctx: ExecutionContext, toolName: string): void {
    ctx.toolCalls.push(toolName);
}

export function finishTracking(ctx: ExecutionContext, success: boolean, errorMessage?: string): void {
    const duration = Date.now() - ctx.startTime;

    try {
        // Log the execution
        db.prepare(`
            INSERT INTO execution_log (task_text, task_source, tier, provider, model, tool_count, tools_used, success, error_message, duration_ms, skill_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            ctx.taskText.substring(0, 500),
            ctx.taskSource,
            ctx.tier,
            ctx.provider,
            ctx.model,
            ctx.toolCalls.length,
            JSON.stringify([...new Set(ctx.toolCalls)]), // unique tools
            success ? 1 : 0,
            errorMessage || null,
            duration,
            ctx.skillName || null,
        );

        // Update skill stats if this is a known skill
        if (ctx.skillName) {
            updateSkillStats(ctx.skillName, ctx.toolCalls.length, [...new Set(ctx.toolCalls)], success, duration, ctx.provider, ctx.tier);
        }

        const toolSummary = ctx.toolCalls.length > 0
            ? ` | ${ctx.toolCalls.length} tools: [${[...new Set(ctx.toolCalls)].join(', ')}]`
            : '';
        console.log(`[Tracker] ${success ? '✓' : '✗'} ${ctx.provider}/${ctx.model} | ${ctx.tier} | ${duration}ms${toolSummary}`);

    } catch (e: any) {
        console.error('[Tracker] Failed to log execution:', e.message);
    }
}

// ============================
// SKILL STATS AGGREGATION
// ============================
function updateSkillStats(
    skillName: string,
    toolCount: number,
    toolsUsed: string[],
    success: boolean,
    durationMs: number,
    provider: string,
    tier: string
): void {
    const existing = db.prepare('SELECT * FROM skill_stats WHERE skill_name = ?').get(skillName) as any;

    if (!existing) {
        // First run of this skill
        db.prepare(`
            INSERT INTO skill_stats (skill_name, total_runs, successful_runs, avg_tool_calls, max_tool_calls, avg_duration_ms, tools_ever_used, current_tier, last_run, local_success_count, local_fail_count)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        `).run(
            skillName,
            success ? 1 : 0,
            toolCount,
            toolCount,
            durationMs,
            JSON.stringify(toolsUsed),
            tier,
            (provider === 'ollama' && success) ? 1 : 0,
            (provider === 'ollama' && !success) ? 1 : 0,
        );
        return;
    }

    // Update running averages
    const newTotal = existing.total_runs + 1;
    const newSuccessful = existing.successful_runs + (success ? 1 : 0);
    const newAvgTools = ((existing.avg_tool_calls * existing.total_runs) + toolCount) / newTotal;
    const newMaxTools = Math.max(existing.max_tool_calls, toolCount);
    const newAvgDuration = ((existing.avg_duration_ms * existing.total_runs) + durationMs) / newTotal;

    // Merge tools ever used
    const existingTools: string[] = JSON.parse(existing.tools_ever_used || '[]');
    const allTools = [...new Set([...existingTools, ...toolsUsed])];

    const localSuccess = existing.local_success_count + ((provider === 'ollama' && success) ? 1 : 0);
    const localFail = existing.local_fail_count + ((provider === 'ollama' && !success) ? 1 : 0);

    // Calculate recommended tier
    const recommended = computeRecommendedTier(newAvgTools, newMaxTools, newSuccessful / newTotal, localSuccess, localFail);

    db.prepare(`
        UPDATE skill_stats SET
            total_runs = ?,
            successful_runs = ?,
            avg_tool_calls = ?,
            max_tool_calls = ?,
            avg_duration_ms = ?,
            tools_ever_used = ?,
            current_tier = ?,
            recommended_tier = ?,
            last_run = CURRENT_TIMESTAMP,
            local_success_count = ?,
            local_fail_count = ?
        WHERE skill_name = ?
    `).run(
        newTotal,
        newSuccessful,
        Math.round(newAvgTools * 100) / 100,
        newMaxTools,
        Math.round(newAvgDuration),
        JSON.stringify(allTools),
        tier,
        recommended,
        localSuccess,
        localFail,
        skillName,
    );
}

function computeRecommendedTier(
    avgToolCalls: number,
    maxToolCalls: number,
    successRate: number,
    localSuccessCount: number,
    localFailCount: number
): string {
    // Rule 1: If it consistently fails on local, move it back to paid
    if (localFailCount >= 3 && localSuccessCount < localFailCount) {
        return 'heartbeat'; // Back to cheapest paid tier
    }

    // Rule 2: If it uses many tools, keep on paid (local models struggle with long tool chains)
    if (avgToolCalls > 3 || maxToolCalls > 5) {
        return 'light';
    }

    // Rule 3: If it uses moderate tools but succeeds reliably, light tier
    if (avgToolCalls > 1.5 && successRate > 0.8) {
        return 'heartbeat';
    }

    // Rule 4: Simple tasks with low tool usage → local candidate
    if (avgToolCalls <= 2 && successRate > 0.7) {
        return 'local';
    }

    // Rule 5: No tools at all → definitely local
    if (avgToolCalls === 0) {
        return 'local';
    }

    return 'heartbeat'; // Safe default
}

// ============================
// QUERIES — for the agent and user to inspect
// ============================

/** Get stats for a specific skill */
export function getSkillStats(skillName: string): any {
    return db.prepare('SELECT * FROM skill_stats WHERE skill_name = ?').get(skillName);
}

/** Get all skills with their recommendations */
export function getAllSkillStats(): any[] {
    return db.prepare('SELECT * FROM skill_stats ORDER BY total_runs DESC').all();
}

/** Get skills that are recommended for a different tier than their current one */
export function getSkillRecommendations(): any[] {
    return db.prepare(`
        SELECT * FROM skill_stats
        WHERE recommended_tier IS NOT NULL
          AND recommended_tier != current_tier
          AND total_runs >= 3
        ORDER BY total_runs DESC
    `).all();
}

/** Get recent execution log */
export function getRecentExecutions(limit = 20): any[] {
    return db.prepare(`
        SELECT * FROM execution_log
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(limit);
}

/** Get execution summary by provider (for cost awareness) */
export function getProviderSummary(days = 7): any[] {
    return db.prepare(`
        SELECT
            provider,
            model,
            tier,
            COUNT(*) as call_count,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
            ROUND(AVG(tool_count), 1) as avg_tools,
            ROUND(AVG(duration_ms)) as avg_duration_ms
        FROM execution_log
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY provider, model, tier
        ORDER BY call_count DESC
    `).all(days);
}

/** Get daily execution counts (for trend tracking) */
export function getDailyStats(days = 14): any[] {
    return db.prepare(`
        SELECT
            DATE(timestamp) as date,
            COUNT(*) as total_calls,
            SUM(CASE WHEN provider = 'ollama' THEN 1 ELSE 0 END) as local_calls,
            SUM(CASE WHEN provider != 'ollama' THEN 1 ELSE 0 END) as paid_calls,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
        FROM execution_log
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
    `).all(days);
}

// ============================
// REPORT GENERATOR — writes a Markdown report to Obsidian
// ============================
export function generateTrackingReport(): string {
    const providerStats = getProviderSummary(7);
    const recommendations = getSkillRecommendations();
    const dailyStats = getDailyStats(7);
    const allSkills = getAllSkillStats();

    let report = `# Gravity Claw — Execution Report\n`;
    report += `Generated: ${new Date().toISOString().split('T')[0]}\n\n`;

    // Provider usage
    report += `## Provider Usage (Last 7 Days)\n\n`;
    if (providerStats.length === 0) {
        report += `No executions recorded yet.\n\n`;
    } else {
        report += `| Provider | Model | Tier | Calls | Success | Avg Tools | Avg Time |\n`;
        report += `|----------|-------|------|-------|---------|-----------|----------|\n`;
        for (const row of providerStats) {
            report += `| ${row.provider} | ${row.model} | ${row.tier} | ${row.call_count} | ${row.success_count}/${row.call_count} | ${row.avg_tools} | ${row.avg_duration_ms}ms |\n`;
        }
        report += `\n`;
    }

    // Daily trend
    report += `## Daily Activity\n\n`;
    if (dailyStats.length > 0) {
        report += `| Date | Total | Local (free) | Paid | Failures |\n`;
        report += `|------|-------|-------------|------|----------|\n`;
        for (const row of dailyStats) {
            report += `| ${row.date} | ${row.total_calls} | ${row.local_calls} | ${row.paid_calls} | ${row.failures} |\n`;
        }
        report += `\n`;
    }

    // Skill recommendations
    if (recommendations.length > 0) {
        report += `## Recommendations\n\n`;
        report += `These skills have enough data to suggest a tier change:\n\n`;
        for (const skill of recommendations) {
            const direction = skill.recommended_tier === 'local' ? '⬇️ Move to local (save tokens)' : '⬆️ Move to paid (improve reliability)';
            report += `- **${skill.skill_name}**: Currently \`${skill.current_tier}\` → Recommend \`${skill.recommended_tier}\` ${direction}\n`;
            report += `  - Runs: ${skill.total_runs} | Avg tools: ${skill.avg_tool_calls} | Success: ${Math.round((skill.successful_runs / skill.total_runs) * 100)}%\n`;
            if (skill.local_fail_count > 0) {
                report += `  - Local model: ${skill.local_success_count} successes, ${skill.local_fail_count} failures\n`;
            }
        }
        report += `\n`;
    }

    // All tracked skills
    if (allSkills.length > 0) {
        report += `## All Tracked Skills\n\n`;
        report += `| Skill | Runs | Success | Avg Tools | Max Tools | Current Tier | Recommended |\n`;
        report += `|-------|------|---------|-----------|-----------|-------------|-------------|\n`;
        for (const s of allSkills) {
            const successPct = s.total_runs > 0 ? Math.round((s.successful_runs / s.total_runs) * 100) + '%' : '-';
            report += `| ${s.skill_name} | ${s.total_runs} | ${successPct} | ${s.avg_tool_calls} | ${s.max_tool_calls} | ${s.current_tier} | ${s.recommended_tier || '-'} |\n`;
        }
        report += `\n`;
    }

    return report;
}

/** Save report to Obsidian vault */
export function saveTrackingReport(): void {
    try {
        const report = generateTrackingReport();
        const reportsDir = path.join(config.obsidianPath, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const date = new Date().toISOString().split('T')[0];
        fs.writeFileSync(path.join(reportsDir, `execution-report-${date}.md`), report);
        console.log(`[Tracker] Saved execution report for ${date}.`);
    } catch (e: any) {
        console.error('[Tracker] Failed to save report:', e.message);
    }
}
