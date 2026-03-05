import { execSync } from 'child_process';
import { config } from './config.js';

export function runInDocker(command: string): string {
    try {
        const dockerCommand = `docker run --rm -v ${config.sandboxPath}:/sandbox ubuntu /bin/sh -c "${command}"`;
        return execSync(dockerCommand, { encoding: 'utf8' });
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
}

export { runInDocker as executeInDocker };
