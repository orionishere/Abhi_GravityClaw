/**
 * Standalone entry point for the dashboard.
 * Run with: npx tsx src/dashboard/index.ts
 * Or via PM2: pm2 start ecosystem.config.cjs --only gravity-dashboard
 */
import { startDashboard } from './server.js';

startDashboard().catch(err => {
    console.error('[Dashboard] Failed to start:', err);
    process.exit(1);
});
