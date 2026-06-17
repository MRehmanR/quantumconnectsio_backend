const app = require('./app');
const { PORT, DEMO_NUMBER_RECLAIM_INTERVAL_MIN } = require('./config/env');
const { runReclaimDemoNumbers } = require('./jobs/reclaim-demo-numbers');

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    const intervalMinutes = Number(DEMO_NUMBER_RECLAIM_INTERVAL_MIN || 15);
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    runReclaimDemoNumbers();
    setInterval(runReclaimDemoNumbers, intervalMs);
});