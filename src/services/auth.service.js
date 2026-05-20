const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const User = require('../models/user.model');
const Invoice = require('../models/invoice.model');
const { generateToken } = require('../utils/jwt');
const provisioningService = require('./provisioning.service');
const { normalizePhone } = require('../utils/phone');

const generateReferralCode = (username) => {
    const normalized = String(username || 'user')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 5)
        .padEnd(5, 'X');
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${normalized}${suffix}`;
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
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [{ email: userData.email }, { username: userData.username }]
            },
            attributes: ['id']
        });

        if (existingUser) {
            throw new Error('Email or username already exists');
        }

        const hashedPassword = await bcrypt.hash(userData.password, 10);

        let referralCode = generateReferralCode(userData.username);
        while (await User.findOne({ where: { referralCode }, attributes: ['id'] })) {
            referralCode = generateReferralCode(userData.username);
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

        const user = await User.create({
            
            username: userData.username,
            email: userData.email,
            password: hashedPassword,
            role: 'user',
            businessName: userData.businessName || '',
            inboundNumber: userData.inboundNumber || null,
            ownerPhone: (() => {
                const normalized = normalizePhone(userData.ownerPhone || '', {});
                if (!normalized.ok && userData.ownerPhone) {
                    throw new Error(normalized.reason);
                }
                return normalized.e164 || '';
            })(),
            timezone: userData.timezone || 'UTC',
            billingAnniversaryDay: Number(userData.billingAnniversaryDay || new Date().getDate()),
            referralCode,
            referredByCode,
            referredByMethod
        });

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

    login: async (email, password) => {
        const user = await User.unscoped().findOne({ where: { email } });
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
