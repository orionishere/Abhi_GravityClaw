import { config } from './config.js';
import { db } from './db.js';
import { handleHeartbeatTask } from './agent.js';
import fs from 'fs';
import path from 'path';

const OBSERVATIONS_DIR = path.join(config.obsidianPath, 'observations');

// Ensure observations directory exists
function ensureObsDir(): void {
    if (!fs.existsSync(OBSERVATIONS_DIR)) {
        fs.mkdirSync(OBSERVATIONS_DIR, { recursive: true });
    }
}

// Get today's date as YYYY-MM-DD
function today(): string {
    return new Date().toISOString().split('T')[0];
}

// Get current time as HH:MM
function nowTime(): string {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ============================
// DATA GATHERING
// ============================

// Pull recent memories from SQLite (last 24 hours)
function getRecentMemories(): string {
    try {
        const rows = db.prepare(
            `SELECT topic, content, timestamp FROM memories 
             WHERE timestamp > datetime('now', '-24 hours') 
             ORDER BY timestamp DESC LIMIT 10`
        ).all() as any[];

        if (rows.length === 0) return 'No recent memories.';

        return rows.map((r: any) =>
            `[${r.timestamp}] ${r.topic}: ${r.content.substring(0, 200)}`
        ).join('\n');
    } catch {
        return 'Memory system unavailable.';
    }
}

// Check for recently modified files in Obsidian
function getRecentObsidianChanges(): string {
    try {
        const changes: string[] = [];
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

        function scanDir(dir: string, prefix: string = '') {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'observations') continue;
                const fullPath = path.join(dir, entry.name);

                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const stat = fs.statSync(fullPath);
                    if (stat.mtimeMs > cutoff) {
                        changes.push(`${prefix}${entry.name} (modified ${new Date(stat.mtimeMs).toLocaleString()})`);
                    }
                } else if (entry.isDirectory()) {
                    scanDir(fullPath, `${prefix}${entry.name}/`);
                }
            }
        }

        scanDir(config.obsidianPath);

        if (changes.length === 0) return 'No recent Obsidian changes.';
        return changes.slice(0, 5).join('\n');
    } catch {
        return 'Could not scan Obsidian vault.';
    }
}

// ============================
// OBSERVATION ENGINE
// ============================

export async function runObservation(): Promise<void> {
    console.log('[Observe] Running background observation...');
    ensureObsDir();

    // Gather data
    const memories = getRecentMemories();
    const obsidianChanges = getRecentObsidianChanges();

    const prompt = `You are Gravity Claw's background observation system. Your job is to scan recent activity and note anything useful for the user.

## Recent Memories (last 24h)
${memories}

## Recent Obsidian Vault Changes (last 24h)
${obsidianChanges}

## Your Task
Based on the above activity, write 1-5 short observations. Each observation should be:
- One sentence, actionable or informative
- Prefixed with an emoji that indicates urgency: 🔴 urgent, 🟡 notable, 🟢 informational
- Only include genuinely useful insights; if nothing stands out, write just one 🟢 observation

Examples:
- 🔴 GitHub token expires in 3 days — user should renew immediately
- 🟡 User has been working heavily on Python projects — might benefit from a skill review
- 🟢 No urgent items detected — all systems running normally

Write ONLY the observations, one per line. No headers or extra formatting.`;

    try {
        // Routes Claude Haiku → OpenAI mini → Gemini Flash automatically
        const observations = await handleHeartbeatTask(prompt);

        // Append to today's file
        const filePath = path.join(OBSERVATIONS_DIR, `${today()}.md`);
        const entry = `\n### ${nowTime()}\n${observations.trim()}\n`;

        if (fs.existsSync(filePath)) {
            fs.appendFileSync(filePath, entry);
        } else {
            fs.writeFileSync(filePath, `# Observations — ${today()}\n${entry}`);
        }

        console.log(`[Observe] Saved observations to ${today()}.md`);
    } catch (e: any) {
        console.error('[Observe] Observation failed:', e.message);
    }
}

// ============================
// PRECONSCIOUS BUFFER
// ============================
// Returns the latest observations to inject into the system prompt

export function getPreconsciousBuffer(): string {
    ensureObsDir();

    try {
        // Read the most recent observation files (today + yesterday)
        const files = fs.readdirSync(OBSERVATIONS_DIR)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, 2); // Last 2 days

        if (files.length === 0) return '';

        let allObservations: string[] = [];

        for (const file of files) {
            const content = fs.readFileSync(path.join(OBSERVATIONS_DIR, file), 'utf8');
            // Extract observation lines (lines starting with emoji)
            const lines = content.split('\n').filter(l =>
                l.startsWith('🔴') || l.startsWith('🟡') || l.startsWith('🟢')
            );
            allObservations.push(...lines);
        }

        if (allObservations.length === 0) return '';

        // Prioritize: 🔴 first, then 🟡, then 🟢
        const urgent = allObservations.filter(l => l.startsWith('🔴'));
        const notable = allObservations.filter(l => l.startsWith('🟡'));
        const info = allObservations.filter(l => l.startsWith('🟢'));

        const top5 = [...urgent, ...notable, ...info].slice(0, 5);

        return `\n\n---\n## What's On Your Mind (Background Observations)\nBefore responding, consider these recent observations. Naturally weave in any relevant ones:\n${top5.join('\n')}\n---`;

    } catch {
        return '';
    }
}

// ============================
// CLEANUP — Expire old observations
// ============================
export function cleanupOldObservations(): void {
    ensureObsDir();

    try {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
        const files = fs.readdirSync(OBSERVATIONS_DIR).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = path.join(OBSERVATIONS_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(filePath);
                console.log(`[Observe] Cleaned up old observation: ${file}`);
            }
        }
    } catch (e: any) {
        console.error('[Observe] Cleanup error:', e.message);
    }
}
