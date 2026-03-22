import { Client, Events, GatewayIntentBits, Partials, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { handleUserMessage, resetConversation } from './agent.js';
import { transcribeAudio, synthesizeSpeech } from './voice.js';
import { getTodaySpend, getSpendByProvider, getOllamaSavings } from './costs.js';
import { getAllSkillStats, getSkillRecommendations } from './tracker.js';
import { getMessageCount } from './history.js';
import fs from 'fs';
import path from 'path';

export const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel]
});

// ============================
// DISCORD MESSAGE UTILITIES
// ============================

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 * Splits at newlines when possible, never mid-word.
 */
function splitMessage(text: string, maxLength = 1900): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline within the limit
        let splitAt = remaining.lastIndexOf('\n', maxLength);

        // If no newline found, try splitting at a space
        if (splitAt <= 0) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }

        // If still no good split point, hard cut at maxLength
        if (splitAt <= 0) {
            splitAt = maxLength;
        }

        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
}

/**
 * Keep the typing indicator active during long operations.
 * Discord's typing indicator expires after ~10 seconds,
 * so we refresh it every 8 seconds until cancelled.
 */
function startPersistentTyping(channel: any): () => void {
    let active = true;

    const tick = async () => {
        if (!active) return;
        try {
            await channel.sendTyping();
        } catch { }
        if (active) setTimeout(tick, 8000);
    };

    tick(); // fire immediately

    return () => { active = false; }; // return cancel function
}

// ============================
// SLASH COMMAND HANDLERS
// ============================

async function handleSlashCommand(message: any, command: string): Promise<boolean> {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/reset') {
        resetConversation();
        await message.reply('🔄 Conversation history cleared. Starting fresh!');
        return true;
    }

    if (cmd === '/status') {
        const todaySpend = getTodaySpend();
        const savings = getOllamaSavings(7);
        const msgCount = getMessageCount();

        const embed = new EmbedBuilder()
            .setTitle('🦀 Gravity Claw — Status')
            .setColor(0x2ecc71)
            .addFields(
                { name: 'Today\'s Spend', value: `$${todaySpend.totalUsd.toFixed(4)}`, inline: true },
                { name: 'API Calls Today', value: `${todaySpend.callCount}`, inline: true },
                { name: 'Messages Stored', value: `${msgCount.toLocaleString()}`, inline: true },
            );

        if (savings.localCalls > 0) {
            embed.addFields(
                { name: 'Ollama Savings (7d)', value: `${savings.localCalls} free calls, ~$${savings.estimatedSavedUsd.toFixed(2)} saved`, inline: false }
            );
        }

        embed.setTimestamp();
        await message.reply({ embeds: [embed] });
        return true;
    }

    if (cmd === '/costs') {
        const providerStats = getSpendByProvider(7);
        const todaySpend = getTodaySpend();

        const embed = new EmbedBuilder()
            .setTitle('💰 Cost Breakdown (Last 7 Days)')
            .setColor(0xf39c12);

        if (providerStats.length === 0) {
            embed.setDescription('No API calls recorded yet.');
        } else {
            for (const p of providerStats) {
                embed.addFields({
                    name: `${p.provider}`,
                    value: `${p.calls} calls | $${p.total_usd}\nIn: ${(p.total_input_tokens / 1000).toFixed(1)}K tokens | Out: ${(p.total_output_tokens / 1000).toFixed(1)}K tokens`,
                    inline: true,
                });
            }
        }

        embed.setFooter({ text: `Today: $${todaySpend.totalUsd.toFixed(4)} across ${todaySpend.callCount} calls` });
        embed.setTimestamp();
        await message.reply({ embeds: [embed] });
        return true;
    }

    if (cmd === '/skills') {
        const skills = getAllSkillStats();
        const recommendations = getSkillRecommendations();

        const embed = new EmbedBuilder()
            .setTitle('🧠 Skill Tracker')
            .setColor(0x9b59b6);

        if (skills.length === 0) {
            embed.setDescription('No skills tracked yet. Run some tasks first!');
        } else {
            const lines = skills.slice(0, 10).map(s => {
                const pct = s.total_runs > 0 ? Math.round((s.successful_runs / s.total_runs) * 100) : 0;
                const rec = s.recommended_tier && s.recommended_tier !== s.current_tier
                    ? ` → 💡 ${s.recommended_tier}` : '';
                return `**${s.skill_name}** — ${s.total_runs} runs, ${pct}% success, avg ${s.avg_tool_calls} tools [${s.current_tier}${rec}]`;
            });
            embed.setDescription(lines.join('\n'));
        }

        if (recommendations.length > 0) {
            const recLines = recommendations.slice(0, 5).map(r => {
                const dir = r.recommended_tier === 'local' ? '⬇️ local' : '⬆️ paid';
                return `**${r.skill_name}**: ${r.current_tier} → ${dir}`;
            });
            embed.addFields({ name: 'Recommendations', value: recLines.join('\n') });
        }

        embed.setTimestamp();
        await message.reply({ embeds: [embed] });
        return true;
    }

    if (cmd === '/help') {
        const embed = new EmbedBuilder()
            .setTitle('🦀 Gravity Claw — Commands')
            .setColor(0x3498db)
            .setDescription('Available commands:')
            .addFields(
                { name: '/reset', value: 'Clear conversation history', inline: true },
                { name: '/status', value: 'System status & stats', inline: true },
                { name: '/costs', value: 'Token spend breakdown', inline: true },
                { name: '/skills', value: 'Skill tracker & recommendations', inline: true },
                { name: '/help', value: 'Show this message', inline: true },
            );
        await message.reply({ embeds: [embed] });
        return true;
    }

    return false; // Not a known command
}

