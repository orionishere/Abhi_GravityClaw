import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { db } from './db.js';
import { bot } from './bot.js';
import { handleHeartbeatTask, handleDreamTask } from './agent.js';

// ============================
// CONFIG TYPES & DEFAULTS
// ============================

interface DreamSource {
    name: string;
    url?: string;
    type: 'browser' | 'twitter';
    query?: string;
}

interface DreamConfig {
    enabled: boolean;
    topics: string[];
    sources: DreamSource[];
    goalsFile: string;
    maxScanSources: number;
    maxProposals: number;
}

const DEFAULT_CONFIG: DreamConfig = {
    enabled: true,
    topics: [
        'AI agent architecture & design patterns',
        'OpenClaw updates, plugins, community techniques',
        'MCP protocol & new MCP servers',
        'Robotics & hardware',
        'Building in public & developer content creation',
        'Cricket content creation, sports influencer monetization, YouTube and X growth',
        'Roblox and solo game development',
        'Indie game monetization and passive income',
    ],
    sources: [
        { name: 'Hacker News', url: 'https://news.ycombinator.com', type: 'browser' },
        { name: 'GitHub Trending TS', url: 'https://github.com/trending/typescript?since=daily', type: 'browser' },
        { name: 'r/OpenClaw', url: 'https://old.reddit.com/r/openclaw/hot/', type: 'browser' },
        { name: 'r/LocalLLaMA', url: 'https://old.reddit.com/r/LocalLLaMA/hot/', type: 'browser' },
        { name: 'r/gamedev', url: 'https://old.reddit.com/r/gamedev/hot/', type: 'browser' },
        { name: 'r/robloxgamedev', url: 'https://old.reddit.com/r/robloxgamedev/hot/', type: 'browser' },
        { name: 'r/NewTubers', url: 'https://old.reddit.com/r/NewTubers/hot/', type: 'browser' },
        { name: 'r/Cricket', url: 'https://old.reddit.com/r/Cricket/hot/', type: 'browser' },
        { name: 'Anthropic Blog', url: 'https://www.anthropic.com/news', type: 'browser' },
        { name: 'arXiv AI', url: 'https://arxiv.org/list/cs.AI/recent', type: 'browser' },
        { name: 'Cricket Twitter/X', type: 'twitter', query: 'cricket trending OR cricket viral OR cricket strategy OR cricket content creator' },
    ],
    goalsFile: 'goals.md',
    maxScanSources: 6,
    maxProposals: 5,
};

// Reload fresh every cycle — never cache
function loadDreamConfig(): DreamConfig {
    const configPath = path.join(config.dataPath, 'dream_config.json');
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8')) as DreamConfig;
        }
    } catch (e: any) {
        console.warn('[Dream] Failed to load dream_config.json, using defaults:', e.message);
    }
    return DEFAULT_CONFIG;
}

// ============================
// HELPERS
// ============================

function today(): string {
    return new Date().toISOString().split('T')[0];
}

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getDreamCycleDir(): string {
    return path.join(config.obsidianPath, 'dream-cycle');
}

function readFileIfExists(filePath: string, maxLength = 5000): string {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.length > maxLength ? content.substring(0, maxLength) + '\n...[truncated]' : content;
        }
    } catch (e: any) {
        console.warn(`[Dream] Could not read ${filePath}: ${e.message}`);
    }
    return '';
}

function getMostRecentFileInDir(dirPath: string): string {
    if (!fs.existsSync(dirPath)) return '';
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md')).sort().reverse();
    return files.length > 0 ? path.join(dirPath, files[0]) : '';
}

function getObservationsForLastNDays(n: number): string {
    const obsDir = path.join(config.obsidianPath, 'observations');
    if (!fs.existsSync(obsDir)) return 'No observations available.';

    const cutoff = Date.now() - n * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(obsDir)
        .filter(f => f.endsWith('.md'))
        .filter(f => fs.statSync(path.join(obsDir, f)).mtimeMs > cutoff)
        .sort()
        .reverse()
        .slice(0, n);

    if (files.length === 0) return 'No recent observations.';
    return files.map(f => fs.readFileSync(path.join(obsDir, f), 'utf8')).join('\n\n').substring(0, 4000);
}

