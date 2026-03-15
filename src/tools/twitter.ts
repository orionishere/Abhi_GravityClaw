import { TwitterApi } from 'twitter-api-v2';
import { config } from '../config.js';

// Lazily initialize client with OAuth 1.0a (user context — gives access to own account data)
function getClient(): TwitterApi {
    return new TwitterApi({
        appKey: config.twitterApiKey,
        appSecret: config.twitterApiSecret,
        accessToken: config.twitterAccessToken,
        accessSecret: config.twitterAccessTokenSecret,
    });
}

// Read-only client wrapped for convenience
function getReadClient() {
    return getClient().readOnly;
}

// ============================
// TOOL SCHEMAS
// ============================

export const twitterGetMyStatsSchema = {
    type: 'function',
    function: {
        name: 'twitter_get_my_stats',
        description: 'Get your own Twitter/X account stats: follower count, following count, tweet count, and engagement metrics (likes, retweets, replies, impressions) on your most recent tweets.',
        parameters: {
            type: 'object',
            properties: {
                tweetCount: {
                    type: 'number',
                    description: 'How many recent tweets to fetch metrics for (default: 10, max: 20)'
                }
            },
            additionalProperties: false
        }
    }
};

export const twitterGetMentionsSchema = {
    type: 'function',
    function: {
        name: 'twitter_get_mentions',
        description: 'Get recent @mentions and replies to your Twitter/X account. Useful for monitoring engagement and conversations.',
        parameters: {
            type: 'object',
            properties: {
                count: {
                    type: 'number',
                    description: 'Number of mentions to fetch (default: 20, max: 50)'
                }
            },
            additionalProperties: false
        }
    }
};

export const twitterGetTrendingSchema = {
    type: 'function',
    function: {
        name: 'twitter_get_trending',
        description: 'Get trending topics on Twitter/X. Can fetch worldwide trends or for a specific location.',
        parameters: {
            type: 'object',
            properties: {
                woeid: {
                    type: 'number',
                    description: 'Yahoo Where On Earth ID. Use 1 for worldwide (default), 23424977 for USA, 44418 for London, 2459115 for New York.'
                }
            },
            additionalProperties: false
        }
    }
};

export const twitterSearchDeepSchema = {
    type: 'function',
    function: {
        name: 'twitter_search_deep',
        description: 'Search Twitter/X with full engagement metrics (likes, retweets, replies, impressions). Better than the basic MCP search for analytics purposes.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query (supports Twitter search operators like -is:retweet, lang:en, etc.)'
                },
                count: {
                    type: 'number',
                    description: 'Number of tweets to return (default: 10, max: 30)'
                },
                sortBy: {
                    type: 'string',
                    enum: ['recency', 'relevancy'],
                    description: 'Sort results by recency or relevancy (default: recency)'
                }
            },
            required: ['query'],
            additionalProperties: false
        }
    }
};

export const twitterDraftThreadSchema = {
    type: 'function',
    function: {
        name: 'twitter_draft_thread',
        description: 'Research a topic on Twitter and draft a ready-to-post tweet thread based on trending content and engagement patterns. Returns a numbered list of tweets formatted as a thread.',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'The topic or theme for the thread (e.g., "AI productivity tips", "Python best practices")'
                },
                tweetCount: {
                    type: 'number',
                    description: 'Number of tweets in the thread (default: 5, max: 10)'
                },
                tone: {
                    type: 'string',
                    enum: ['professional', 'casual', 'educational', 'opinionated'],
                    description: 'Tone of the thread (default: professional)'
                },
                researchFirst: {
                    type: 'boolean',
                    description: 'Whether to search Twitter for inspiration before drafting (default: true)'
                }
            },
            required: ['topic'],
            additionalProperties: false
        }
    }
};

// ============================
// TOOL EXECUTORS
// ============================

