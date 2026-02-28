import { getCurrentTimeTool, executeGetCurrentTime } from './getCurrentTime.js';
import { saveMemoryTool, executeSaveMemory } from './saveMemory.js';
import { searchMemoriesTool, executeSearchMemories } from './searchMemories.js';

// Export the tool schemas for the LLM
export const tools = [
    getCurrentTimeTool,
    saveMemoryTool,
    searchMemoriesTool
];

// Export an execution router
export async function executeTool(name: string, args: any): Promise<any> {
    switch (name) {
        case 'get_current_time':
            return await executeGetCurrentTime();
        case 'save_memory':
            return await executeSaveMemory(args);
        case 'search_memories':
            return await executeSearchMemories(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
