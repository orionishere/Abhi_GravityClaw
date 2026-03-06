import cron from 'node-cron';
import { bot } from './bot.js';
import { config } from './config.js';
import { GoogleGenAI } from '@google/genai';
import { loadDynamicCrons } from './tools/cron.js';

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

    // NOTE: Add additional heartbeat triggers here (e.g. weekly summaries, bedtime reminders, etc.)
}
