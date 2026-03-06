import { chromium, Browser, Page } from 'playwright';
import { config } from '../config.js';

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureBrowser(): Promise<Page> {
    if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
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
        const p = await ensureBrowser();
        await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const title = await p.title();
        // Return a truncated version of the text to fit in context
        const text = await p.innerText('body').catch(() => '');
        const truncated = text.substring(0, 3000);
        return `Navigated to: ${args.url}\nTitle: ${title}\n\nPage content:\n${truncated}`;
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
        const p = await ensureBrowser();
        const savePath = `${config.sandboxPath}/${args.path}`;
        await p.screenshot({ path: savePath, fullPage: false });
        return `Screenshot saved to /sandbox/${args.path}`;
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
