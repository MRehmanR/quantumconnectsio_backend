const { Op } = require('sequelize');
const { DemoNumber, User } = require('../models');
const { sequelize } = require('../config/db');
const { DEMO_NUMBER_TTL_HOURS } = require('../config/env');
const { normalizeCountryCode } = require('../utils/country');

const DEFAULT_TTL_HOURS = Number(DEMO_NUMBER_TTL_HOURS || 72);

const toExpiryDate = (hours) => {
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + safeHours);
    return expiresAt;
};

const normalizeMetadata = (value) => {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return value;
};

const resolveDemoCountryCode = (demoNumber) => {
    const direct = normalizeCountryCode(demoNumber?.countryCode);
    if (direct) {
        return direct;
    }

    const metadata = normalizeMetadata(demoNumber?.metadata);
    const metaCountry = normalizeCountryCode(metadata.countryCode || metadata.country || metadata.region || '');
    return metaCountry;
};

const getActiveDemoForUser = async (userId, transaction) => {
    if (!userId) {
        return null;
    }

    return DemoNumber.findOne({
        where: {
            assignedToUserId: userId,
            status: {
                [Op.in]: ['assigned', 'promoted']
            }
        },
        transaction
    });
};

const isNumberAssignedToAnotherUser = async ({ userId, phoneNumber, transaction }) => {
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    if (!normalizedPhoneNumber) {
        return false;
    }

    const existingUser = await User.findOne({
        where: {
            inboundNumber: normalizedPhoneNumber,
            id: {
                [Op.ne]: userId
            }
        },
        attributes: ['id'],
        transaction
    });

    return Boolean(existingUser);
};

