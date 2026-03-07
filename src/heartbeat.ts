import cron from 'node-cron';
import { bot } from './bot.js';
import { config } from './config.js';
import { GoogleGenAI } from '@google/genai';
import { loadDynamicCrons } from './tools/cron.js';
import { runObservation, cleanupOldObservations } from './observe.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Initializes all proactive scheduled tasks for the agent.
 */
export function initHeartbeat() {
    console.log('[Heartbeat] Proactive scheduling initialized.');

    // Load dynamic cron jobs from Obsidian vault
    loadDynamicCrons();

    // Morning Check-In: Runs every day at 9:00 AM
    cron.schedule('0 9 * * *', async () => {
        try {
            console.log('[Heartbeat] Triggering Daily Morning Check-in...');
            const user = await bot.users.fetch(config.discordUserId);

            // Use Gemini Flash for heartbeats (free, lightweight)
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: 'You are Gravity Claw, a personal AI agent. Generate a short, friendly, proactive 1-2 sentence morning greeting to wake up the user and ask them if they need any briefings or tasks handled for the day. Do not use quotes.'
            });

            const greeting = result.text || "Good morning! Would you like a briefing for the day?";
            await user.send(greeting);

        } catch (error) {
            console.error('[Heartbeat] Failed to execute morning check-in:', error);
        }
    });

    // Background Observation: Every 6 hours (midnight, 6am, noon, 6pm)
    cron.schedule('0 */6 * * *', async () => {
        try {
            await runObservation();
        } catch (error) {
            console.error('[Heartbeat] Observation failed:', error);
        }
    });

    // Daily Cleanup: Expire old observations at 3:00 AM
    cron.schedule('0 3 * * *', () => {
        try {
            cleanupOldObservations();
        } catch (error) {
            console.error('[Heartbeat] Observation cleanup failed:', error);
        }
    });

    // Run an initial observation on boot (so there's data immediately)
    setTimeout(async () => {
        try {
            console.log('[Heartbeat] Running initial observation on boot...');
            await runObservation();
        } catch (error) {
            console.error('[Heartbeat] Initial observation failed:', error);
        }
    }, 10000); // 10 seconds after boot
}