export async function twitterGetMyStats(args: any): Promise<string> {
    const tweetCount = Math.min(args.tweetCount || 10, 20);

    try {
        const client = getReadClient();

        // Get own user info
        const me = await client.v2.me({
            'user.fields': ['public_metrics', 'description', 'created_at']
        });

        const user = me.data;
        const metrics = user.public_metrics;

        let output = `## 📊 Your Twitter/X Stats\n\n`;
        output += `**@${user.username}** — ${user.name}\n`;
        output += `> ${user.description || 'No bio'}\n\n`;
        output += `| Metric | Count |\n|--------|-------|\n`;
        output += `| Followers | ${(metrics?.followers_count ?? 0).toLocaleString()} |\n`;
        output += `| Following | ${(metrics?.following_count ?? 0).toLocaleString()} |\n`;
        output += `| Tweets | ${(metrics?.tweet_count ?? 0).toLocaleString()} |\n`;
        output += `| Listed | ${(metrics?.listed_count ?? 0).toLocaleString()} |\n\n`;

        // Get recent tweets with metrics
        const tweets = await client.v2.userTimeline(user.id, {
            max_results: tweetCount,
            'tweet.fields': ['public_metrics', 'created_at', 'text'],
            exclude: ['retweets', 'replies']
        });

        if (tweets.data.data && tweets.data.data.length > 0) {
            output += `## 🐦 Recent Tweets Performance\n\n`;
            let totalImpressions = 0;
            let totalLikes = 0;
            let totalRetweets = 0;

            for (const tweet of tweets.data.data) {
                const m = tweet.public_metrics!;
                const date = new Date(tweet.created_at!).toLocaleDateString();
                const preview = tweet.text.substring(0, 80) + (tweet.text.length > 80 ? '...' : '');
                output += `**${date}** — "${preview}"\n`;
                output += `  ❤️ ${m.like_count} | 🔁 ${m.retweet_count} | 💬 ${m.reply_count} | 🔖 ${m.bookmark_count}\n\n`;
                totalLikes += m.like_count;
                totalRetweets += m.retweet_count;
            }

            output += `---\n**Avg per tweet (last ${tweets.data.data.length}):** `;
            output += `❤️ ${(totalLikes / tweets.data.data.length).toFixed(1)} likes, `;
            output += `🔁 ${(totalRetweets / tweets.data.data.length).toFixed(1)} retweets`;
        }

        return output;
    } catch (e: any) {
        return `Twitter stats error: ${e.message}`;
    }
}

export async function twitterGetMentions(args: any): Promise<string> {
    const count = Math.min(args.count || 20, 50);

    try {
        const client = getReadClient();

        const me = await client.v2.me();
        const mentions = await client.v2.userMentionTimeline(me.data.id, {
            max_results: count,
            'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'text', 'conversation_id'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id']
        });

        if (!mentions.data.data || mentions.data.data.length === 0) {
            return 'No recent mentions found.';
        }

        const users = new Map<string, string>();
        if (mentions.data.includes?.users) {
            for (const u of mentions.data.includes.users) {
                users.set(u.id, `@${u.username}`);
            }
        }

        let output = `## 📬 Recent Mentions (${mentions.data.data.length})\n\n`;

        for (const tweet of mentions.data.data) {
            const author = users.get(tweet.author_id!) || 'Unknown';
            const date = new Date(tweet.created_at!).toLocaleString();
            const m = tweet.public_metrics!;
            output += `**${author}** — ${date}\n`;
            output += `> ${tweet.text}\n`;
            output += `❤️ ${m.like_count} | 🔁 ${m.retweet_count} | 💬 ${m.reply_count}\n\n`;
        }

        return output;
    } catch (e: any) {
        return `Twitter mentions error: ${e.message}`;
    }
}