// ============================
// MAIN MESSAGE HANDLER
// ============================
bot.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // Security: Only respond to whitelisted user
    if (message.author.id !== config.discordUserId) {
        console.log(`[Security] Ignored unauthorized access from User ID: ${message.author.id}`);
        return;
    }

    let userText = message.content;
    let isVoice = false;
    const attachments: { type: 'image' | 'document'; url: string; filename: string; localPath: string }[] = [];

    // Handle slash commands first
    if (userText.startsWith('/')) {
        const handled = await handleSlashCommand(message, userText);
        if (handled) return;
        // If not a known command, pass through to the agent
    }

    // Check for voice message attachments
    const voiceAttachment = message.attachments.find(a => !!a.contentType?.startsWith('audio/') || !!a.name?.endsWith('.ogg'));

    if (voiceAttachment) {
        console.log(`[Voice] Received voice message payload. Transcribing...`);
        try {
            await message.channel.sendTyping();
            userText = await transcribeAudio(voiceAttachment.url);
            console.log(`[Voice] Transcribed text: "${userText}"`);
            isVoice = true;
        } catch (e: any) {
            console.error('[Voice] STT error:', e);
            await message.reply('❌ Failed to transcribe your voice message. Check that your OpenAI key has audio permissions.');
            return;
        }
    }

    // Handle non-audio attachments
    const mediaAttachments = message.attachments.filter(a =>
        !a.contentType?.startsWith('audio/') && !a.name?.endsWith('.ogg')
    );

    if (mediaAttachments.size > 0) {
        const uploadsDir = path.join(config.sandboxPath, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        for (const [, att] of mediaAttachments) {
            const filename = att.name || `file_${Date.now()}`;
            const localPath = path.join(uploadsDir, filename);
            const isImage = att.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(filename);

            try {
                const response = await fetch(att.url);
                const buffer = Buffer.from(await response.arrayBuffer());
                fs.writeFileSync(localPath, buffer);
                console.log(`[Media] Downloaded ${filename} (${att.contentType}) to ${localPath}`);

                attachments.push({
                    type: isImage ? 'image' : 'document',
                    url: att.url,
                    filename,
                    localPath: `/sandbox/uploads/${filename}`
                });
            } catch (e: any) {
                console.error(`[Media] Failed to download ${filename}:`, e.message);
            }
        }
    }

    if (!userText && !isVoice && attachments.length === 0) {
        return;
    }

    console.log(`[Debug] Processing: "${userText.substring(0, 80)}" with ${attachments.length} attachment(s)`);

    // Start persistent typing indicator (refreshes every 8s)
    const stopTyping = startPersistentTyping(message.channel);

    try {
        const reply = await handleUserMessage(userText, attachments);
        stopTyping();

        // Voice response
        let audioAttachment = undefined;
        if (isVoice && config.elevenlabsApiKey) {
            try {
                const audioBuffer = await synthesizeSpeech(reply);
                audioAttachment = new AttachmentBuilder(audioBuffer, { name: 'reply.mp3' });
            } catch (e) {
                console.error('[Voice] TTS error:', e);
            }
        }

        // Split long messages instead of truncating
        const chunks = splitMessage(reply);

        for (let i = 0; i < chunks.length; i++) {
            const payload: any = { content: chunks[i] };

            // Attach audio to the first message only
            if (i === 0 && audioAttachment) {
                payload.files = [audioAttachment];
            }

            if (i === 0) {
                await message.reply(payload);
            } else {
                // Subsequent chunks sent as follow-up messages (not replies)
                await message.channel.send(payload);
            }
        }

    } catch (error: any) {
        stopTyping();
        console.error('[Bot] Error handling message:', error);

        // Better error messages
        let errorMsg = '❌ Something went wrong while processing your request.';
        if (error.message?.includes('rate limit') || error.message?.includes('429')) {
            errorMsg = '⏳ All API providers are currently rate-limited. Try again in a minute.';
        } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
            errorMsg = '⏱️ The request timed out. The task might be too complex — try breaking it into smaller steps.';
        } else if (error.message?.includes('API key') || error.message?.includes('authentication')) {
            errorMsg = '🔑 API authentication error. Check that your keys in .env are valid.';
        }

        await message.reply(errorMsg);
    }
});

// Ready event
bot.once(Events.ClientReady, (readyClient) => {
    console.log(`[Core] Gravity Claw Online. Bot logged in as ${readyClient.user.tag}`);
});

export async function startBot() {
    await bot.login(config.discordBotToken);
}

export async function stopBot() {
    await bot.destroy();
}
