import { startBot, stopBot } from './bot.js';
import { initDb } from './db.js';
import { initMCPs } from './mcp.js';
import { initHeartbeat } from './heartbeat.js';
import { initModelSelector } from './modelSelector.js';

async function main() {
    console.log('Booting Gravity Claw...');
    console.log('--------------------------------------------------');
    console.log('Mode: Local');
    console.log('Memory: SQLite + FTS5 Active');
    console.log('Security: Discord ID Whitelist Enforced');
    console.log('Integrations: Tools via Agentic Loop');
    console.log('--------------------------------------------------');

    // Initialize internal dependencies
    initDb();

    // Auto-select best available models from each provider (cached 15 days)
    await initModelSelector();

    // Initialize external plugins/MCP systems BEFORE starting the bot
    await initMCPs();

    // Start bot
    await startBot();

    // Start Proactive Schedulers only once the bot is connected and ready
    initHeartbeat();

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
        console.log(`\n[Core] Received ${signal}. Shutting down safely...`);
        await stopBot();
        process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[Core] Fatal startup error:', err);
    process.exit(1);
});
