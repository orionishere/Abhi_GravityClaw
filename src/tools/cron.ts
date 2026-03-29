import cron, { ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { handleCronTask } from '../agent.js';
import { bot, splitMessage } from '../bot.js';

// In-memory store of active cron tasks
const activeTasks: Map<string, ScheduledTask> = new Map();

// Path to persistent cron definitions
const CRON_FILE = () => path.join(config.obsidianPath, 'cron_jobs.json');

// --- Tool Schemas ---

export const scheduleCronSchema = {
    type: 'function',
    function: {
        name: 'schedule_cron',
        description: 'Schedule a recurring task. IMPORTANT: Always inform the user about what you are scheduling before calling this tool. If the user says no, do not schedule it. Uses standard cron syntax (e.g., "0 9 * * *" for daily at 9 AM).',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'A short, unique name for this scheduled task (e.g., "daily-email-project")'
                },
                schedule: {
                    type: 'string',
                    description: 'Cron schedule expression (e.g., "0 9 * * *" for daily at 9 AM, "0 */6 * * *" for every 6 hours)'
                },
                task: {
                    type: 'string',
                    description: 'The task to execute on schedule — this will be sent to the agent as if the user typed it'
                }
            },
            required: ['name', 'schedule', 'task'],
            additionalProperties: false
        }
    }
};

export const cancelCronSchema = {
    type: 'function',
    function: {
        name: 'cancel_cron',
        description: 'Cancel a previously scheduled recurring task by name.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The name of the scheduled task to cancel'
                }
            },
            required: ['name'],
            additionalProperties: false
        }
    }
};

export const listCronsSchema = {
    type: 'function',
    function: {
        name: 'list_crons',
        description: 'List all currently active scheduled (cron) tasks.',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }
};

// --- Persistence ---

interface CronDefinition {
    name: string;
    schedule: string;
    task: string;
}

function loadCronDefinitions(): CronDefinition[] {
    try {
        const filePath = CRON_FILE();
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e: any) {
        console.error('[Cron] Failed to load cron definitions:', (e as Error).message);
    }
    return [];
}

function saveCronDefinitions(defs: CronDefinition[]): void {
    try {
        const filePath = CRON_FILE();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(defs, null, 2));
    } catch (e: any) {
        console.error('[Cron] Failed to save cron definitions:', e.message);
    }
}

// --- Task Execution ---

function startCronTask(def: CronDefinition): boolean {
    if (!cron.validate(def.schedule)) {
        console.error(`[Cron] Invalid schedule for "${def.name}": ${def.schedule}`);
        return false;
    }

    if (activeTasks.has(def.name)) {
        activeTasks.get(def.name)!.stop();
    }

    const task = cron.schedule(def.schedule, async () => {
        console.log(`[Cron] Executing scheduled task: "${def.name}"`);
        try {
            const result = await handleCronTask(def.task);

            // Send the result to the user via Discord DM
            const user = await bot.users.fetch(config.discordUserId);
            const header = `📅 **Scheduled Task: ${def.name}**\n`;
            const chunks = splitMessage(header + result);
            for (const chunk of chunks) {
                await user.send(chunk);
            }
        } catch (e: any) {
            console.error(`[Cron] Error in task "${def.name}":`, e.message);
        }
    });

    activeTasks.set(def.name, task);
    console.log(`[Cron] Scheduled "${def.name}" with schedule: ${def.schedule}`);
    return true;
}

// --- Boot Loader (called from heartbeat.ts) ---

export function loadDynamicCrons(): void {
    const defs = loadCronDefinitions();
    for (const def of defs) {
        startCronTask(def);
    }
    if (defs.length > 0) {
        console.log(`[Cron] Loaded ${defs.length} dynamic cron job(s) from Obsidian.`);
    }
}

// --- Tool Executors ---

export async function scheduleCron(args: any): Promise<string> {
    const { name, schedule, task } = args;

    if (!cron.validate(schedule)) {
        return `Error: Invalid cron schedule "${schedule}". Use standard cron syntax (e.g., "0 9 * * *" for daily at 9 AM).`;
    }

    const def: CronDefinition = { name, schedule, task };

    // Save to persistent file
    const defs = loadCronDefinitions();
    const existingIdx = defs.findIndex(d => d.name === name);
    if (existingIdx >= 0) {
        defs[existingIdx] = def;
    } else {
        defs.push(def);
    }
    saveCronDefinitions(defs);

    // Start the task immediately
    startCronTask(def);

    return `Scheduled task "${name}" with schedule: ${schedule}\nTask: ${task}\n\nThis job is now active and will persist across restarts.`;
}

export async function cancelCron(args: any): Promise<string> {
    const { name } = args;

    // Stop the in-memory task
    if (activeTasks.has(name)) {
        activeTasks.get(name)!.stop();
        activeTasks.delete(name);
    }

    // Remove from persistent file
    const defs = loadCronDefinitions();
    const filtered = defs.filter(d => d.name !== name);
    if (filtered.length === defs.length) {
        return `No scheduled task found with name "${name}".`;
    }
    saveCronDefinitions(filtered);

    return `Cancelled and removed scheduled task "${name}".`;
}

export async function listCrons(): Promise<string> {
    const defs = loadCronDefinitions();
    if (defs.length === 0) {
        return 'No scheduled tasks are currently active.';
    }

    let output = `Active scheduled tasks (${defs.length}):\n\n`;
    for (const def of defs) {
        output += `• **${def.name}** — Schedule: \`${def.schedule}\`\n  Task: ${def.task}\n\n`;
    }
    return output;
}
