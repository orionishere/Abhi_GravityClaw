/**
 * tools/dashboard.ts
 *
 * Agent tool to manage the Gravity Claw file browser dashboard.
 * Actions: status, restart, url
 */

import { execFileSync } from 'child_process';

export const dashboardSchema = {
    type: 'function',
    function: {
        name: 'dashboard',
        description: 'Manage the Gravity Claw web file browser dashboard. Actions: "status" (check if running), "restart" (restart the service), "url" (get the access URL).',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['status', 'restart', 'url'],
                    description: 'The action to perform on the dashboard service',
                }
            },
            required: ['action'],
            additionalProperties: false,
        }
    }
};

export async function executeDashboard(args: { action: string }): Promise<string> {
    const DASHBOARD_URL = 'http://100.86.164.51:3000';

    switch (args.action) {
        case 'url':
            return `Dashboard URL: ${DASHBOARD_URL}\nAccessible from any device on your Tailscale network.`;

        case 'status': {
            try {
                const output = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000 });
                const processes = JSON.parse(output);
                const dashboard = processes.find((p: any) => p.name === 'gravity-dashboard');
                if (!dashboard) return 'Dashboard is not registered in PM2. It may need to be started manually.';
                const status = dashboard.pm2_env?.status || 'unknown';
                const uptime = dashboard.pm2_env?.pm_uptime
                    ? Math.round((Date.now() - dashboard.pm2_env.pm_uptime) / 60000) + ' minutes'
                    : 'unknown';
                const restarts = dashboard.pm2_env?.restart_time || 0;
                return `Dashboard status: ${status}\nUptime: ${uptime}\nRestarts: ${restarts}\nURL: ${DASHBOARD_URL}`;
            } catch (e: any) {
                return `Failed to check dashboard status: ${e.message}`;
            }
        }

        case 'restart': {
            try {
                execFileSync('pm2', ['restart', 'gravity-dashboard'], { encoding: 'utf8', timeout: 15000 });
                return `Dashboard restarted successfully.\nURL: ${DASHBOARD_URL}`;
            } catch (e: any) {
                return `Failed to restart dashboard: ${e.message}`;
            }
        }

        default:
            return `Unknown action: ${args.action}. Use "status", "restart", or "url".`;
    }
}