export async function twitterGetTrending(args: any): Promise<string> {
    const woeid = args.woeid || 1;

    const locationNames: Record<number, string> = {
        1: '🌍 Worldwide',
        23424977: '🇺🇸 United States',
        44418: '🇬🇧 London',
        2459115: '🗽 New York',
        615702: '🇨🇦 Canada',
        23424848: '🇮🇳 India',
        23424856: '🇯🇵 Japan',
    };

    try {
        // Trends are v1.1 only — use the raw plugin
        const client = new TwitterApi({
            appKey: config.twitterApiKey,
            appSecret: config.twitterApiSecret,
            accessToken: config.twitterAccessToken,
            accessSecret: config.twitterAccessTokenSecret,
        });

        const trends = await client.v1.trendsByPlace(woeid);
        const location = locationNames[woeid] || `WOEID ${woeid}`;

        let output = `## 🔥 Trending on Twitter — ${location}\n\n`;
        const trendList = trends[0]?.trends || [];

        if (trendList.length === 0) {
            return `No trending data available for ${location}.`;
        }

        trendList.slice(0, 20).forEach((trend: any, i: number) => {
            const volume = trend.tweet_volume
                ? ` — ${trend.tweet_volume.toLocaleString()} tweets`
                : '';
            output += `${i + 1}. **${trend.name}**${volume}\n`;
        });

        return output;
    } catch (e: any) {
        return `Twitter trending error: ${e.message}`;
    }
}

export async function twitterSearchDeep(args: any): Promise<string> {
    const { query, count = 10, sortBy = 'recency' } = args;
    const maxResults = Math.min(count, 30);

    try {
        const client = getReadClient();

        const results = await client.v2.search(query, {
            max_results: maxResults,
            sort_order: sortBy === 'relevancy' ? 'relevancy' : 'recency',
            'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'text', 'lang'],
            'user.fields': ['username', 'name', 'public_metrics'],
            expansions: ['author_id'],
        });

        if (!results.data.data || results.data.data.length === 0) {
            return `No tweets found for query: "${query}"`;
        }

        const users = new Map<string, string>();
        if (results.data.includes?.users) {
            for (const u of results.data.includes.users) {
                users.set(u.id, `@${u.username}`);
            }
        }

        let output = `## 🔍 Twitter Search: "${query}" (${results.data.data.length} results)\n\n`;
        let totalLikes = 0;
        let totalRetweets = 0;

        for (const tweet of results.data.data) {
            const author = users.get(tweet.author_id!) || 'Unknown';
            const date = new Date(tweet.created_at!).toLocaleDateString();
            const m = tweet.public_metrics!;
            output += `**${author}** — ${date}\n`;
            output += `> ${tweet.text.substring(0, 200)}${tweet.text.length > 200 ? '...' : ''}\n`;
            output += `❤️ ${m.like_count} | 🔁 ${m.retweet_count} | 💬 ${m.reply_count}\n\n`;
            totalLikes += m.like_count;
            totalRetweets += m.retweet_count;
        }

        output += `---\n📈 **Avg engagement:** `;
        output += `❤️ ${(totalLikes / results.data.data.length).toFixed(1)} likes, `;
        output += `🔁 ${(totalRetweets / results.data.data.length).toFixed(1)} retweets`;

        return output;
    } catch (e: any) {
        return `Twitter search error: ${e.message}`;
    }
}

export async function twitterDraftThread(args: any): Promise<string> {
    const { topic, tweetCount = 5, tone = 'professional', researchFirst = true } = args;
    const maxTweets = Math.min(tweetCount, 10);

    let researchContext = '';

    if (researchFirst) {
        try {
            const results = await twitterSearchDeep({
                query: `${topic} -is:retweet lang:en`,
                count: 10,
                sortBy: 'relevancy'
            });
            researchContext = `\n\n## Research from Twitter:\n${results}`;
        } catch {
            researchContext = '\n\n(Twitter research unavailable — drafting from knowledge only)';
        }
    }

    const toneGuide: Record<string, string> = {
        professional: 'authoritative, informative, no slang, suitable for a thought leader',
        casual: 'friendly, conversational, relatable, light use of emojis',
        educational: 'clear, step-by-step, teaching-focused, good for beginners',
        opinionated: 'bold, takes a clear stance, invites debate, confident',
    };

    return `## 📝 Thread Draft Request: "${topic}"

**Tone:** ${tone} — ${toneGuide[tone]}
**Target length:** ${maxTweets} tweets
${researchContext}

---
*The agent will now use the above research and your system prompt to draft a ${maxTweets}-tweet ${tone} thread about "${topic}". Each tweet will be under 280 characters and end with a hook to the next.*

**Draft Thread:**
`;
}
