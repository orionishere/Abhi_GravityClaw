import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
    // --- Discord ---
    discordBotToken: process.env.DISCORD_BOT_TOKEN || '',
    discordUserId: process.env.DISCORD_USER_ID || '',

    // --- API Keys ---
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',

    // --- Model Selection (override in .env to upgrade without code changes) ---
    // Claude (Primary)
    claudeAnalysisModel: process.env.CLAUDE_ANALYSIS_MODEL || 'claude-opus-4-5',
    claudeCodeModel: process.env.CLAUDE_CODE_MODEL || 'claude-sonnet-4-5',
    claudeLightModel: process.env.CLAUDE_LIGHT_MODEL || 'claude-sonnet-4-5',
    claudeHeartbeatModel: process.env.CLAUDE_HEARTBEAT_MODEL || 'claude-haiku-4-5',

    // OpenAI (Fallback 1)
    openaiAnalysisModel: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o',
    openaiCodeModel: process.env.OPENAI_CODE_MODEL || 'o4-mini',
    openaiLightModel: process.env.OPENAI_LIGHT_MODEL || 'gpt-4o-mini',
    openaiHeartbeatModel: process.env.OPENAI_HEARTBEAT_MODEL || 'gpt-4o-mini',

    // Gemini (Fallback 2)
    geminiAnalysisModel: process.env.GEMINI_ANALYSIS_MODEL || 'gemini-2.5-pro-preview-03-25',
    geminiLightModel: process.env.GEMINI_LIGHT_MODEL || 'gemini-2.5-flash',
    geminiHeartbeatModel: process.env.GEMINI_HEARTBEAT_MODEL || 'gemini-2.5-flash',

    // --- Integrations ---
    gmailUser: process.env.GMAIL_USER || '',
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
    twitterBearerToken: process.env.TWITTER_BEARER_TOKEN || '',
    twitterApiKey: process.env.TWITTER_API_KEY || '',
    twitterApiSecret: process.env.TWITTER_API_SECRET || '',
    twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN || '',
    twitterAccessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || '',

    // --- Paths ---
    sandboxPath: process.env.SANDBOX_PATH || './data/sandbox',
    obsidianPath: process.env.OBSIDIAN_PATH || '',
    dataPath: process.env.DATA_PATH || './data',

    // --- GitHub ---
    githubToken: process.env.GITHUB_TOKEN || '',
    githubUsername: process.env.GITHUB_USERNAME || '',

    // --- Cricket Data API ---
    cricketApiKey: process.env.CRICKET_API_KEY || '',

    // --- Ollama (Local LLM — free, runs on your VPS) ---
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
};

// Validate critical configuration
if (!config.discordBotToken) throw new Error('DISCORD_BOT_TOKEN is not set.');
if (!config.discordUserId) throw new Error('DISCORD_USER_ID is not set.');
if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set.');
if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set.');
if (!config.elevenlabsApiKey) throw new Error('ELEVENLABS_API_KEY is not set.');
// Note: ANTHROPIC_API_KEY is optional — missing it triggers fallback to OpenAI automatically
// Note: Gmail, Twitter secrets are optional unless those features are triggered
