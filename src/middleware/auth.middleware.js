const User = require('../models/user.model');
const crypto = require('crypto');
const { verifyToken } = require('../utils/jwt');
const { AUTOMATION_SHARED_KEY } = require('../config/env');

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
    } catch (_error) {
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
