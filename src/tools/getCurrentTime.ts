/**
 * Tool to get the current local time.
 */

export const getCurrentTimeTool = {
    type: 'function',
    function: {
        name: 'get_current_time',
        description: 'Get the current local time. Useful when you need to know what time or date it is.',
        parameters: {
            type: 'object',
            properties: {},
        },
    }
};

export async function executeGetCurrentTime(): Promise<string> {
    const now = new Date();
    // Return ISO string or formatted string
    return now.toISOString();
}
