import OpenAI from 'openai';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, '..', 'data');

const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

/**
 * Downloads a voice message URL and uses OpenAI Whisper to transcribe it.
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempFilePath = path.join(tempDir, `temp_voice_${Date.now()}.ogg`);

    fs.writeFileSync(tempFilePath, buffer);

    try {
        const fileStream = fs.createReadStream(tempFilePath);
        const transcription = await openai.audio.transcriptions.create({
            file: fileStream,
            model: 'whisper-1',
        });

        return transcription.text;
    } finally {
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}

/**
 * Synthesizes text to speech using ElevenLabs API, returning an MP3 buffer.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabsVoiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.elevenlabsApiKey,
        },
        body: JSON.stringify({
            text: text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`ElevenLabs Error: ${response.status} - ${err}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
