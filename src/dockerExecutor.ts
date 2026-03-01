import { exec } from 'child_process';

function executeInDocker(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const dockerCommand = `docker run --rm -v /Users/abhismac/Desktop/GravityClaw/data/sandbox:/sandbox ubuntu /bin/sh -c "${command}"`;

        exec(dockerCommand, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr || error.message}`);
            } else {
                resolve(stdout);
            }
        });
    });
}

export default executeInDocker;
