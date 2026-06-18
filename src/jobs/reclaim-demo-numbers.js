const demoNumberService = require('../services/demo-number.service');

const runReclaimDemoNumbers = async () => {
    try {
        const result = await demoNumberService.reclaimExpiredDemoNumbers();
        if (result.reclaimed > 0) {
            console.log(`Reclaimed ${result.reclaimed} expired demo numbers.`);
        }
    } catch (error) {
        console.error('Failed to reclaim demo numbers:', error);
    }
};

module.exports = {
    runReclaimDemoNumbers
};
