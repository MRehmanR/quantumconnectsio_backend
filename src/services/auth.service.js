const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const { generateToken } = require('../utils/jwt');
const provisioningService = require('./provisioning.service');
const demoNumberService = require('./demo-number.service');
const { normalizePhone, getCountryHintFromE164 } = require('../utils/phone');
const { resolveCountryFromPayload, normalizeCountryCode } = require('../utils/country');
const { FRONTEND_APP_URL, RESET_PASSWORD_TOKEN_TTL_MIN } = require('../config/env');
const { sendPasswordResetEmail } = require('../utils/email');

const generateReferralCode = (username) => {
    const normalized = String(username || 'user')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 5)
        .padEnd(5, 'X');
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${normalized}${suffix}`;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const normalizeUsername = (username) =>
    String(username || 'User')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 50) || 'User';

const getUniqueUsername = async (requestedUsername) => {
    const base = normalizeUsername(requestedUsername);
    const existing = await User.findOne({ where: { username: base }, attributes: ['id'] });
    if (!existing) {
        return base;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const candidate = `${base.slice(0, 45)} ${suffix}`.slice(0, 50);
        const taken = await User.findOne({ where: { username: candidate }, attributes: ['id'] });
        if (!taken) {
            return candidate;
        }
    }

    return `${base.slice(0, 36)} ${Date.now().toString().slice(-10)}`.slice(0, 50);
};

const TRIAL_DAYS = 7;
const PAID_PLANS = new Set(['Rise', 'Elevate', 'Apex', 'Starter', 'Core', 'Pro', 'Scale']);

const getTrialInfo = async (user) => {
    const createdAt = new Date(user.createdAt);
    const trialEndsAt = new Date(createdAt);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    const now = new Date();
    const hasPaidInvoice = Boolean(await Invoice.findOne({
        where: {
            userId: user.id,
            status: 'Paid'
        },
        attributes: ['id']
    }));

    const hasPaidPlan = PAID_PLANS.has(String(user.plan || ''));
    const trialExpired = now > trialEndsAt;

    return {
        hasPaidInvoice,
        hasPaidPlan,
        trialExpired,
        trialEndsAt
    };
};

const authService = {
    register: async (userData) => {
        const email = normalizeEmail(userData.email);
        const username = await getUniqueUsername(userData.username);

        const existingEmail = await User.findOne({
            where: { email },
            attributes: ['id']
        });

        if (existingEmail) {
            const duplicateEmailError = new Error('Email already exists. Please log in or use another email.');
            duplicateEmailError.code = 'EMAIL_ALREADY_EXISTS';
            throw duplicateEmailError;
        }

        const hashedPassword = await bcrypt.hash(userData.password, 10);

        let referralCode = generateReferralCode(username);
        while (await User.findOne({ where: { referralCode }, attributes: ['id'] })) {
            referralCode = generateReferralCode(username);
        }

        let referredByCode = '';
        let referredByMethod = '';
        if (userData.referralCode) {
            const referrer = await User.findOne({ where: { referralCode: userData.referralCode }, attributes: ['id', 'referralCode'] });
            if (referrer) {
                referredByCode = referrer.referralCode;
                referredByMethod = userData.referralMethod === 'link' ? 'link' : 'code';
            }
        }

        const normalizedOwnerPhone = normalizePhone(userData.ownerPhone || '', {});
        if (!normalizedOwnerPhone.ok && userData.ownerPhone) {
            throw new Error(normalizedOwnerPhone.reason);
        }
        const countryCode = normalizeCountryCode(
            resolveCountryFromPayload(userData) || getCountryHintFromE164(normalizedOwnerPhone.e164)
        );
        const requestedInboundNumber = String(userData.inboundNumber || '').trim();

        if (requestedInboundNumber) {
            const numberOwner = await User.findOne({
                where: { inboundNumber: requestedInboundNumber },
                attributes: ['id', 'email']
            });
            if (numberOwner) {
                throw new Error(`This number is already assigned to another business account (${numberOwner.email}).`);
            }
        }

        const user = await User.create({
            
            username,
            email,
            password: hashedPassword,
            role: 'user',
            businessName: userData.businessName || '',
            inboundNumber: requestedInboundNumber || null,
            ownerPhone: normalizedOwnerPhone.e164 || '',
            timezone: userData.timezone || 'UTC',
            countryCode,
            billingAnniversaryDay: Number(userData.billingAnniversaryDay || new Date().getDate()),
            referralCode,
            referredByCode,
            referredByMethod
        });

        if (!user.inboundNumber) {
            try {
                await demoNumberService.assignDemoNumber({
                    userId: user.id,
                    region: countryCode || undefined
                });
                await user.reload();
            } catch (error) {
                user.provisioningStatus = 'pending';
                user.provisioningError = String(error?.message || 'Demo number assignment failed').slice(0, 240);
                await user.save();
            }
        }

        if (user.inboundNumber && !user.retellAgentId) {
            try {
                await provisioningService.provisionRetellAgentForUser(user.id);
                await user.reload();
            } catch (error) {
                await user.reload();
                if (!user.provisioningError) {
                    user.provisioningStatus = 'manual_required';
                    user.provisioningError = String(error?.message || 'Demo voice agent assignment failed').slice(0, 240);
                    await user.save();
                }
            }
        }

        return user;
    },

    provisionBusinessNumber: async ({ actor }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can provision business numbers');
        }

        const provisioned = await provisioningService.provisionForUser(user.id);

        const freshUser = await User.findByPk(user.id);

        if (!freshUser?.inboundNumber) {
            throw new Error('Twilio number could not be provisioned. Please verify Twilio credentials and try again.');
        }

        return {
            ...provisioned,
            provisioningError: freshUser?.provisioningError || ''
        };
    },

    getAvailableBusinessNumbers: async ({ actor, country, areaCode, contains, limit }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can browse business numbers');
        }

        const numbers = await provisioningService.listAvailableNumbersForUser({
            userId: user.id,
            country,
            areaCode,
            contains,
            limit: Math.max(1, Math.min(Number(limit || 10), 20))
        });

        return numbers;
    },

    buySelectedBusinessNumber: async ({ actor, phoneNumber, country, areaCode, customPrompt, websiteUrl, autoAssign, skipRetell }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can provision business numbers');
        }

        const provisioned = await provisioningService.provisionForUser(user.id, {
            phoneNumber,
            country,
            areaCode,
            customPrompt,
            websiteUrl,
            autoAssign: Boolean(autoAssign),
            skipRetell: Boolean(skipRetell)
        });

        const freshUser = await User.findByPk(user.id);

        if (!freshUser?.inboundNumber) {
            throw new Error('Twilio number could not be provisioned. Please verify Twilio credentials and try again.');
        }

        return {
            ...provisioned,
            provisioningError: freshUser?.provisioningError || ''
        };
    },

    importWebsiteKnowledgeBase: async ({ actor, websiteUrl }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can import website knowledge');
        }

        return provisioningService.importWebsiteKnowledgeBaseForUser(user.id, {
            websiteUrl
        });
    },

    provisionRetellVoiceAgent: async ({ actor, force, customPrompt }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can provision Retell voice agent');
        }

        const provisioned = await provisioningService.provisionRetellAgentForUser(user.id, {
            force: Boolean(force),
            customPrompt
        });

        const freshUser = await User.findByPk(user.id);

        return {
            ...provisioned,
            provisioningError: freshUser?.provisioningError || ''
        };
    },

    generateRetellPrompt: async ({ actor, businessName, ownerName, ownerPhone, userInstructions }) => {
        if (!actor?.id) {
            throw new Error('Unauthorized');
        }

        const user = await User.findByPk(actor.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.role !== 'user') {
            throw new Error('Only client users can generate Retell prompts');
        }

        const data = await provisioningService.generateRetellPromptForUser(user.id, {
            businessName,
            ownerName,
            ownerPhone,
            userInstructions
        });

        return data;
    },

    requestPasswordReset: async (email) => {
        const normalizedEmail = normalizeEmail(email);
        const user = await User.unscoped().findOne({ where: { email: normalizedEmail } });
        if (!user) {
            const error = new Error('Account not found with this email');
            error.code = 'ACCOUNT_NOT_FOUND';
            throw error;
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + RESET_PASSWORD_TOKEN_TTL_MIN * 60 * 1000);

        user.resetPasswordTokenHash = tokenHash;
        user.resetPasswordExpiresAt = expiresAt;
        await user.save();

        const resetUrl = `${FRONTEND_APP_URL}/reset-password?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;
        await sendPasswordResetEmail({ to: normalizedEmail, resetUrl });

        return { sent: true, delivery: 'email' };
    },

    resetPassword: async ({ email, token, password }) => {
        if (!password || String(password).length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }

        const user = await User.unscoped().findOne({ where: { email: normalizeEmail(email) } });
        if (!user || !user.resetPasswordTokenHash || !user.resetPasswordExpiresAt) {
            throw new Error('Invalid or expired reset link');
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        if (tokenHash !== user.resetPasswordTokenHash || new Date() > new Date(user.resetPasswordExpiresAt)) {
            throw new Error('Invalid or expired reset link');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        user.resetPasswordTokenHash = null;
        user.resetPasswordExpiresAt = null;
        await user.save();

        return { reset: true };
    },

    login: async (email, password) => {
        const user = await User.unscoped().findOne({ where: { email: normalizeEmail(email) } });
        if (!user) {
            throw new Error('Invalid credentials');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Invalid credentials');
        }

        if (user.role === 'user') {
            const trialInfo = await getTrialInfo(user);
            if (trialInfo.trialExpired && !trialInfo.hasPaidInvoice && !trialInfo.hasPaidPlan) {
                if (user.status !== 'Suspended') {
                    user.status = 'Suspended';
                    await user.save();
                }
            } else if (user.status === 'Suspended') {
                user.status = 'Active';
                await user.save();
            }
        }

        const token = generateToken({ id: user.id, role: user.role, email: user.email });

        const trialInfo = user.role === 'user'
            ? await getTrialInfo(user)
            : { hasPaidInvoice: false, hasPaidPlan: false, trialExpired: false, trialEndsAt: null };

        return {
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                plan: user.plan,
                status: user.status,
                businessName: user.businessName,
                inboundNumber: user.inboundNumber,
                ownerPhone: user.ownerPhone,
                timezone: user.timezone,
                countryCode: user.countryCode,
                twilioPhoneNumberSid: user.twilioPhoneNumberSid,
                retellAgentId: user.retellAgentId,
                provisioningStatus: user.provisioningStatus,
                provisioningError: user.provisioningError,
                referralCode: user.referralCode,
                referralBonusMinutes: user.referralBonusMinutes,
                referralBonusExpiresAt: user.referralBonusExpiresAt,
                trialEndsAt: trialInfo.trialEndsAt ? trialInfo.trialEndsAt.toISOString() : null,
                trialExpired: Boolean(trialInfo.trialExpired)
            }
        };
    }
};

module.exports = authService;
