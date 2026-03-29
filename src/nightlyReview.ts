import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { db } from './db.js';
import { bot } from './bot.js';
import { handleHeartbeatTask } from './agent.js';
import { today, ensureDir, readFileIfExists } from './fileUtils.js';

function getTodayConversations(): string {
    try {
        const rows = db.prepare(`
            SELECT role, content, timestamp
            FROM conversation_messages
            WHERE timestamp > datetime('now', '-24 hours')
            ORDER BY timestamp ASC
            LIMIT 50
        `).all() as any[];

        if (rows.length === 0) return 'No conversations today.';
        return rows.map((r: any) =>
            `[${r.timestamp}] ${r.role}: ${r.content.substring(0, 300)}`
        ).join('\n').substring(0, 6000);
    } catch {
        return 'Conversation history unavailable.';
    }
}

function getTodayObservations(): string {
    const todayFile = path.join(config.obsidianPath, 'observations', `${today()}.md`);
    return readFileIfExists(todayFile, 2000);
}

// ============================
// MAIN
// ============================

export async function runNightlyReview(): Promise<void> {
    console.log('[Review] Starting nightly review...');
    const startTime = Date.now();

    const dreamCycleDir = path.join(config.obsidianPath, 'dream-cycle');
    const reviewsDir = path.join(dreamCycleDir, 'reviews');
    ensureDir(reviewsDir);

    // All file I/O in TypeScript before building the prompt
    const dreamLog = readFileIfExists(path.join(dreamCycleDir, `${today()}.md`), 4000);
    const conversations = getTodayConversations();
    const observations = getTodayObservations();
    const goalsPath = path.join(config.obsidianPath, 'goals.md');
    const goals = readFileIfExists(goalsPath, 2000);
    const tacitKnowledge = readFileIfExists(path.join(config.obsidianPath, 'tacit-knowledge.md'), 2000);
    const hasGoals = !!goals;

    if (!hasGoals) {
        console.warn('[Review] No goals.md found — create one for pillar scoring.');
    }

    const reviewPrompt = `You are doing a nightly review for Gravity Claw. Score the day, extract durable lessons, and plan tomorrow.

${hasGoals ? `## Goals & Pillars\n${goals}\n` : ''}
## Today's Dream Cycle Output
${dreamLog || '(No dream cycle ran today)'}

## Today's Conversations (last 24h)
${conversations}

## Today's Observations
${observations || '(No observations today)'}

${tacitKnowledge ? `## Existing Tacit Knowledge (for continuity — do not repeat these)\n${tacitKnowledge}\n` : ''}

## Your task

### Part 1: Day Scores
${hasGoals
    ? 'Score the day 1-5 for each goal/pillar from goals.md. Justify each score with specific evidence from conversations and observations above.'
    : 'Score general productivity 1-5 (no goals.md found).'}
Also score general productivity separately.

Format:
### Day Scores
${hasGoals ? '- [Pillar name]: X/5 — [brief justification with evidence]\n' : ''}- Productivity: X/5 — [brief justification]
**Average: X/5**

### Part 2: Tomorrow's Plan
Based on dream cycle proposals and today's weaknesses, what is the single most important thing to do tomorrow? List 2-3 supporting actions.

Format:
### Tomorrow's Plan
**#1 Priority:** [specific actionable task]
**Supporting:**
- [action]
- [action]

### Part 3: Durable Lessons
1-3 things learned today that generalize beyond today. Not daily minutiae. Examples of good lessons: "Ollama handles classification reliably but fails on tool formatting", "Reddit old.reddit.com avoids login walls". Examples of bad lessons: "Checked email today".

Format:
### Lessons Learned
- [Lesson title]: [brief explanation of what was observed]`;

    let reviewOutput = '';
    try {
        reviewOutput = await handleHeartbeatTask(reviewPrompt);
        console.log('[Review] Review generated.');
    } catch (e: any) {
        reviewOutput = `REVIEW FAILED: ${e.message}`;
        console.error('[Review] Review generation failed:', e.message);
    }

    // Save review to reviews/YYYY-MM-DD.md
    try {
        const header = `# Nightly Review — ${today()}\nCompleted: ${new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' })} PT\n\n`;
        fs.writeFileSync(path.join(reviewsDir, `${today()}.md`), header + reviewOutput);
    } catch (e: any) {
        console.error('[Review] Failed to save review:', e.message);
    }

    // Append lessons to tacit-knowledge.md — append-only, never clean up
    try {
        const lessonsMatch = reviewOutput.match(/### Lessons Learned\n([\s\S]*?)(?:\n###|$)/);
        if (lessonsMatch) {
            const lessons = lessonsMatch[1].trim();
            if (lessons && lessons.toLowerCase() !== 'none' && lessons.length > 10) {
                const tacitPath = path.join(config.obsidianPath, 'tacit-knowledge.md');
                fs.appendFileSync(tacitPath, `\n---\n### ${today()}\n${lessons}\n`);
            }
        }
    } catch (e: any) {
        console.error('[Review] Failed to append tacit knowledge:', e.message);
    }

    // Discord DM — short bedtime ping (under 500 chars)
    try {
        const scoreMatch = reviewOutput.match(/\*\*Average: ([\d.]+)\/5\*\*/);
        const avgScore = scoreMatch ? scoreMatch[1] : '?';

        const priorityMatch = reviewOutput.match(/\*\*#1 Priority:\*\* (.+)/);
        const tomorrowPriority = priorityMatch ? priorityMatch[1].trim() : '(see review)';

        const lessonsSection = reviewOutput.match(/### Lessons Learned\n([\s\S]*?)(?:\n###|$)/);
        const firstLesson = lessonsSection ? lessonsSection[1].match(/- (.+)/) : null;
        const topLesson = firstLesson ? firstLesson[0].trim() : '(see review)';

        let msg = `🌃 **Nightly Review — ${today()}**\nDay: **${avgScore}/5**\nTomorrow: ${tomorrowPriority}\nLesson: ${topLesson}`;
        if (msg.length > 500) msg = msg.substring(0, 497) + '...';

        const user = await bot.users.fetch(config.discordUserId);
        await user.send(msg);
    } catch (e: any) {
        console.error('[Review] Failed to send Discord DM:', e.message);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Review] Nightly review complete. Duration: ~${Math.round(durationMs / 1000)}s.`);
}
