import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { DreamConfig, BrowserSource, TwitterSource, DreamSource } from '../types/dream.js';
import { DEFAULT_DREAM_CONFIG } from '../types/dream.js';

const CONFIG_FILE = () => path.join(config.dataPath, 'dream_config.json');

export const manageResearchSchema = {
    type: 'function',
    function: {
        name: 'manage_research',
        description: "Manage the dream cycle's research configuration — topics to track and sources to scan nightly. Use this when the user asks to add, remove, or view research topics or data sources.",
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'add_topic', 'remove_topic', 'add_source', 'remove_source', 'toggle'],
                    description: 'The action to perform on the dream cycle research configuration.'
                },
                topic: {
                    type: 'string',
                    description: 'The research topic string. Required for add_topic and remove_topic.'
                },
                source_name: {
                    type: 'string',
                    description: 'Human-readable name of the source. Required for add_source and remove_source.'
                },
                source_url: {
                    type: 'string',
                    description: 'The URL to scan. Required when source_type is "browser".'
                },
                source_type: {
                    type: 'string',
                    description: 'Either "browser" or "twitter". Defaults to "browser".'
                },
                source_query: {
                    type: 'string',
                    description: 'Twitter search query terms. Required when source_type is "twitter".'
                },
                enabled: {
                    type: 'boolean',
                    description: 'Enable or disable the dream cycle. Required for toggle.'
                }
            },
            required: ['action'],
            additionalProperties: false
        }
    }
};

function readConfig(): DreamConfig {
    try {
        const filePath = CONFIG_FILE();
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return { ...DEFAULT_DREAM_CONFIG, ...JSON.parse(raw) };
        }
    } catch (e: any) {
        console.error('[ManageResearch] Failed to read dream_config.json:', e.message);
    }
    return { ...DEFAULT_DREAM_CONFIG };
}

function writeConfig(cfg: DreamConfig): void {
    const filePath = CONFIG_FILE();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 4), 'utf8');
}

function formatConfig(cfg: DreamConfig): string {
    const statusLine = `Dream Cycle: ${cfg.enabled ? 'ENABLED' : 'DISABLED'}`;

    const topicLines = cfg.topics.length > 0
        ? cfg.topics.map(t => `• ${t}`).join('\n')
        : '  (none)';

    const sourceLines = cfg.sources.length > 0
        ? cfg.sources.map(s => {
            if (s.type === 'twitter') {
                return `• ${s.name} — "${(s as TwitterSource).query}" [twitter]`;
            } else {
                return `• ${s.name} — ${(s as BrowserSource).url} [browser]`;
            }
        }).join('\n')
        : '  (none)';

    return [
        statusLine,
        '',
        `Topics (${cfg.topics.length}):`,
        topicLines,
        '',
        `Sources (${cfg.sources.length}):`,
        sourceLines
    ].join('\n');
}

export async function executeManageResearch(args: any): Promise<string> {
    const { action, topic, source_name, source_url, source_type, source_query, enabled } = args;

    // --- LIST ---
    if (action === 'list') {
        const cfg = readConfig();
        return formatConfig(cfg);
    }

    // --- ADD_TOPIC ---
    if (action === 'add_topic') {
        if (!topic || !topic.trim()) {
            return 'Error: topic is required for add_topic.';
        }
        const cfg = readConfig();
        const lowerNew = topic.trim().toLowerCase();
        const exists = cfg.topics.some(t => t.toLowerCase() === lowerNew);
        if (exists) {
            return `Topic already exists: ${topic.trim()}`;
        }
        cfg.topics.push(topic.trim());
        writeConfig(cfg);
        return `Added research topic: ${topic.trim()}`;
    }

    // --- REMOVE_TOPIC ---
    if (action === 'remove_topic') {
        if (!topic || !topic.trim()) {
            return 'Error: topic is required for remove_topic.';
        }
        const cfg = readConfig();
        const lowerTarget = topic.trim().toLowerCase();
        const idx = cfg.topics.findIndex(t => t.toLowerCase().includes(lowerTarget));
        if (idx === -1) {
            return `Topic not found matching '${topic.trim()}'. Use list to see current topics.`;
        }
        const removed = cfg.topics.splice(idx, 1)[0];
        writeConfig(cfg);
        return `Removed research topic: ${removed}`;
    }

    // --- ADD_SOURCE ---
    if (action === 'add_source') {
        if (!source_name || !source_name.trim()) {
            return 'Error: source_name is required for add_source.';
        }
        const resolvedType = (source_type || 'browser').toLowerCase();
        if (resolvedType !== 'browser' && resolvedType !== 'twitter') {
            return 'Error: source_type must be "browser" or "twitter".';
        }
        if (resolvedType === 'browser' && (!source_url || !source_url.trim())) {
            return 'Error: source_url is required when source_type is "browser".';
        }
        if (resolvedType === 'twitter' && (!source_query || !source_query.trim())) {
            return 'Error: source_query is required when source_type is "twitter".';
        }

        const cfg = readConfig();
        const lowerName = source_name.trim().toLowerCase();
        const exists = cfg.sources.some(s => s.name.toLowerCase() === lowerName);
        if (exists) {
            return `Source already exists with name '${source_name.trim()}'. Remove it first to replace.`;
        }

        let newSource: DreamSource;
        if (resolvedType === 'twitter') {
            newSource = { name: source_name.trim(), type: 'twitter', query: source_query.trim() };
        } else {
            newSource = { name: source_name.trim(), url: source_url.trim(), type: 'browser' };
        }

        cfg.sources.push(newSource);
        writeConfig(cfg);
        return `Added source: ${source_name.trim()} [${resolvedType}]`;
    }

    // --- REMOVE_SOURCE ---
    if (action === 'remove_source') {
        if (!source_name || !source_name.trim()) {
            return 'Error: source_name is required for remove_source.';
        }
        const cfg = readConfig();
        const lowerTarget = source_name.trim().toLowerCase();
        const idx = cfg.sources.findIndex(s => s.name.toLowerCase().includes(lowerTarget));
        if (idx === -1) {
            return `Source not found matching '${source_name.trim()}'. Use list to see current sources.`;
        }
        const removed = cfg.sources.splice(idx, 1)[0];
        writeConfig(cfg);
        return `Removed source: ${removed.name}`;
    }

    // --- TOGGLE ---
    if (action === 'toggle') {
        if (typeof enabled !== 'boolean') {
            return 'Error: enabled must be a boolean (true or false) for toggle.';
        }
        const cfg = readConfig();
        cfg.enabled = enabled;
        writeConfig(cfg);
        return `Dream cycle ${enabled ? 'enabled' : 'disabled'}.`;
    }

    return `Error: Unknown action "${action}". Use one of: list, add_topic, remove_topic, add_source, remove_source, toggle.`;
}
