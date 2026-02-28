import { Client, Events, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import { config } from './config.js';
import { handleUserMessage } from './agent.js';
import { transcribeAudio, synthesizeSpeech } from './voice.js';

export const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel] // Required to receive direct messages
});

// Security: Check message creator
bot.on(Events.MessageCreate, async (message) => {
    // Ignore bots including ourselves
    if (message.author.bot) return;

    // Security check: Only respond to our whitelisted user ID
    if (message.author.id !== config.discordUserId) {
        console.log(`[Security] Ignored unauthorized access attempt from User ID: ${message.author.id}`);
        return;
    }

    let userText = message.content;
    let isVoice = false;

    // Check for voice message attachments
    // Discord voice messages are typically audio/ogg files
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
            await message.reply('Failed to transcribe your voice message. (Ensure OpenAI API keys specify audio permissions)');
            return;
        }
    }

    if (!userText && !isVoice) {
        console.log(`[Debug] Received message from ${message.author.tag}, but content and attachments are empty!`);
        return;
    }

    console.log(`[Debug] Processing semantic input: "${userText}"`);

    // Simulate typing indicator for LLM processing
    try {
        await message.channel.sendTyping();
    } catch (e) {
        // Ignored
    }

    try {
        const reply = await handleUserMessage(userText);

        let audioAttachment = undefined;
        // If the user spoke to us, we speak back (Voice-in -> Voice-out)
        if (isVoice && config.elevenlabsApiKey) {
            console.log(`[Voice] Synthesizing speech for reply...`);
            await message.channel.sendTyping();
            try {
                const audioBuffer = await synthesizeSpeech(reply);
                audioAttachment = new AttachmentBuilder(audioBuffer, { name: 'reply.mp3' });
            } catch (e) {
                console.error('[Voice] TTS error:', e);
            }
        }

        // Break up long messages if needed
        const replyPayload: any = {};
        if (reply.length > 2000) {
            replyPayload.content = reply.substring(0, 1996) + '...';
        } else {
            replyPayload.content = reply;
        }

        if (audioAttachment) {
            replyPayload.files = [audioAttachment];
        }

        await message.reply(replyPayload);

    } catch (error) {
        console.error('[Bot] Error handling message:', error);
        await message.reply('A system error occurred while processing your request.');
    }
});

// Setup ready event
bot.once(Events.ClientReady, (readyClient) => {
    console.log(`[Core] Gravity Claw Online. Bot logged in as ${readyClient.user.tag}`);
});

// Helper for index.ts
export async function startBot() {
    await bot.login(config.discordBotToken);
}

// Ensure smooth cleanup on shutdown
export async function stopBot() {
    await bot.destroy();
}
