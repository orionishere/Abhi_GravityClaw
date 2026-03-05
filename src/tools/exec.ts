import { execSync } from 'child_process';
import { config } from '../config.js';

export const execSchema = {
    type: 'function',
    function: {
        name: 'exec',
        description: 'Execute a bash command inside a secure Docker sandbox. The command runs in an isolated container with access only to /sandbox. Use this to run scripts, process files (Excel, CSV, PDF), install packages, and perform computations. Examples: "python3 script.py", "ls /sandbox", "cat /sandbox/data.txt".',
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

export async function exec(args: any): Promise<string> {
    const command = args.command;
    const timeoutSec = Math.min(args.timeout || 30, 120);

    try {
        // Run the command inside a Docker container with only /sandbox mounted
        const result = execSync(
            `docker run --rm -v ${config.sandboxPath}:/sandbox --network none --memory 256m --cpus 1 python:3.12-slim bash -c ${JSON.stringify(command)}`,
            {
                timeout: timeoutSec * 1000,
                maxBuffer: 1024 * 1024,  // 1MB output limit
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
