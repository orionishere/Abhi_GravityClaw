import { getCurrentTimeTool, executeGetCurrentTime } from './getCurrentTime.js';
import { saveMemoryTool, executeSaveMemory } from './saveMemory.js';
import { searchMemoriesTool, executeSearchMemories } from './searchMemories.js';
import { execSchema, exec as execTool } from './exec.js';
import {
    browserNavigateSchema, browserGetTextSchema, browserScreenshotSchema,
    browserClickSchema, browserTypeSchema,
    browserNavigate, browserGetText, browserScreenshot, browserClick, browserType
} from './browser.js';
import {
    gmailSearchSchema, gmailReadSchema,
    gmailSearch, gmailRead
} from './gmail.js';
import { delegateSchema, delegate } from './delegate.js';

// Export the tool schemas for the LLM
export const tools = [
    getCurrentTimeTool,
    saveMemoryTool,
    searchMemoriesTool,
    browserNavigateSchema,
    browserGetTextSchema,
    browserScreenshotSchema,
    browserClickSchema,
    browserTypeSchema,
    execSchema,
    gmailSearchSchema,
    gmailReadSchema,
    delegateSchema
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
        case 'browser_navigate':
            return await browserNavigate(args);
        case 'browser_get_text':
            return await browserGetText();
        case 'browser_screenshot':
            return await browserScreenshot(args);
        case 'browser_click':
            return await browserClick(args);
        case 'browser_type':
            return await browserType(args);
        case 'exec':
            return await execTool(args);
        case 'gmail_search':
            return await gmailSearch(args);
        case 'gmail_read':
            return await gmailRead(args);
        case 'delegate':
            return await delegate(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
