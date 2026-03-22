/**
 * history.ts
 *
 * Lossless conversation history — inspired by lossless-claw, simplified for Gravity Claw.
 *
 * Core principles:
 *   1. Every message is saved to SQLite. Nothing is ever deleted.
 *   2. Compaction creates summaries but raw messages remain searchable.
 *   3. Summaries are richer (200-400 tokens, include timestamps + tools used + decisions).
 *   4. The agent can search past conversations via the search_history tool.
 *   5. Pre-compaction flush saves important context to memory before summarizing.
 */

import { db } from './db.js';

// ============================
// DATABASE SETUP
// ============================
export function initHistory(): void {
    // Raw message store — every message, permanently
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT 'default',
            seq INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_names TEXT,
            token_estimate INTEGER NOT NULL DEFAULT 0
        )
    `);

    // Create index for fast session lookups
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_session
        ON conversation_messages(session_id, seq)
    `);

    // Compaction summaries — linked back to source messages
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT 'default',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            summary TEXT NOT NULL,
            source_msg_start INTEGER NOT NULL,
            source_msg_end INTEGER NOT NULL,
            token_estimate INTEGER NOT NULL DEFAULT 0
        )
    `);

    // FTS5 index over raw messages — enables search_history tool
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            role,
            content,
            content='conversation_messages',
            content_rowid='id'
        )
    `);

    // Keep FTS in sync
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON conversation_messages BEGIN
            INSERT INTO messages_fts(rowid, role, content) VALUES (new.id, new.role, new.content);
        END;
    `);

    db.exec(`
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON conversation_messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, role, content) VALUES('delete', old.id, old.role, old.content);
        END;
    `);

    console.log('[History] Lossless conversation store initialized.');
}

// ============================
// MESSAGE PERSISTENCE
// ============================
let _seqCounter: number = 0;
let _currentSessionId: string = 'default';

export function setSessionId(sessionId: string): void {
    _currentSessionId = sessionId;
    // Load the last seq for this session
    const row = db.prepare(
        'SELECT MAX(seq) as maxSeq FROM conversation_messages WHERE session_id = ?'
    ).get(_currentSessionId) as any;
    _seqCounter = (row?.maxSeq || 0);
}

export function newSession(): string {
    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setSessionId(id);
    return id;
}

/**
 * Persist a message to the database. Call this for every message
 * that enters the conversation — user, assistant, and tool results.
 */
export function persistMessage(role: string, content: string, toolNames?: string[]): number {
    _seqCounter++;
    const tokenEstimate = Math.ceil(content.length / 4);

    const result = db.prepare(`
        INSERT INTO conversation_messages (session_id, seq, role, content, tool_names, token_estimate)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        _currentSessionId,
        _seqCounter,
        role,
        content,
        toolNames ? JSON.stringify(toolNames) : null,
        tokenEstimate,
    );

    return result.lastInsertRowid as number;
}

// ============================
// RICH COMPACTION PROMPT
// ============================

/**
 * Build a detailed compaction prompt that preserves key information.
 * Unlike the old "summarize in 2-3 sentences", this asks for structured output.
 */
export function buildCompactionPrompt(messages: Array<{ role: string; content: string }>, previousSummary?: string): string {
    let transcript = messages.map(m => {
        const content = typeof m.content === 'string' ? m.content :
            Array.isArray(m.content) ? (m.content as any[]).map((p: any) => p.text || '').join(' ') : '';
        return `[${m.role}]: ${content.substring(0, 800)}`;
    }).join('\n');

    // Cap at reasonable size for the summarizer
    if (transcript.length > 12000) {
        transcript = transcript.substring(0, 12000) + '\n...[transcript truncated]';
    }

    let prompt = `You are a conversation historian. Summarize the following conversation segment into a structured summary.

RULES:
- Include timestamps or time references if present
- List every tool that was called by name
- Note key decisions, facts learned, and outcomes
- Preserve specific details: file paths, URLs, error messages, names, numbers
- Write in past tense, as a factual record
- Keep the summary between 200-400 tokens
- Use this format:

## What happened
[1-2 paragraph narrative of the conversation]

## Tools used
[Comma-separated list of tool names called, or "None"]

## Key facts & decisions
[Bullet points of important facts, decisions, or outcomes]

## Unresolved
[Anything left incomplete or promised for later, or "Nothing"]
`;

    if (previousSummary) {
        prompt += `\n## Previous context (do not repeat, just continue from here)\n${previousSummary.substring(0, 500)}\n`;
    }

    prompt += `\n## Conversation transcript\n${transcript}`;

    return prompt;
}

