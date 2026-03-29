import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const GOALS_FILE = () => path.join(config.obsidianPath, 'goals.md');
const DEFAULT_HEADER = '# Goals & Pillars\n\n';

export const manageGoalsSchema = {
    type: 'function',
    function: {
        name: 'manage_goals',
        description: 'Manage your goals and pillars. Use this when the user asks to add, remove, update, or list their goals. Goals are scored nightly by the dream cycle.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'One of: "list", "add", "remove", "update"'
                },
                pillar_name: {
                    type: 'string',
                    description: 'The name of the goal pillar (e.g., "Fitness", "CGC Agent Development"). Required for add, remove, update.'
                },
                description: {
                    type: 'string',
                    description: 'The pillar description. Required for add, optional for update.'
                },
                current_focus: {
                    type: 'string',
                    description: 'What you are currently focused on within this pillar. Optional.'
                }
            },
            required: ['action'],
            additionalProperties: false
        }
    }
};

function readGoals(): string | null {
    try {
        const filePath = GOALS_FILE();
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (e: any) {
        console.error('[ManageGoals] Failed to read goals file:', e.message);
    }
    return null;
}

function writeGoals(content: string): void {
    const filePath = GOALS_FILE();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Split goals.md into an array of sections.
 * Each section starts with a ## heading line.
 * Returns [header, ...sections] where header is everything before the first ##.
 */
function splitSections(content: string): { header: string; sections: string[] } {
    const lines = content.split('\n');
    let header = '';
    const sections: string[] = [];
    let current = '';
    let inSection = false;

    for (const line of lines) {
        if (line.startsWith('## ')) {
            if (inSection) {
                sections.push(current.trimEnd());
            } else {
                header = current;
            }
            current = line + '\n';
            inSection = true;
        } else {
            current += line + '\n';
        }
    }
    if (inSection && current.trim()) {
        sections.push(current.trimEnd());
    } else if (!inSection) {
        header = current;
    }

    return { header, sections };
}

/**
 * Renumber section headings sequentially: ## 1. Title, ## 2. Title, ...
 */
function renumberSections(sections: string[]): string[] {
    return sections.map((section, i) => {
        return section.replace(/^## \d+\.\s*/, `## ${i + 1}. `);
    });
}

/**
 * Extract the pillar name from a section heading (after the number).
 * "## 3. Cricket Influencer" → "Cricket Influencer"
 */
function extractPillarName(section: string): string {
    const match = section.match(/^## \d+\.\s*(.+)/m);
    return match ? match[1].trim() : '';
}

export async function executeManageGoals(args: any): Promise<string> {
    const { action, pillar_name, description, current_focus } = args;

    // --- LIST ---
    if (action === 'list') {
        const content = readGoals();
        if (!content) {
            return 'No goals file found. Use `add` to create your first goal.';
        }
        return content;
    }

    // --- ADD ---
    if (action === 'add') {
        if (!pillar_name || !pillar_name.trim()) {
            return 'Error: pillar_name is required for add.';
        }
        if (!description || !description.trim()) {
            return 'Error: description is required for add.';
        }

        const existing = readGoals();
        const content = existing || DEFAULT_HEADER;
        const { header, sections } = splitSections(content);

        const nextNumber = sections.length + 1;
        const focusLine = `Current focus: ${current_focus && current_focus.trim() ? current_focus.trim() : 'not set'}`;
        const newSection = `## ${nextNumber}. ${pillar_name.trim()}\n${description.trim()}\n${focusLine}`;

        sections.push(newSection);
        const newContent = header + sections.join('\n\n') + '\n';
        writeGoals(newContent);

        return `Added pillar: ${pillar_name.trim()}`;
    }

    // --- REMOVE ---
    if (action === 'remove') {
        if (!pillar_name || !pillar_name.trim()) {
            return 'Error: pillar_name is required for remove.';
        }

        const content = readGoals();
        if (!content) {
            return 'Error: No goals file found.';
        }

        const { header, sections } = splitSections(content);
        const lowerTarget = pillar_name.trim().toLowerCase();
        const idx = sections.findIndex(s => extractPillarName(s).toLowerCase().includes(lowerTarget));

        if (idx === -1) {
            return `No pillar found matching '${pillar_name}'. Use list to see current pillars.`;
        }

        sections.splice(idx, 1);
        const renumbered = renumberSections(sections);
        const newContent = header + renumbered.join('\n\n') + (renumbered.length > 0 ? '\n' : '');
        writeGoals(newContent);

        return `Removed pillar: ${pillar_name.trim()}`;
    }

    // --- UPDATE ---
    if (action === 'update') {
        if (!pillar_name || !pillar_name.trim()) {
            return 'Error: pillar_name is required for update.';
        }
        if (!description && !current_focus) {
            return 'Error: provide at least description or current_focus to update.';
        }

        const content = readGoals();
        if (!content) {
            return 'Error: No goals file found.';
        }

        const { header, sections } = splitSections(content);
        const lowerTarget = pillar_name.trim().toLowerCase();
        const idx = sections.findIndex(s => extractPillarName(s).toLowerCase().includes(lowerTarget));

        if (idx === -1) {
            return `No pillar found matching '${pillar_name}'. Use list to see current pillars.`;
        }

        let section = sections[idx];
        const lines = section.split('\n');
        const headingLine = lines[0]; // ## N. Title

        // Rebuild section from heading
        let newLines = [headingLine];

        if (description && description.trim()) {
            // Replace body lines (between heading and "Current focus:")
            // Find the current_focus line index
            const focusIdx = lines.findIndex(l => l.toLowerCase().startsWith('current focus:'));
            const existingFocus = focusIdx >= 0 ? lines[focusIdx] : `Current focus: not set`;
            const resolvedFocus = current_focus && current_focus.trim()
                ? `Current focus: ${current_focus.trim()}`
                : existingFocus;
            newLines.push(description.trim());
            newLines.push(resolvedFocus);
        } else {
            // Keep existing description, only update current_focus
            const focusIdx = lines.findIndex(l => l.toLowerCase().startsWith('current focus:'));
            if (focusIdx >= 0) {
                for (let i = 1; i < lines.length; i++) {
                    if (i === focusIdx) {
                        newLines.push(`Current focus: ${current_focus!.trim()}`);
                    } else {
                        newLines.push(lines[i]);
                    }
                }
            } else {
                // No current focus line exists — keep body and append
                for (let i = 1; i < lines.length; i++) {
                    newLines.push(lines[i]);
                }
                newLines.push(`Current focus: ${current_focus!.trim()}`);
            }
        }

        sections[idx] = newLines.join('\n').trimEnd();
        const newContent = header + sections.join('\n\n') + '\n';
        writeGoals(newContent);

        return `Updated pillar: ${extractPillarName(sections[idx])}\n\n${sections[idx]}`;
    }

    return `Error: Unknown action "${action}". Use one of: list, add, remove, update.`;
}