const assignDemoNumber = async ({ userId, region, voicePreferences, ttlHours }) => {
    if (!userId) {
        throw new Error('Unauthorized');
    }

    return sequelize.transaction(async (transaction) => {
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
            throw new Error('User not found');
        }

        const existingDemo = await getActiveDemoForUser(userId, transaction);
        if (existingDemo) {
            if (user.inboundNumber !== existingDemo.phoneNumber) {
                user.inboundNumber = existingDemo.phoneNumber;
                user.twilioPhoneNumberSid = existingDemo.providerNumberId || '';
                user.provisioningStatus = 'active';
                await user.save({ transaction });
            }

            return {
                demoId: existingDemo.id,
                phoneNumber: existingDemo.phoneNumber,
                expiresAt: existingDemo.expiresAt,
                status: existingDemo.status,
                provider: existingDemo.provider,
                providerNumberId: existingDemo.providerNumberId || ''
            };
        }

        if (user.inboundNumber) {
            throw new Error('This account already has a business number assigned.');
        }

        const requestedCountry = normalizeCountryCode(region || user.countryCode);
        const candidates = await DemoNumber.findAll({
            where: { status: 'available' },
            order: [['id', 'ASC']],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        let demoNumber = null;
        for (const candidate of candidates) {
            if (requestedCountry && resolveDemoCountryCode(candidate) !== requestedCountry) {
                continue;
            }

            const alreadyAssigned = await isNumberAssignedToAnotherUser({
                userId: user.id,
                phoneNumber: candidate.phoneNumber,
                transaction
            });

            if (!alreadyAssigned) {
                demoNumber = candidate;
                break;
            }
        }

        if (!demoNumber) {
            if (requestedCountry) {
                throw new Error(`No demo numbers are available for ${requestedCountry}. Please contact support.`);
            }
            throw new Error('No demo numbers are available right now. Please contact support.');
        }

        const expiresAt = toExpiryDate(ttlHours);
        const metadata = {
            ...normalizeMetadata(demoNumber.metadata),
            lastAssignedAt: new Date().toISOString(),
            lastAssignedTo: user.id,
            countryCode: requestedCountry || undefined,
            region: region || undefined,
            voicePreferences: voicePreferences || undefined
        };

        demoNumber.status = 'assigned';
        demoNumber.assignedToUserId = user.id;
        demoNumber.assignedAt = new Date();
        demoNumber.expiresAt = expiresAt;
        demoNumber.metadata = metadata;
        if (requestedCountry && !demoNumber.countryCode) {
            demoNumber.countryCode = requestedCountry;
        }
        await demoNumber.save({ transaction });

        user.inboundNumber = demoNumber.phoneNumber;
        user.twilioPhoneNumberSid = demoNumber.providerNumberId || '';
        user.provisioningStatus = 'active';
        user.provisioningError = '';
        await user.save({ transaction });

        return {
            demoId: demoNumber.id,
            phoneNumber: demoNumber.phoneNumber,
            expiresAt: demoNumber.expiresAt,
            status: demoNumber.status,
            provider: demoNumber.provider,
            providerNumberId: demoNumber.providerNumberId || ''
        };
    });
};

const promoteDemoNumber = async ({ userId, demoId, paymentId }) => {
    if (!userId) {
        throw new Error('Unauthorized');
    }

    return sequelize.transaction(async (transaction) => {
        const demoNumber = await DemoNumber.findOne({
            where: {
                id: demoId,
                assignedToUserId: userId,
                status: {
                    [Op.in]: ['assigned', 'promoted']
                }
            },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (!demoNumber) {
            throw new Error('Demo number not found for this account.');
        }

        if (demoNumber.status !== 'promoted') {
            demoNumber.status = 'promoted';
            demoNumber.expiresAt = null;
            demoNumber.metadata = {
                ...normalizeMetadata(demoNumber.metadata),
                promotedAt: new Date().toISOString(),
                paymentId: paymentId || undefined
            };
            await demoNumber.save({ transaction });
        }

        const user = await User.findByPk(userId, { transaction });
        if (user) {
            user.inboundNumber = demoNumber.phoneNumber;
            user.twilioPhoneNumberSid = demoNumber.providerNumberId || '';
            user.provisioningStatus = 'active';
            user.provisioningError = '';
            await user.save({ transaction });
        }

        return {
            demoId: demoNumber.id,
            phoneNumber: demoNumber.phoneNumber,
            status: demoNumber.status,
            provider: demoNumber.provider,
            providerNumberId: demoNumber.providerNumberId || ''
        };
    });
};

const releaseAssignedDemoForUser = async ({ userId, transaction }) => {
    if (!userId) {
        return null;
    }

    const demoNumber = await DemoNumber.findOne({
        where: {
            assignedToUserId: userId,
            status: 'assigned'
        },
        lock: transaction?.LOCK?.UPDATE,
        transaction
    });

    if (!demoNumber) {
        return null;
    }

    demoNumber.status = 'available';
    demoNumber.assignedToUserId = null;
    demoNumber.assignedAt = null;
    demoNumber.expiresAt = null;
    demoNumber.metadata = {
        ...normalizeMetadata(demoNumber.metadata),
        releasedAt: new Date().toISOString(),
        releasedFromUserId: userId
    };
    await demoNumber.save({ transaction });
    return demoNumber;
};

const listDemoNumbers = async () => {
    return DemoNumber.findAll({ order: [['status', 'ASC'], ['id', 'ASC']] });
};

const reclaimExpiredDemoNumbers = async () => {
    const now = new Date();

    return sequelize.transaction(async (transaction) => {
        const expired = await DemoNumber.findAll({
            where: {
                status: 'assigned',
                expiresAt: {
                    [Op.lte]: now
                }
            },
            transaction
        });

        if (expired.length === 0) {
            return { reclaimed: 0 };
        }

        const demoIds = expired.map((item) => item.id);
        const demoNumbers = expired.map((item) => item.phoneNumber);

        await DemoNumber.update(
            {
                status: 'available',
                assignedToUserId: null,
                assignedAt: null,
                expiresAt: null
            },
            {
                where: { id: { [Op.in]: demoIds } },
                transaction
            }
        );

        const users = await User.findAll({
            where: { inboundNumber: { [Op.in]: demoNumbers } },
            transaction
        });

        for (const user of users) {
            user.inboundNumber = null;
            user.provisioningStatus = 'pending';
            user.provisioningError = 'Demo number expired';
            await user.save({ transaction });
        }

        return { reclaimed: expired.length };
    });
};

module.exports = {
    assignDemoNumber,
    promoteDemoNumber,
    releaseAssignedDemoForUser,
    listDemoNumbers,
    getActiveDemoForUser,
    reclaimExpiredDemoNumbers
};
