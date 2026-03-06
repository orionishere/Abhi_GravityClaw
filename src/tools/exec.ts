import { execSync } from 'child_process';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

export const execSchema = {
    type: 'function',
    function: {
        name: 'exec',
        description: 'Execute a bash command inside a secure Docker sandbox. The command runs in an isolated container with NO network access. Only /sandbox is accessible. Persisted pip packages from your learned skills are pre-installed and available. Examples: "python3 script.py", "ls /sandbox", "cat /sandbox/data.txt".',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The bash command to execute inside the Docker sandbox (e.g., "python3 /sandbox/script.py")'
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

// Docker volume for persisted pip packages
const PIP_VOLUME = 'gravityclaw-pip';

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

// Stage 1: Install packages WITH network into persistent Docker volume
function installPackages(packages: string[]): void {
    if (packages.length === 0) return;

    const pkgList = packages.join(' ');
    console.log(`[Exec] Stage 1: Installing packages [${pkgList}] into persistent volume...`);

    try {
        execSync(
            `docker run --rm -v ${PIP_VOLUME}:/pip-packages python:3.12-slim pip install --target=/pip-packages -q ${pkgList}`,
            {
                timeout: 120000, // 2 minutes for installs
                encoding: 'utf8',
                stdio: 'pipe'
            }
        );
        console.log(`[Exec] Stage 1: Packages installed successfully.`);
    } catch (e: any) {
        console.error(`[Exec] Stage 1: Package install warning: ${e.stderr || e.message}`);
        // Don't throw — some packages may already be installed, continue to Stage 2
    }
}

export async function exec(args: any): Promise<string> {
    const command = args.command;
    const timeoutSec = Math.min(args.timeout || 30, 120);

    // Stage 1: Install any persisted packages (with network access)
    const packages = getPersistedPackages();
    installPackages(packages);

    // Stage 2: Run the user's command WITHOUT network, with pre-installed packages available
    try {
        const result = execSync(
            [
                'docker run --rm',
                `--network none`,             // No network for user commands
                `--memory 256m --cpus 1`,       // Resource limits
                `-v ${config.sandboxPath}:/sandbox`,         // User files
                `-v ${PIP_VOLUME}:/pip-packages`,            // Pre-installed packages
                `-e PYTHONPATH=/pip-packages`,               // Python can find the packages
                `python:3.12-slim`,
                `bash -c ${JSON.stringify(command)}`
            ].join(' '),
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
