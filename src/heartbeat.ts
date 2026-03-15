import cron from 'node-cron';
import { bot } from './bot.js';
import { config } from './config.js';
import { handleHeartbeatTask } from './agent.js';
import { loadDynamicCrons } from './tools/cron.js';
import { runObservation, cleanupOldObservations } from './observe.js';

export function initHeartbeat() {
    console.log('[Heartbeat] Proactive scheduling initialized.');

    // Load dynamic cron jobs from Obsidian vault
    loadDynamicCrons();

    // Morning Check-In: 9:00 AM daily
    cron.schedule('0 9 * * *', async () => {
        try {
            console.log('[Heartbeat] Triggering daily morning check-in...');
            const user = await bot.users.fetch(config.discordUserId);
            // Routes Claude Haiku → OpenAI mini → Gemini Flash automatically
            const greeting = await handleHeartbeatTask(
                'Generate a short, friendly, proactive 1-2 sentence morning greeting to wake up the user and ask if they need any briefings or tasks handled for the day. Do not use quotes.'
            );
            await user.send(greeting);
        } catch (error) {
            console.error('[Heartbeat] Morning check-in failed:', error);
        }
    });

    // Background Observation: every 6 hours
    cron.schedule('0 */6 * * *', async () => {
        try { await runObservation(); }
        catch (error) { console.error('[Heartbeat] Observation failed:', error); }
    });

    // Daily Cleanup: 3:00 AM
    cron.schedule('0 3 * * *', () => {
        try { cleanupOldObservations(); }
        catch (error) { console.error('[Heartbeat] Cleanup failed:', error); }
    });

    // Initial observation on boot (10s delay)
    setTimeout(async () => {
        try {
            console.log('[Heartbeat] Running initial observation on boot...');
            await runObservation();
        } catch (error) {
            console.error('[Heartbeat] Initial observation failed:', error);
        }
    }, 10000);
}
