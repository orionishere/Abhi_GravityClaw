import { config } from '../config.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export const githubCreateAndPushSchema = {
    type: 'function',
    function: {
        name: 'github_create_and_push',
        description: 'Create a new GitHub repository and push project files to it. IMPORTANT: Always ask the user for explicit permission before calling this tool. The project files should already exist in /sandbox/<project_dir>.',
        parameters: {
            type: 'object',
            properties: {
                repoName: {
                    type: 'string',
                    description: 'Name for the new GitHub repository (e.g., "my-python-project")'
                },
                description: {
                    type: 'string',
                    description: 'Short description for the GitHub repository'
                },
                projectDir: {
                    type: 'string',
                    description: 'Directory inside /sandbox/ containing the project files (e.g., "my-project")'
                },
                isPrivate: {
                    type: 'boolean',
                    description: 'Whether the repo should be private (default: false)'
                }
            },
            required: ['repoName', 'projectDir'],
            additionalProperties: false
        }
    }
};

export async function githubCreateAndPush(args: any): Promise<string> {
    const { repoName, description, projectDir, isPrivate } = args;
    const token = config.githubToken;
    const username = config.githubUsername;

    if (!token || !username) {
        return 'Error: GitHub credentials not configured. Set GITHUB_TOKEN and GITHUB_USERNAME in .env';
    }

    const fullProjectPath = path.join(config.sandboxPath, projectDir);
    if (!fs.existsSync(fullProjectPath)) {
        return `Error: Project directory /sandbox/${projectDir} does not exist. Create the project files first.`;
    }

    try {
        // Step 1: Create the GitHub repo via API
        const createRes = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
                name: repoName,
                description: description || `Created by Gravity Claw`,
                private: isPrivate || false,
                auto_init: false
            })
        });

        if (!createRes.ok) {
            const err = await createRes.json();
            if (err.errors?.[0]?.message?.includes('already exists')) {
                return `Error: Repository '${repoName}' already exists on GitHub. Choose a different name.`;
            }
            return `Error creating repo: ${JSON.stringify(err)}`;
        }

        const repo = await createRes.json() as any;
        const repoUrl = repo.clone_url;
        console.log(`[GitHub] Created repo: ${repoUrl}`);

        // Step 2: Initialize git, commit, and push using host git
        const gitCommands = [
            `cd ${fullProjectPath}`,
            'git init',
            'git add -A',
            'git commit -m "Initial commit by Gravity Claw"',
            `git remote add origin https://${username}:${token}@github.com/${username}/${repoName}.git`,
            'git branch -M main',
            'git push -u origin main'
        ].join(' && ');

        execSync(gitCommands, {
            encoding: 'utf8',
            timeout: 30000
        });

        console.log(`[GitHub] Pushed to ${repoUrl}`);
        return `Successfully created and pushed to: ${repo.html_url}`;

    } catch (e: any) {
        console.error('[GitHub] Error:', e.message);
        return `GitHub push failed: ${e.message}`;
    }
}
