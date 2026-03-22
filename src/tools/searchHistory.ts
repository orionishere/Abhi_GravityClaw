import { searchHistory, getMessagesByTimeRange } from '../history.js';

/**
 * search_history — Search across ALL past conversations.
 *
 * Unlike search_memories (which searches explicit saves),
 * this searches everything ever said — user messages, assistant replies,
 * tool outputs, everything. Nothing is lost.
 */

export const searchHistorySchema = {
    type: 'function',
    function: {
        name: 'search_history',
        description: 'Search across all past conversation messages by keyword. This searches everything ever said — user messages, your replies, tool outputs. Use this when you need to recall a specific detail from a past conversation, like an error message, a file path, a decision, or anything discussed previously. For time-based searches, use the "since" parameter with an ISO date.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Keywords to search for in conversation history'
                },
                since: {
                    type: 'string',
                    description: 'Optional: only search messages after this ISO date (e.g., "2026-03-10")'
                },
                before: {
                    type: 'string',
                    description: 'Optional: only search messages before this ISO date'
                },
                limit: {
                    type: 'number',
                    description: 'Max results to return (default: 10, max: 30)'
                }
            },
            required: ['query'],
            additionalProperties: false,
        }
    }
};

export async function executeSearchHistory(args: {
    query: string;
    since?: string;
    before?: string;
    limit?: number;
}): Promise<string> {
    const limit = Math.min(args.limit || 10, 30);

    let results: any[];

    if (args.since) {
        // Time-bounded search
        results = getMessagesByTimeRange(args.since, args.before, limit);
        // Filter by query if provided (since getMessagesByTimeRange doesn't do FTS)
        if (args.query) {
            const queryLower = args.query.toLowerCase();
            results = results.filter(r =>
                r.content.toLowerCase().includes(queryLower)
            );
        }
    } else {
        // Full-text search
        results = searchHistory(args.query, limit);
    }

    if (results.length === 0) {
        return `No conversation history found matching "${args.query}".`;
    }

    const formatted = results.map(r => {
        const tools = r.tool_names ? ` | Tools: ${r.tool_names}` : '';
        const content = r.content.length > 400 ? r.content.substring(0, 400) + '...' : r.content;
        return `[${r.timestamp} | ${r.role}${tools}]\n${content}`;
    }).join('\n\n---\n\n');

    return `Found ${results.length} result(s) in conversation history:\n\n${formatted}`;
}
