import { exec } from 'child_process';

class DockerSandbox {
    private static readonly dockerImage = 'node:14';
    private static readonly sandboxDirectory = '/data/sandbox';

    private static runCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(`Error: ${error.message}`);
                } else if (stderr) {
                    reject(`Stderr: ${stderr}`);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    static async executeInSandbox(command: string): Promise<string> {
        const dockerCommand = `docker run --rm -v ${this.sandboxDirectory}:${this.sandboxDirectory} -w ${this.sandboxDirectory} ${this.dockerImage} /bin/sh -c "${command}"`;
        return this.runCommand(dockerCommand);
    }
}

export default DockerSandbox;
