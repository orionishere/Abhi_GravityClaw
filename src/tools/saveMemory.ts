import { db } from '../db.js';

/**
 * Tool to save a new memory into the SQLite database.
 */

export const saveMemoryTool = {
    type: 'function',
    function: {
        name: 'save_memory',
        description: 'Save an important explicit memory about the user. Use this to remember names, preferences, rules, or facts for long-term storage.',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'A 1-3 word topic or category for this memory (e.g. "User Preference", "Project Idea")'
                },
                content: {
                    type: 'string',
                    description: 'The actual detailed memory to store.'
                }
            },
            required: ['topic', 'content']
        },
    }
};

export async function executeSaveMemory(args: { topic: string; content: string }): Promise<string> {
    const stmt = db.prepare('INSERT INTO memories (topic, content) VALUES (?, ?)');
    const info = stmt.run(args.topic, args.content);
    return `Successfully saved memory (ID: ${info.lastInsertRowid})`;
}
