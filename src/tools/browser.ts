import { chromium, Browser, Page } from 'playwright';
import { config } from '../config.js';
import path from 'path';

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureBrowser(): Promise<Page> {
    if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1920,1080',
                '--start-maximized',
            ],
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/Vancouver',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        // Remove webdriver flag that reveals automation
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        page = await context.newPage();
    }
    if (!page || page.isClosed()) {
        page = await browser.newPage();
    }
    return page;
}

// --- Tool Schemas ---

export const browserNavigateSchema = {
    type: 'function',
    function: {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL and return the page text content. Use this to visit websites, read articles, check information, etc.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The full URL to navigate to (e.g., https://example.com)'
                }
            },
            required: ['url'],
            additionalProperties: false
        }
    }
};

export const browserGetTextSchema = {
    type: 'function',
    function: {
        name: 'browser_get_text',
        description: 'Get the visible text content of the current browser page.',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }
};

export const browserScreenshotSchema = {
    type: 'function',
    function: {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current browser page and save it to the sandbox.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path inside /sandbox to save the screenshot (e.g., screenshot.png)'
                }
            },
            required: ['path'],
            additionalProperties: false
        }
    }
};

export const browserClickSchema = {
    type: 'function',
    function: {
        name: 'browser_click',
        description: 'Click on an element on the current page using a CSS selector.',
        parameters: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of the element to click'
                }
            },
            required: ['selector'],
            additionalProperties: false
        }
    }
};

export const browserTypeSchema = {
    type: 'function',
    function: {
        name: 'browser_type',
        description: 'Type text into an input field on the current page using a CSS selector.',
        parameters: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of the input element'
                },
                text: {
                    type: 'string',
                    description: 'Text to type into the element'
                }
            },
            required: ['selector', 'text'],
            additionalProperties: false
        }
    }
};

// --- Tool Executors ---

export async function browserNavigate(args: any): Promise<string> {
    try {
        const url = String(args.url || '');

        // Validate URL — block internal network access and dangerous schemes
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return `Browser navigation blocked: only http:// and https:// URLs are allowed. Got: "${url.substring(0, 50)}"`;
        }

        // Block internal/local network access (SSRF prevention)
        const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '169.254.', '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'];
        try {
            const parsed = new URL(url);
            const hostname = parsed.hostname.toLowerCase();
            if (blocked.some(b => hostname.startsWith(b) || hostname === b)) {
                return `Browser navigation blocked: cannot access internal/local network addresses.`;
            }
        } catch {
            return `Browser navigation failed: invalid URL "${url.substring(0, 100)}"`;
        }

        const p = await ensureBrowser();
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const title = await p.title();
        const text = await p.innerText('body').catch(() => '');
        const truncated = text.substring(0, 3000);
        return `Navigated to: ${url}\nTitle: ${title}\n\nPage content:\n${truncated}`;
    } catch (e: any) {
        return `Browser navigation failed: ${e.message}`;
    }
}

export async function browserGetText(): Promise<string> {
    try {
        const p = await ensureBrowser();
        const text = await p.innerText('body').catch(() => '');
        return text.substring(0, 3000);
    } catch (e: any) {
        return `Failed to get page text: ${e.message}`;
    }
}

export async function browserScreenshot(args: any): Promise<string> {
    try {
        // Validate path stays within sandbox (prevent path traversal)
        const requestedPath = String(args.path || 'screenshot.png');
        const resolvedPath = path.resolve(config.sandboxPath, requestedPath);
        const sandboxResolved = path.resolve(config.sandboxPath);

        if (!resolvedPath.startsWith(sandboxResolved + path.sep) && resolvedPath !== sandboxResolved) {
            return `Screenshot failed: path "${requestedPath}" escapes the sandbox directory. Use a simple filename like "screenshot.png".`;
        }

        // Ensure parent directory exists
        const parentDir = path.dirname(resolvedPath);
        if (!parentDir.startsWith(sandboxResolved)) {
            return `Screenshot failed: invalid path.`;
        }

        const p = await ensureBrowser();
        await p.screenshot({ path: resolvedPath, fullPage: false });
        return `Screenshot saved to /sandbox/${requestedPath}`;
    } catch (e: any) {
        return `Screenshot failed: ${e.message}`;
    }
}

export async function browserClick(args: any): Promise<string> {
    try {
        const p = await ensureBrowser();
        await p.click(args.selector, { timeout: 5000 });
        return `Clicked element: ${args.selector}`;
    } catch (e: any) {
        return `Click failed: ${e.message}`;
    }
}

export async function browserType(args: any): Promise<string> {
    try {
        const p = await ensureBrowser();
        await p.fill(args.selector, args.text, { timeout: 5000 });
        return `Typed "${args.text}" into: ${args.selector}`;
    } catch (e: any) {
        return `Type failed: ${e.message}`;
    }
}