function getRecentMemoriesForLastNDays(n: number): string {
    try {
        const rows = db.prepare(`
            SELECT topic, content, timestamp FROM memories
            WHERE timestamp > datetime('now', '-' || ? || ' days')
            ORDER BY timestamp DESC LIMIT 20
        `).all(n) as any[];

        if (rows.length === 0) return 'No recent memories.';
        return rows.map((r: any) =>
            `[${r.timestamp}] ${r.topic}: ${r.content.substring(0, 300)}`
        ).join('\n');
    } catch {
        return 'Memory system unavailable.';
    }
}

function saveMemoryEntry(topic: string, content: string): void {
    try {
        db.prepare('INSERT INTO memories (topic, content) VALUES (?, ?)').run(topic, content);
    } catch (e: any) {
        console.error('[Dream] Failed to save memory:', e.message);
    }
}

// ============================
// PHASE 1: SCAN
// ============================

async function phase1Scan(dreamConfig: DreamConfig): Promise<{ queries: string; scanResults: string }> {
    const topicsList = dreamConfig.topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const sourceNames = dreamConfig.sources.map(s => s.name).join(', ');

    // 1a: Query generation — cheap, no tools
    let queries = '';
    try {
        const queryPrompt = `Given these research topics and information sources, generate 1-2 focused search terms per topic that would be most useful when scanning these sources.

Topics:
${topicsList}

Available sources: ${sourceNames}

Output format — for each topic:
Topic: [topic name]
Terms: [term1], [term2]

Be specific and practical — terms that would appear in post titles or discussions on Reddit, HN, or GitHub.`;

        queries = await handleHeartbeatTask(queryPrompt);
        console.log('[Dream] Phase 1a: Query generation complete.');
    } catch (e: any) {
        queries = `PHASE 1a FAILED: ${e.message}`;
        console.error('[Dream] Phase 1a failed:', e.message);
    }

    // 1b: Actual browsing — light tier with tools
    let scanResults = '';
    try {
        const metaNotesPath = path.join(getDreamCycleDir(), 'meta-notes.md');
        const metaNotes = readFileIfExists(metaNotesPath, 3000);
        const metaSection = metaNotes
            ? `\n## Lessons from previous cycles — follow these instructions to avoid past mistakes\n${metaNotes}\n`
            : '';

        const browserSources = dreamConfig.sources
            .filter(s => s.type === 'browser')
            .slice(0, dreamConfig.maxScanSources);
        const twitterSources = dreamConfig.sources.filter(s => s.type === 'twitter');

        const browserList = browserSources.map(s => `- **${s.name}**: ${s.url}`).join('\n');
        const twitterList = twitterSources.map(s =>
            `- **${s.name}**: Use twitter_search_deep with query: "${s.query}"`
        ).join('\n');

        const scanPrompt = `You are scanning information sources for research findings. Extract findings relevant to these topics:

${topicsList}

## Search terms to look for (use these to judge relevance)
${queries}

## Browser sources — use browser_navigate for each URL
${browserList}

## Twitter/X sources — use twitter_search_deep with the query shown
${twitterList}
${metaSection}
## Instructions
1. Use browser_navigate to visit each browser source above
2. Use twitter_search_deep for each Twitter/X source above
3. Extract the TOP 5-8 most relevant findings across all sources
4. If a source is unreachable or behind a login wall, skip it and note it

## Output format for each finding
FINDING: [title]
SOURCE: [url or source name]
SUMMARY: [one sentence]
TYPE: [tool|paper|technique|library|discussion|content-idea]

After all findings, add:
## Process Notes
[Any sources that failed, what happened, and what to try differently next time. If all worked, say so.]`;

        scanResults = await handleDreamTask(scanPrompt);
        console.log('[Dream] Phase 1b: Scan complete.');
    } catch (e: any) {
        scanResults = `PHASE 1b FAILED: ${e.message}`;
        console.error('[Dream] Phase 1b failed:', e.message);
    }

    return { queries, scanResults };
}

