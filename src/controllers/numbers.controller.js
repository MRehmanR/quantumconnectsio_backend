const demoNumberService = require('../services/demo-number.service');

exports.assignDemoNumber = async (req, res) => {
    try {
        const data = await demoNumberService.assignDemoNumber({
            userId: req.user?.id,
            region: req.body?.region,
            voicePreferences: req.body?.voicePreferences,
            ttlHours: req.body?.ttlHours
        });

        return res.status(200).json({
            success: true,
            message: 'Demo number assigned successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to assign demo number' });
    }
};

exports.promoteDemoNumber = async (req, res) => {
    try {
        const data = await demoNumberService.promoteDemoNumber({
            userId: req.user?.id,
            demoId: req.body?.demoId,
            paymentId: req.body?.paymentId
        });

        return res.status(200).json({
            success: true,
            message: 'Demo number promoted successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to promote demo number' });
    }
};

exports.getActiveDemoNumber = async (req, res) => {
    try {
        const data = await demoNumberService.getActiveDemoForUser(req.user?.id);
        return res.status(200).json({ success: true, data: data || null });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to fetch demo number' });
    }
};

exports.listDemoNumbers = async (_req, res) => {
    try {
        const data = await demoNumberService.listDemoNumbers();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch demo numbers' });
    }
};
