const authService = require('../services/auth.service');
const { generateToken } = require('../utils/jwt');

exports.register = async (req, res) => {
    try {
        const {
            username,
            email,
            password,
            referralCode,
            referralMethod,
            businessName,
            inboundNumber,
            ownerPhone,
            timezone,
            billingAnniversaryDay
        } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'username, email and password are required' });
        }

        const user = await authService.register({
            username,
            email,
            password,
            referralCode,
            referralMethod,
            businessName,
            inboundNumber,
            ownerPhone,
            timezone,
            billingAnniversaryDay
        });

        const token = generateToken({ id: user.id, role: user.role, email: user.email });

        return res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                token,
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                plan: user.plan,
                inboundNumber: user.inboundNumber,
                ownerPhone: user.ownerPhone,
                timezone: user.timezone,
                billingAnniversaryDay: user.billingAnniversaryDay,
                twilioPhoneNumberSid: user.twilioPhoneNumberSid,
                retellAgentId: user.retellAgentId,
                provisioningStatus: user.provisioningStatus,
                provisioningError: user.provisioningError,
                referralCode: user.referralCode,
                referredByCode: user.referredByCode,
                referredByMethod: user.referredByMethod,
                referralBonusMinutes: user.referralBonusMinutes,
                referralBonusExpiresAt: user.referralBonusExpiresAt,
                trialEndsAt: user.createdAt
                    ? new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
                    : null
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.provisionBusinessNumber = async (req, res) => {
    try {
        const data = await authService.buySelectedBusinessNumber({
            actor: req.user,
            phoneNumber: req.body?.phoneNumber,
            country: req.body?.country,
            areaCode: req.body?.areaCode,
            customPrompt: req.body?.customPrompt,
            websiteUrl: req.body?.websiteUrl,
            autoAssign: req.body?.autoAssign,
            skipRetell: req.body?.skipRetell
        });
        return res.status(200).json({
            success: true,
            message: 'Business number provisioned successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to provision business number' });
    }
};

exports.importWebsiteKnowledgeBase = async (req, res) => {
    try {
        const data = await authService.importWebsiteKnowledgeBase({
            actor: req.user,
            websiteUrl: req.body?.websiteUrl
        });
        return res.status(200).json({
            success: true,
            message: 'Website knowledge imported successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to import website knowledge' });
    }
};

exports.getAvailableBusinessNumbers = async (req, res) => {
    try {
        const data = await authService.getAvailableBusinessNumbers({
            actor: req.user,
            country: req.query?.country,
            areaCode: req.query?.areaCode,
            contains: req.query?.contains,
            limit: req.query?.limit
        });

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to fetch available numbers' });
    }
};

exports.provisionRetellVoiceAgent = async (req, res) => {
    try {
        const data = await authService.provisionRetellVoiceAgent({
            actor: req.user,
            force: req.body?.force,
            customPrompt: req.body?.customPrompt
        });
        return res.status(200).json({
            success: true,
            message: 'Retell voice agent provisioned successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to provision Retell voice agent' });
    }
};

exports.generateRetellPrompt = async (req, res) => {
    try {
        const data = await authService.generateRetellPrompt({
            actor: req.user,
            businessName: req.body?.businessName,
            ownerName: req.body?.ownerName,
            ownerPhone: req.body?.ownerPhone,
            userInstructions: req.body?.userInstructions
        });

        return res.status(200).json({
            success: true,
            message: 'Retell prompt generated successfully',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to generate Retell prompt' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'email and password are required' });
        }

        const result = await authService.login(email, password);

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: result
        });
    } catch (error) {
        return res.status(401).json({ success: false, message: error.message });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'email is required' });
        }

        await authService.requestPasswordReset(email);

        return res.status(200).json({
            success: true,
            message: 'If an account exists for this email, a reset link has been sent.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to send reset email' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, token, password } = req.body;

        if (!email || !token || !password) {
            return res.status(400).json({ success: false, message: 'email, token and password are required' });
        }

        await authService.resetPassword({ email, token, password });

        return res.status(200).json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to reset password' });
    }
};
