import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
    discordBotToken: process.env.DISCORD_BOT_TOKEN || '',
    discordUserId: process.env.DISCORD_USER_ID || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
};

// Validate critical configuration
if (!config.discordBotToken) {
    throw new Error('DISCORD_BOT_TOKEN is not set in environment variables.');
}

if (!config.discordUserId) {
    throw new Error('DISCORD_USER_ID is not set in environment variables.');
}

if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables.');
}

if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables.');
}

if (!config.elevenlabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set in environment variables.');
}