// ============================
// PRE-COMPACTION FLUSH
// ============================

/**
 * Extract important facts from messages about to be compacted
 * and save them as memories. This prevents information loss.
 */
export function flushToMemory(messages: Array<{ role: string; content: string }>): void {
    // Extract tool calls mentioned
    const toolMentions: string[] = [];
    const keyPatterns = [
        /saved? (?:memory|note|to memory)/i,
        /remember(?:ed|ing)?\s+(?:that|this)/i,
        /important(?:ly)?:/i,
        /decision:/i,
        /(?:will|going to|plan to)\s+\w+/i,
    ];

    for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : '';

        // Check for statements the user explicitly asked to remember
        for (const pattern of keyPatterns) {
            if (pattern.test(content) && msg.role === 'user') {
                // Save this as a memory before it gets compacted
                try {
                    db.prepare(`
                        INSERT INTO memories (topic, content)
                        VALUES (?, ?)
                    `).run(
                        'auto-saved (pre-compaction)',
                        content.substring(0, 500),
                    );
                } catch (e: any) {
                    console.error('[History] Pre-compaction memory save failed:', (e as Error).message);
                }
                break; // One save per message is enough
            }
        }
    }
}

// ============================
// SAVE COMPACTION SUMMARY
// ============================
export function saveSummary(sessionId: string, summary: string, startSeq: number, endSeq: number): void {
    db.prepare(`
        INSERT INTO conversation_summaries (session_id, summary, source_msg_start, source_msg_end, token_estimate)
        VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, summary, startSeq, endSeq, Math.ceil(summary.length / 4));
}

/**
 * Get the most recent summary for continuity in the next compaction.
 */
export function getLatestSummary(sessionId: string): string | null {
    const row = db.prepare(`
        SELECT summary FROM conversation_summaries
        WHERE session_id = ?
        ORDER BY id DESC LIMIT 1
    `).get(sessionId) as any;
    return row?.summary || null;
}

// ============================
// SEARCH HISTORY — tool for the agent
// ============================

/**
 * Search across all past conversation messages using FTS5.
 * This is the agent's "long-term recall" — it can find anything ever said.
 */
export function searchHistory(query: string, limit = 10): any[] {
    // Sanitize for FTS5
    const safeQuery = `"${query.replace(/"/g, '""')}"`;

    try {
        return db.prepare(`
            SELECT
                m.id,
                m.session_id,
                m.timestamp,
                m.role,
                m.content,
                m.tool_names
            FROM messages_fts f
            JOIN conversation_messages m ON f.rowid = m.id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(safeQuery, limit) as any[];
    } catch (e: any) {
        // If FTS fails (bad query syntax), fall back to LIKE
        console.warn(`[History] FTS search failed, falling back to LIKE: ${(e as Error).message}`);
        return db.prepare(`
            SELECT id, session_id, timestamp, role, content, tool_names
            FROM conversation_messages
            WHERE content LIKE ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(`%${query}%`, limit) as any[];
    }
}

/**
 * Get messages from a specific time range.
 */
export function getMessagesByTimeRange(since: string, before?: string, limit = 20): any[] {
    if (before) {
        return db.prepare(`
            SELECT id, session_id, timestamp, role, content, tool_names
            FROM conversation_messages
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(since, before, limit) as any[];
    }
    return db.prepare(`
        SELECT id, session_id, timestamp, role, content, tool_names
        FROM conversation_messages
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(since, limit) as any[];
}

/**
 * Get recent messages (for context reconstruction after restart).
 */
export function getRecentMessages(sessionId: string, limit = 20): any[] {
    return db.prepare(`
        SELECT id, seq, timestamp, role, content, tool_names
        FROM conversation_messages
        WHERE session_id = ?
        ORDER BY seq DESC
        LIMIT ?
    `).all(sessionId, limit) as any[];
}

/**
 * Count total messages stored.
 */
export function getMessageCount(): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM conversation_messages').get() as any;
    return row?.count || 0;
}
