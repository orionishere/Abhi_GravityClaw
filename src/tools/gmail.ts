import imaps from 'imap-simple';
import { config } from '../config.js';

// --- Tool Schemas ---

export const gmailSearchSchema = {
    type: 'function',
    function: {
        name: 'gmail_search',
        description: 'Search Gmail inbox for emails matching a query. Returns the count and a summary of the most recent matches. Supports IMAP search criteria like FROM, SUBJECT, SINCE, etc.',
        parameters: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                    description: 'Filter by sender email address (e.g., "newsletter@example.com")'
                },
                subject: {
                    type: 'string',
                    description: 'Filter by subject text (e.g., "weekly report")'
                },
                since: {
                    type: 'string',
                    description: 'Filter emails since a date in DD-Mon-YYYY format (e.g., "01-Jan-2025")'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of email summaries to return (default: 10)'
                }
            },
            additionalProperties: false
        }
    }
};

export const gmailReadSchema = {
    type: 'function',
    function: {
        name: 'gmail_read',
        description: 'Read the full body text of a specific email by its sequence number (as returned by gmail_search).',
        parameters: {
            type: 'object',
            properties: {
                seqno: {
                    type: 'number',
                    description: 'The sequence number of the email to read'
                }
            },
            required: ['seqno'],
            additionalProperties: false
        }
    }
};

// --- Helpers ---

async function getImapConnection() {
    const imapConfig = {
        imap: {
            user: process.env.GMAIL_USER || '',
            password: process.env.GMAIL_APP_PASSWORD || '',
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    if (!imapConfig.imap.user || !imapConfig.imap.password) {
        throw new Error('Gmail credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
    }

    return await imaps.connect(imapConfig);
}

// --- Tool Executors ---

export async function gmailSearch(args: any): Promise<string> {
    let connection;
    try {
        connection = await getImapConnection();
        await connection.openBox('INBOX');

        // Build IMAP search criteria
        const criteria: any[] = [];
        if (args.from) criteria.push(['FROM', args.from]);
        if (args.subject) criteria.push(['SUBJECT', args.subject]);
        if (args.since) criteria.push(['SINCE', args.since]);
        if (criteria.length === 0) criteria.push('ALL');

        const searchResults = await connection.search(criteria, {
            bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'],
            struct: true
        });

        const maxResults = args.maxResults || 10;
        const total = searchResults.length;
        const recent = searchResults.slice(-maxResults);

        let output = `Found ${total} emails matching your search.\n\n`;

        if (total > 0) {
            output += `Showing the ${recent.length} most recent:\n\n`;
            for (const msg of recent.reverse()) {
                const header = msg.parts.find((p: any) => p.which === 'HEADER.FIELDS (FROM SUBJECT DATE)');
                if (header) {
                    const headerText = header.body;
                    output += `#${msg.attributes.uid} | From: ${(headerText.from || ['unknown'])[0]} | Subject: ${(headerText.subject || ['(no subject)'])[0]} | Date: ${(headerText.date || ['unknown'])[0]}\n`;
                }
            }
        }

        connection.end();
        return output;
    } catch (e: any) {
        if (connection) connection.end();
        return `Gmail search failed: ${e.message}`;
    }
}

export async function gmailRead(args: any): Promise<string> {
    let connection;
    try {
        connection = await getImapConnection();
        await connection.openBox('INBOX');

        const searchResults = await connection.search([['UID', String(args.seqno)]], {
            bodies: ['TEXT', 'HEADER.FIELDS (FROM SUBJECT DATE)'],
            struct: true
        });

        if (searchResults.length === 0) {
            connection.end();
            return `No email found with UID ${args.seqno}`;
        }

        const msg = searchResults[0];
        const header = msg.parts.find((p: any) => p.which === 'HEADER.FIELDS (FROM SUBJECT DATE)');
        const body = msg.parts.find((p: any) => p.which === 'TEXT');

        let output = '';
        if (header) {
            const h = header.body;
            output += `From: ${(h.from || ['unknown'])[0]}\nSubject: ${(h.subject || ['(no subject)'])[0]}\nDate: ${(h.date || ['unknown'])[0]}\n\n`;
        }
        if (body) {
            // Truncate body to 4000 chars
            output += body.body.substring(0, 4000);
        }

        connection.end();
        return output;
    } catch (e: any) {
        if (connection) connection.end();
        return `Gmail read failed: ${e.message}`;
    }
}
