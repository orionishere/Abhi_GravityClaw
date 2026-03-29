export interface BrowserSource {
    name: string;
    url: string;
    type: 'browser';
}

export interface TwitterSource {
    name: string;
    type: 'twitter';
    query: string;
}

export type DreamSource = BrowserSource | TwitterSource;

export interface DreamConfig {
    enabled: boolean;
    topics: string[];
    sources: DreamSource[];
    goalsFile: string;
    maxScanSources: number;
    maxProposals: number;
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
    enabled: true,
    topics: [
        'AI agent architecture & design patterns',
        'OpenClaw updates, plugins, community techniques',
        'MCP protocol & new MCP servers',
        'Robotics & hardware',
        'Building in public & developer content creation',
        'Cricket content creation, sports influencer monetization, YouTube and X growth',
        'Roblox and solo game development',
        'Indie game monetization and passive income'
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
        { name: 'Cricket Twitter/X', type: 'twitter', query: 'cricket trending OR cricket viral OR cricket strategy OR cricket content creator' }
    ],
    goalsFile: 'goals.md',
    maxScanSources: 6,
    maxProposals: 5
};
