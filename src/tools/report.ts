import { generateCostReport } from '../costs.js';
import { config } from '../config.js';
import { TwitterApi } from 'twitter-api-v2';

export const getUsageReportSchema = {
    type: 'function',
    function: {
        name: 'get_usage_report',
        description: 'Generate a full usage and cost report covering LLM API spend (Anthropic, OpenAI, Gemini, Ollama) and Twitter/X API usage. Use this when the user asks about costs, token usage, API usage, or spending.',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }
};

async function getTwitterUsage(): Promise<string> {
    try {
        const client = new TwitterApi(config.twitterBearerToken);

        const response = await client.v2.get('usage/tweets', {
            'usage.fields': ['daily_project_usage', 'daily_client_app_usage']
        }) as any;

        if (!response?.data) {
            return `\n## Twitter/X API Usage\n\nNo usage data returned (may require Pro tier access).\n`;
        }

        const data = response.data;
        let section = `\n## Twitter/X API Usage\n\n`;

        if (data.cap_reset_day) {
            section += `**Cap resets on day ${data.cap_reset_day} of each month.**\n\n`;
        }

        if (Array.isArray(data.daily_project_usage) && data.daily_project_usage.length > 0) {
            section += `| Date | Tweets Read |\n|------|-------------|\n`;
            for (const day of data.daily_project_usage.slice(0, 14)) {
                const count = day.usage?.reduce((sum: number, u: any) => sum + (u.tweet_count || 0), 0) ?? 0;
                section += `| ${day.date} | ${count.toLocaleString()} |\n`;
            }
        } else {
            section += `No daily usage data available.\n`;
        }

        return section;
    } catch (e: any) {
        return `\n## Twitter/X API Usage\n\nCould not fetch usage: ${e.message}\n`;
    }
}

export async function getUsageReport(): Promise<string> {
    const llmReport = generateCostReport();
    const twitterSection = await getTwitterUsage();
    return llmReport + twitterSection;
}
