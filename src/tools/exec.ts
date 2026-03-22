import { execFileSync, execSync } from 'child_process';
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

// Allowed characters in pip package names (PEP 508)
const SAFE_PACKAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*([<>=!~]+[a-zA-Z0-9.*]+)?$/;

// Read and VALIDATE persisted packages from Obsidian vault
function getPersistedPackages(): string[] {
    try {
        const pkgFile = path.join(config.obsidianPath, 'skills', '_packages.txt');
        if (fs.existsSync(pkgFile)) {
            const content = fs.readFileSync(pkgFile, 'utf8');
            const packages = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

            // Validate each package name — reject anything suspicious
            const safe: string[] = [];
            for (const pkg of packages) {
                if (SAFE_PACKAGE_PATTERN.test(pkg)) {
                    safe.push(pkg);
                } else {
                    console.warn(`[Exec] Rejected suspicious package name: "${pkg}"`);
                }
            }
            return safe;
        }
    } catch (e: any) {
        console.error('[Exec] Failed to read _packages.txt:', (e as Error).message);
    }
    return [];
}

// Stage 1: Install packages WITH network into persistent Docker volume
// Uses execFileSync with argument array — no shell injection possible
function installPackages(packages: string[]): void {
    if (packages.length === 0) return;

    console.log(`[Exec] Stage 1: Installing packages [${packages.join(', ')}] into persistent volume...`);

    try {
        execFileSync('docker', [
            'run', '--rm',
            '-v', `${PIP_VOLUME}:/pip-packages`,
            'python:3.12-slim',
            'pip', 'install', '--target=/pip-packages', '-q',
            ...packages,
        ], {
            timeout: 120000,
            encoding: 'utf8',
            stdio: 'pipe',
        });
        console.log(`[Exec] Stage 1: Packages installed successfully.`);
    } catch (e: any) {
        console.error(`[Exec] Stage 1: Package install warning: ${e.stderr || e.message}`);
    }
}

// Resolve and validate that sandbox path is absolute and exists
function getValidatedSandboxPath(): string {
    const resolved = path.resolve(config.sandboxPath);
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
}

export async function exec(args: any): Promise<string> {
    const command = args.command;
    const timeoutSec = Math.min(args.timeout || 30, 120);

    // Validate command is a string and not empty
    if (typeof command !== 'string' || command.trim().length === 0) {
        return 'Error: command must be a non-empty string.';
    }

    // Stage 1: Install any persisted packages (with network access)
    const packages = getPersistedPackages();
    installPackages(packages);

    // Stage 2: Run the command WITHOUT network
    // Uses execFileSync with array args — the command string is passed
    // as a single argument to bash -c, NOT interpolated into a shell string.
    const sandboxPath = getValidatedSandboxPath();

    try {
        const result = execFileSync('docker', [
            'run', '--rm',
            '--network', 'none',
            '--memory', '256m',
            '--cpus', '1',
            '--read-only',                          // Read-only root filesystem
            '--tmpfs', '/tmp:size=64m',              // Writable /tmp with size limit
            '-v', `${sandboxPath}:/sandbox`,
            '-v', `${PIP_VOLUME}:/pip-packages:ro`,  // Packages are read-only at runtime
            '-e', 'PYTHONPATH=/pip-packages',
            'python:3.12-slim',
            'bash', '-c', command,                   // command is a SINGLE argument, not shell-expanded
        ], {
            timeout: timeoutSec * 1000,
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
        });

        return result || '(command completed with no output)';
    } catch (e: any) {
        if (e.stderr) {
            return `Command failed:\nSTDOUT: ${e.stdout || ''}\nSTDERR: ${e.stderr}`;
        }
        return `Exec error: ${e.message}`;
    }
}
