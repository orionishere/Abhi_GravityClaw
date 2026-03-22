import cron from 'node-cron';
import { bot } from './bot.js';
import { config } from './config.js';
import { handleHeartbeatTask } from './agent.js';
import { loadDynamicCrons } from './tools/cron.js';
import { runObservation, cleanupOldObservations } from './observe.js';
import { saveTrackingReport, getSkillRecommendations } from './tracker.js';
import { saveCostReport, getSpendByPeriod, getOllamaSavings } from './costs.js';

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

    // Weekly Execution + Cost Report: Sunday at 10:00 AM
    cron.schedule('0 10 * * 0', async () => {
        try {
            console.log('[Heartbeat] Generating weekly reports...');
            saveTrackingReport();
            saveCostReport();

            const user = await bot.users.fetch(config.discordUserId);

            // Cost summary
            const weekSpend = getSpendByPeriod(7);
            const monthSpend = getSpendByPeriod(30);
            const savings = getOllamaSavings(7);

            let msg = `📊 **Weekly Agent Report**\n\n`;
            msg += `**Costs (last 7 days):** ~$${weekSpend.totalUsd.toFixed(2)} across ${weekSpend.callCount} API calls\n`;
            msg += `**Costs (last 30 days):** ~$${monthSpend.totalUsd.toFixed(2)}\n`;
            if (savings.localCalls > 0) {
                msg += `**Ollama savings:** ${savings.localCalls} free calls saved ~$${savings.estimatedSavedUsd.toFixed(2)}\n`;
            }

            // Skill recommendations
            const recommendations = getSkillRecommendations();
            if (recommendations.length > 0) {
                msg += `\n**Skill optimization suggestions:**\n`;
                for (const r of recommendations.slice(0, 5)) {
                    const direction = r.recommended_tier === 'local' ? '⬇️ move to local (save tokens)' : '⬆️ move to paid (better results)';
                    msg += `• **${r.skill_name}**: ${r.current_tier} → ${r.recommended_tier} — ${direction}\n`;
                }
            }

            msg += `\nFull reports saved to your Obsidian vault under \`reports/\`.`;
            await user.send(msg);
        } catch (error) {
            console.error('[Heartbeat] Weekly report failed:', error);
        }
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
