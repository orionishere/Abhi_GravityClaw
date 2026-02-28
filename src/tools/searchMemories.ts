import { db } from '../db.js';

/**
 * Tool to search existing memories using SQLite FTS5.
 */

export const searchMemoriesTool = {
    type: 'function',
    function: {
        name: 'search_memories',
        description: 'Search your long-term memory bank using keywords. Use this when the user asks you to recall something you previously saved.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search term or keywords to look for in the memory bank.'
                }
            },
            required: ['query']
        },
    }
};

export async function executeSearchMemories(args: { query: string }): Promise<string> {
    // Prepare an FTS5 match query
    const stmt = db.prepare(`
        SELECT m.id, m.timestamp, m.topic, m.content
        FROM memories_fts f
        JOIN memories m ON f.rowid = m.id
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT 5
    `);

    // Standard SQLite FTS5 syntax parsing (wrap in quotes if not already safely formatted)
    // Basic sanitization for the MATCH query
    const safeQuery = `"${args.query.replace(/"/g, '""')}"*`;

    try {
        const results = stmt.all(safeQuery) as any[];

        if (results.length === 0) {
            return `No memories found matching "${args.query}".`;
        }

        const formattedResults = results.map(r =>
            `[ID: ${r.id} | Timestamp: ${r.timestamp} | Topic: ${r.topic}]\n${r.content}`
        ).join('\n\n');

        return `Found ${results.length} relevant memories:\n\n${formattedResults}`;
    } catch (e: any) {
        return `Search error. Did you use complex characters? Error: ${e.message}`;
    }
}
