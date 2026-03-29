import fs from 'fs';

/**
 * Shared file-system helpers used by dreamCycle.ts and nightlyReview.ts.
 */

export function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export function readFileIfExists(filePath: string, maxLength = 5000): string {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.length > maxLength ? content.substring(0, maxLength) + '\n...[truncated]' : content;
        }
    } catch (e: any) {
        console.warn(`[FileUtils] Could not read ${filePath}: ${e.message}`);
    }
    return '';
}