// ============================
// PHASE 2: REFLECT
// ============================

async function phase2Reflect(dreamConfig: DreamConfig, scanResults: string): Promise<string> {
    // All file I/O in TypeScript before building the prompt
    const goalsPath = path.join(config.obsidianPath, dreamConfig.goalsFile);
    const goals = readFileIfExists(goalsPath, 3000);
    const memories = getRecentMemoriesForLastNDays(3);
    const observations = getObservationsForLastNDays(3);
    const activeProposals = readFileIfExists(path.join(getDreamCycleDir(), 'active-proposals.md'), 2000);
    const latestReviewPath = getMostRecentFileInDir(path.join(getDreamCycleDir(), 'reviews'));
    const latestReview = latestReviewPath ? readFileIfExists(latestReviewPath, 2000) : '';

    try {
        const reflectPrompt = `You are the reflection system for Gravity Claw. Assess each goal/pillar and identify what needs the most attention tonight.

## Goals & Pillars
${goals || '(No goals.md found — do a general productivity assessment instead)'}

## Recent Memories (last 3 days)
${memories}

## Recent Observations (last 3 days)
${observations}

${activeProposals ? `## Previous Active Proposals (unacted ones may be falling through the cracks)\n${activeProposals}\n` : ''}
${latestReview ? `## Latest Nightly Review\n${latestReview}\n` : ''}
## Today's SCAN findings (for context)
${scanResults.substring(0, 2000)}

## Your task
1. For each goal/pillar, write 1-2 sentences assessing its current state based on evidence above
2. Identify the 1-3 WEAKEST areas with specific evidence. Assign each: CRITICAL, HIGH, or MEDIUM priority
3. Note any previous proposals not yet acted on
4. Be brutally honest — if everything is on track, suggest stretch goals instead

## Output format

## Pillar Assessments
[one assessment per pillar]

## Weakest Areas
1. [Area] — [CRITICAL|HIGH|MEDIUM] — [specific evidence]
...

## Unacted Proposals
[list, or "None found"]

## Reflection Summary
[2-3 sentence honest synthesis]`;

        const result = await handleHeartbeatTask(reflectPrompt);
        console.log('[Dream] Phase 2: Reflect complete.');
        return result;
    } catch (e: any) {
        console.error('[Dream] Phase 2 failed:', e.message);
        return `PHASE 2 FAILED: ${e.message}`;
    }
}

// ============================
// PHASE 3: RESEARCH
// ============================

async function phase3Research(scanResults: string, reflectResults: string): Promise<string> {
    try {
        const researchPrompt = `You are doing deep research for Gravity Claw. Go deeper on the most relevant scan findings.

## Today's SCAN Findings
${scanResults}

## Reflection — Weakest Areas
${reflectResults}

## Your task
1. Pick 1-3 findings from SCAN most relevant to the weakest areas in REFLECT
2. Use browser_navigate to fetch the full content from each finding's source URL (if browser-accessible)
3. For each finding researched, output:

RESEARCH: [title]
URL: [source url]
WHAT: [2-3 sentences describing what it is]
APPLICATION: [specific, actionable way this applies to the weak area identified]
IMPLEMENTATION: [concrete steps to actually apply this]
EFFORT: [trivial|small|medium|large]
IMPACT: [low|medium|high]

If no scan findings are clearly relevant to the weak areas, say so and suggest what to search for instead.
If a URL is not browser-accessible (login wall, Twitter, etc.), summarize from the scan description only.`;

        const result = await handleDreamTask(researchPrompt);
        console.log('[Dream] Phase 3: Research complete.');
        return result;
    } catch (e: any) {
        console.error('[Dream] Phase 3 failed:', e.message);
        return `PHASE 3 FAILED: ${e.message}`;
    }
}

// ============================
// PHASE 4: PROPOSE
// ============================

async function phase4Propose(reflectResults: string, researchResults: string, dreamConfig: DreamConfig): Promise<string> {
    try {
        const proposePrompt = `You are generating tonight's proposals for Gravity Claw. These will appear in the agent's system prompt daily until acted on — make them specific and actionable.

## Reflection — What's weakest
${reflectResults}

## Research — What was found
${researchResults}

## Your task
Generate up to ${dreamConfig.maxProposals} proposals. Revenue, distribution, growth, and monetization proposals always get PRIORITY.

For each proposal use exactly this format:
## Proposal: [clear actionable title]
**Area:** [which goal/pillar]
**Based on:** [which scan finding or reflection insight triggered this]
**What to do:** [specific concrete steps — not vague directions]
**Effort:** [X hours or X days]
**Expected impact:** [what changes if this gets done]
**Priority:** PRIORITY or NORMAL

After all proposals, add:
## Process Notes
[What went wrong during SCAN — login walls, empty results, unreachable URLs, bad queries, rate limits. Be specific so next cycle can improve. If everything worked fine, say so.]`;

        const result = await handleDreamTask(proposePrompt);
        console.log('[Dream] Phase 4: Propose complete.');
        return result;
    } catch (e: any) {
        console.error('[Dream] Phase 4 failed:', e.message);
        return `PHASE 4 FAILED: ${e.message}`;
    }
}

// ============================
// FILE SAVES
// ============================

function saveDreamLog(allPhases: string, durationMs: number): void {
    const dreamDir = getDreamCycleDir();
    ensureDir(dreamDir);

    const durationMin = Math.round(durationMs / 60000);
    const header = `# Dream Cycle — ${today()}\nCompleted: ${new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver' })} PT\nDuration: ~${durationMin} minutes\n\n`;
    fs.writeFileSync(path.join(dreamDir, `${today()}.md`), header + allPhases);
}

function saveActiveProposals(proposeOutput: string): void {
    const dreamDir = getDreamCycleDir();
    ensureDir(dreamDir);

    const proposalBlocks = proposeOutput.match(/## Proposal:[\s\S]*?(?=## Proposal:|## Process Notes|$)/g) || [];
    const proposalContent = proposalBlocks.join('\n').trim();

    const content = `# Active Proposals — ${today()}\n\n${proposalContent || proposeOutput.substring(0, 5000)}`;
    fs.writeFileSync(path.join(dreamDir, 'active-proposals.md'), content);
}

function appendToMetaNotes(proposeOutput: string): void {
    const dreamDir = getDreamCycleDir();
    ensureDir(dreamDir);

    const match = proposeOutput.match(/## Process Notes\n([\s\S]*?)(?:\n##|$)/);
    if (!match) return;

    const notes = match[1].trim();
    if (!notes || notes.toLowerCase() === 'none' || notes.length < 10) return;

    fs.appendFileSync(
        path.join(dreamDir, 'meta-notes.md'),
        `\n---\n### ${today()}\n${notes}\n`
    );
}

// ============================
// MAIN ORCHESTRATOR
// ============================

export async function runDreamCycle(): Promise<void> {
    const startTime = Date.now();
    const dreamConfig = loadDreamConfig();

    if (!dreamConfig.enabled) {
        console.log('[Dream] Dream cycle is disabled in config.');
        return;
    }

    console.log('[Dream] Starting dream cycle...');
    let allOutput = '';

    // Phase 1: SCAN
    allOutput += `\n## Phase 1: SCAN\n`;
    const { queries, scanResults } = await phase1Scan(dreamConfig);
    allOutput += `### 1a. Query Generation\n${queries}\n\n### 1b. Scan Results\n${scanResults}\n`;

    // Phase 2: REFLECT
    allOutput += `\n## Phase 2: REFLECT\n`;
    const reflectResults = await phase2Reflect(dreamConfig, scanResults);
    allOutput += reflectResults + '\n';

    // Phase 3: RESEARCH
    allOutput += `\n## Phase 3: RESEARCH\n`;
    const researchResults = await phase3Research(scanResults, reflectResults);
    allOutput += researchResults + '\n';

    // Phase 4: PROPOSE
    allOutput += `\n## Phase 4: PROPOSE\n`;
    const proposeResults = await phase4Propose(reflectResults, researchResults, dreamConfig);
    allOutput += proposeResults + '\n';

    const durationMs = Date.now() - startTime;

    try { saveDreamLog(allOutput, durationMs); }
    catch (e: any) { console.error('[Dream] Failed to save dream log:', e.message); }

    try { saveActiveProposals(proposeResults); }
    catch (e: any) { console.error('[Dream] Failed to save active proposals:', e.message); }

    try { appendToMetaNotes(proposeResults); }
    catch (e: any) { console.error('[Dream] Failed to append meta-notes:', e.message); }

    const proposalCount = (proposeResults.match(/## Proposal:/g) || []).length;
    saveMemoryEntry('dream-cycle', `Dream cycle completed on ${today()}. Duration: ~${Math.round(durationMs / 60000)} min. Proposals generated: ${proposalCount}.`);

    // Discord DM
    try {
        const proposalTitles = (proposeResults.match(/## Proposal: (.+)/g) || [])
            .map(m => m.replace('## Proposal: ', '').trim())
            .slice(0, 5);

        let msg = `🌙 **Dream Cycle Complete** — ${today()}\nDuration: ~${Math.round(durationMs / 60000)} minutes\n\n`;
        if (proposalTitles.length > 0) {
            msg += `**Tonight's proposals:**\n`;
            proposalTitles.forEach((t, i) => { msg += `${i + 1}. ${t}\n`; });
        } else {
            msg += '(No proposals generated tonight)';
        }
        if (msg.length > 1900) msg = msg.substring(0, 1900) + '...';

        const user = await bot.users.fetch(config.discordUserId);
        await user.send(msg);
    } catch (e: any) {
        console.error('[Dream] Failed to send Discord DM:', e.message);
    }

    console.log(`[Dream] Dream cycle complete. Duration: ~${Math.round(durationMs / 60000)} min.`);
}

// ============================
// SYSTEM PROMPT INJECTIONS
// ============================

export function getDreamProposalsBuffer(): string {
    const activeProposalsPath = path.join(getDreamCycleDir(), 'active-proposals.md');
    if (!fs.existsSync(activeProposalsPath)) return '';

    try {
        const content = fs.readFileSync(activeProposalsPath, 'utf8');

        // Extract PRIORITY proposals only (max 3)
        const priorityProposals = content.match(
            /## Proposal:[\s\S]*?\*\*Priority:\*\* PRIORITY[\s\S]*?(?=## Proposal:|$)/g
        ) || [];

        if (priorityProposals.length === 0) return '';

        const top3 = priorityProposals.slice(0, 3).join('\n').substring(0, 1500);
        return `\n\n---\n## Priority Proposals (from Dream Cycle)\nMention these proactively if the conversation is relevant:\n${top3}\n---`;
    } catch {
        return '';
    }
}

export function getDreamMetaNotes(): string {
    const metaNotesPath = path.join(getDreamCycleDir(), 'meta-notes.md');
    if (!fs.existsSync(metaNotesPath)) return '';

    try {
        const content = fs.readFileSync(metaNotesPath, 'utf8');
        const entries = content.split(/\n---\n/).filter(e => e.trim().length > 0);
        return entries.slice(-10).join('\n---\n');
    } catch {
        return '';
    }
}
