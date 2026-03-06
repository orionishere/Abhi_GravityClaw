import { execSync } from 'child_process';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

export const execSchema = {
    type: 'function',
    function: {
        name: 'exec',
        description: 'Execute a bash command inside a secure Docker sandbox. The command runs in an isolated container with access only to /sandbox. Persisted pip packages from your learned skills are auto-installed. Examples: "python3 script.py", "ls /sandbox", "cat /sandbox/data.txt".',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The bash command to execute inside the Docker sandbox (e.g., "python3 /sandbox/script.py" or "pip install openpyxl && python3 -c \'import openpyxl; ...\'")'
                },
                timeout: {
                    type: 'number',
                    description: 'Optional timeout in seconds (default: 30, max: 120)'
                }
            },
            required: ['command'],
            additionalProperties: false
        }
    }
};

// Read persisted packages from Obsidian vault
function getPersistedPackages(): string[] {
    try {
        const pkgFile = path.join(config.obsidianPath, 'skills', '_packages.txt');
        if (fs.existsSync(pkgFile)) {
            const content = fs.readFileSync(pkgFile, 'utf8');
            return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        }
    } catch { }
    return [];
}

export async function exec(args: any): Promise<string> {
    const command = args.command;
    const timeoutSec = Math.min(args.timeout || 30, 120);

    // Build the full command with persisted package installs
    const packages = getPersistedPackages();
    let fullCommand = command;
    if (packages.length > 0) {
        const pipInstall = `pip install -q ${packages.join(' ')} 2>/dev/null`;
        fullCommand = `${pipInstall} && ${command}`;
    }

    try {
        const result = execSync(
            `docker run --rm -v ${config.sandboxPath}:/sandbox --network none --memory 256m --cpus 1 python:3.12-slim bash -c ${JSON.stringify(fullCommand)}`,
            {
                timeout: timeoutSec * 1000,
                maxBuffer: 1024 * 1024,
                encoding: 'utf8'
            }
        );

        return result || '(command completed with no output)';
    } catch (e: any) {
        if (e.stderr) {
            return `Command failed:\nSTDOUT: ${e.stdout || ''}\nSTDERR: ${e.stderr}`;
        }
        return `Exec error: ${e.message}`;
    }
}

