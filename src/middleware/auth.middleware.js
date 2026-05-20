const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const crypto = require('crypto');
const { verifyToken } = require('../utils/jwt');
const { AUTOMATION_SHARED_KEY } = require('../config/env');

const TRIAL_DAYS = 7;
const PAID_PLANS = new Set(['Rise', 'Elevate', 'Apex', 'Starter', 'Core', 'Pro', 'Scale']);

const ensureTrialAccess = async (user) => {
    if (!user || user.role !== 'user') {
        return { allowed: true };
    }

    const trialEndsAt = new Date(user.createdAt);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
    const trialExpired = new Date() > trialEndsAt;

    if (!trialExpired) {
        if (user.status === 'Suspended') {
            user.status = 'Active';
            await user.save();
        }
        return { allowed: true };
    }

    const hasPaidInvoice = Boolean(await Invoice.findOne({
        where: {
            userId: user.id,
            status: 'Paid'
        },
        attributes: ['id']
    }));

    const hasPaidPlan = PAID_PLANS.has(String(user.plan || ''));
    if (hasPaidInvoice || hasPaidPlan) {
        if (user.status === 'Suspended') {
            user.status = 'Active';
            await user.save();
        }
        return { allowed: true };
    }

    if (user.status !== 'Suspended') {
        user.status = 'Suspended';
        await user.save();
    }

    return {
        allowed: false,
        message: 'Your 7-day trial has ended. Please purchase a plan to continue.'
    };
};

const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, message: 'Authorization token is required' });
    }

    try {
        const decoded = verifyToken(token);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid token user' });
        }

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            plan: user.plan
        };
        req.authenticatedUser = user;

        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

const requireActiveSubscription = async (req, res, next) => {
    try {
        const user = req.authenticatedUser || (req.user?.id ? await User.findByPk(req.user.id) : null);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid token user' });
        }

        const trialAccess = await ensureTrialAccess(user);
        if (!trialAccess.allowed) {
            return res.status(402).json({ success: false, message: trialAccess.message });
        }

        req.authenticatedUser = user;
        return next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

const extractAuthUser = async (req) => {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return null;
    }

    const decoded = verifyToken(token);
    const user = await User.findByPk(decoded.id);
    if (!user) {
        return null;
    }

    const trialAccess = await ensureTrialAccess(user);
    if (!trialAccess.allowed) {
        const error = new Error(trialAccess.message || 'Trial expired');
        error.code = 'TRIAL_EXPIRED';
        throw error;
    }

    return {
        id: user.id,
        email: user.email,
        role: user.role
    };
};

const authenticateOptional = async (req, _res, next) => {
    try {
        const user = await extractAuthUser(req);
        if (user) {
            req.user = user;
        }
    } catch (_error) {
        // Keep optional auth non-blocking.
    }

    next();
};

const timingSafeCompare = (expectedValue, providedValue) => {
    const expected = Buffer.from(String(expectedValue || ''), 'utf8');
    const provided = Buffer.from(String(providedValue || ''), 'utf8');

    if (expected.length === 0 || expected.length !== provided.length) {
        return false;
    }

    return crypto.timingSafeEqual(expected, provided);
};

const authenticateOrAutomationKey = async (req, res, next) => {
    try {
        const user = await extractAuthUser(req);
        if (user) {
            req.user = user;
            return next();
        }
    } catch (error) {
        if (error?.code === 'TRIAL_EXPIRED') {
            return res.status(402).json({ success: false, message: error.message });
        }
        // Fall through to automation key validation.
    }

    const providedKey = req.headers['x-automation-key'];
    const authorizedAutomation = AUTOMATION_SHARED_KEY && timingSafeCompare(AUTOMATION_SHARED_KEY, providedKey || '');

    if (!authorizedAutomation) {
        return res.status(401).json({ success: false, message: 'Authorization token or automation key is required' });
    }

    req.automationAuthorized = true;
    return next();
};

module.exports = {
    authenticate,
    requireActiveSubscription,
    authenticateOptional,
    authenticateOrAutomationKey,
    verifyToken: authenticate
};
