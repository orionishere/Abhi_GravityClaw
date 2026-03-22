import { getCurrentTimeTool, executeGetCurrentTime } from './getCurrentTime.js';
import { saveMemoryTool, executeSaveMemory } from './saveMemory.js';
import { searchMemoriesTool, executeSearchMemories } from './searchMemories.js';
import { searchHistorySchema, executeSearchHistory } from './searchHistory.js';
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
import { githubCreateAndPushSchema, githubCreateAndPush } from './github.js';
import {
    scheduleCronSchema, cancelCronSchema, listCronsSchema,
    scheduleCron, cancelCron, listCrons
} from './cron.js';
import { learnSkillSchema, learnSkill } from './learnSkill.js';
import {
    twitterGetMyStatsSchema, twitterGetMentionsSchema, twitterGetTrendingSchema,
    twitterSearchDeepSchema, twitterDraftThreadSchema,
    twitterGetMyStats, twitterGetMentions, twitterGetTrending,
    twitterSearchDeep, twitterDraftThread
} from './twitter.js';

// Export the tool schemas for the LLM
export const tools = [
    getCurrentTimeTool,
    saveMemoryTool,
    searchMemoriesTool,
    searchHistorySchema,
    browserNavigateSchema,
    browserGetTextSchema,
    browserScreenshotSchema,
    browserClickSchema,
    browserTypeSchema,
    execSchema,
    gmailSearchSchema,
    gmailReadSchema,
    delegateSchema,
    githubCreateAndPushSchema,
    scheduleCronSchema,
    cancelCronSchema,
    listCronsSchema,
    learnSkillSchema,
    twitterGetMyStatsSchema,
    twitterGetMentionsSchema,
    twitterGetTrendingSchema,
    twitterSearchDeepSchema,
    twitterDraftThreadSchema
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
        case 'search_history':
            return await executeSearchHistory(args);
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
        case 'github_create_and_push':
            return await githubCreateAndPush(args);
        case 'schedule_cron':
            return await scheduleCron(args);
        case 'cancel_cron':
            return await cancelCron(args);
        case 'list_crons':
            return await listCrons();
        case 'learn_skill':
            return await learnSkill(args);
        case 'twitter_get_my_stats':
            return await twitterGetMyStats(args);
        case 'twitter_get_mentions':
            return await twitterGetMentions(args);
        case 'twitter_get_trending':
            return await twitterGetTrending(args);
        case 'twitter_search_deep':
            return await twitterSearchDeep(args);
        case 'twitter_draft_thread':
            return await twitterDraftThread(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
