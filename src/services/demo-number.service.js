const https = require('https');
const { URL } = require('url');
const { Op } = require('sequelize');
const { DemoNumber, User } = require('../models');
const { sequelize } = require('../config/db');
const {
    DEMO_NUMBER_TTL_HOURS,
    DEMO_NUMBERS,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_DEMO_SYNC_ENABLED,
    TWILIO_DEMO_SYNC_COUNTRIES,
    TWILIO_DEMO_MIN_IDLE_DAYS,
    TWILIO_DEMO_IMPORT_LIMIT
} = require('../config/env');
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

const parseDemoNumberEntry = (entry) => {
    const parts = String(entry || '')
        .split('|')
        .map((part) => part.trim());
    const [phoneNumber, providerNumberId = '', countryCode = '', label = ''] = parts;

    if (!phoneNumber) {
        return null;
    }

    return {
        phoneNumber,
        providerNumberId,
        countryCode: normalizeCountryCode(countryCode),
        label
    };
};

const parseDemoNumbersFromEnv = () =>
    String(DEMO_NUMBERS || '')
        .split(',')
        .map(parseDemoNumberEntry)
        .filter(Boolean);

const twilioEnabled = () => Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);

const toYmd = (date) => date.toISOString().slice(0, 10);

const requestTwilioJson = ({ url }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request(
            {
                method: 'GET',
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || 443,
                headers: {
                    Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
                    Accept: 'application/json'
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    let parsedBody = null;
                    try {
                        parsedBody = data ? JSON.parse(data) : null;
                    } catch (_error) {
                        parsedBody = data || null;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody || {});
                    } else {
                        reject(
                            new Error(
                                `Twilio ${res.statusCode} ${res.statusMessage || ''} ${
                                    typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody || {})
                                }`
                            )
                        );
                    }
                });
            }
        );

        req.on('error', reject);
        req.end();
    });

const getAllowedTwilioDemoCountries = () =>
    String(TWILIO_DEMO_SYNC_COUNTRIES || '')
        .split(',')
        .map(normalizeCountryCode)
        .filter(Boolean);

const listOwnedTwilioNumbers = async ({ limit }) => {
    if (!twilioEnabled()) {
        return [];
    }

    const safeLimit = Math.max(1, Math.min(Number(limit || TWILIO_DEMO_IMPORT_LIMIT || 50), 100));
    const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/IncomingPhoneNumbers.json`;
    const response = await requestTwilioJson({
        url: `${baseUrl}?PageSize=${safeLimit}`
    });

    return Array.isArray(response?.incoming_phone_numbers) ? response.incoming_phone_numbers : [];
};

const hasRecentInboundTwilioCalls = async ({ phoneNumber, minIdleDays }) => {
    if (!twilioEnabled() || !phoneNumber) {
        return true;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, Number(minIdleDays || TWILIO_DEMO_MIN_IDLE_DAYS || 30)));

    const params = new URLSearchParams({
        To: phoneNumber,
        'StartTime>': toYmd(cutoff),
        PageSize: '1'
    });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json?${params.toString()}`;
    const response = await requestTwilioJson({ url });
    return Array.isArray(response?.calls) && response.calls.length > 0;
};

const numberExistsOnAnyUser = async (phoneNumber) => {
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    if (!normalizedPhoneNumber) {
        return false;
    }

    const existingUser = await User.findOne({
        where: { inboundNumber: normalizedPhoneNumber },
        attributes: ['id']
    });

    return Boolean(existingUser);
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

const getDemoNumberPriority = (demoNumber) => {
    const metadata = normalizeMetadata(demoNumber?.metadata);
    if (metadata.seededFromEnv) {
        return 1;
    }
    if (metadata.importedFromTwilio) {
        return 2;
    }
    if (metadata.purchasedForDemo) {
        return 3;
    }
    return 4;
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

const findAvailableDemoNumberForUser = async ({ user, requestedCountry, transaction }) => {
    const candidates = await DemoNumber.findAll({
        where: { status: 'available' },
        order: [['id', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });

    const prioritized = candidates.sort((a, b) => {
        const priorityDelta = getDemoNumberPriority(a) - getDemoNumberPriority(b);
        if (priorityDelta !== 0) {
            return priorityDelta;
        }
        return Number(a.id || 0) - Number(b.id || 0);
    });

    for (const candidate of prioritized) {
        if (requestedCountry && resolveDemoCountryCode(candidate) !== requestedCountry) {
            continue;
        }

        const alreadyAssigned = await isNumberAssignedToAnotherUser({
            userId: user.id,
            phoneNumber: candidate.phoneNumber,
            transaction
        });

        if (!alreadyAssigned) {
            return candidate;
        }
    }

    return null;
};

const attachDemoNumberToUser = async ({ user, demoNumber, requestedCountry, region, voicePreferences, ttlHours, transaction }) => {
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
};

const assignExistingDemoNumber = async ({ userId, region, voicePreferences, ttlHours }) =>
    sequelize.transaction(async (transaction) => {
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
        const demoNumber = await findAvailableDemoNumberForUser({
            user,
            requestedCountry,
            transaction
        });

        if (!demoNumber) {
            return null;
        }

        return attachDemoNumberToUser({
            user,
            demoNumber,
            requestedCountry,
            region,
            voicePreferences,
            ttlHours,
            transaction
        });
    });

const purchaseDemoNumberForUser = async ({ userId, region, voicePreferences, ttlHours }) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.inboundNumber) {
        throw new Error('This account already has a business number assigned.');
    }

    const requestedCountry = normalizeCountryCode(region || user.countryCode);
    const provisioningService = require('./provisioning.service');
    const purchase = await provisioningService.purchaseTwilioNumber({
        country: requestedCountry || undefined
    });

    if (!purchase?.phoneNumber) {
        throw new Error('Twilio did not return a purchased demo number.');
    }

    return sequelize.transaction(async (transaction) => {
        const lockedUser = await User.findByPk(userId, {
            lock: transaction.LOCK.UPDATE,
            transaction
        });
        if (!lockedUser) {
            throw new Error('User not found');
        }
        if (lockedUser.inboundNumber) {
            throw new Error('This account already has a business number assigned.');
        }

        const duplicateUser = await isNumberAssignedToAnotherUser({
            userId: lockedUser.id,
            phoneNumber: purchase.phoneNumber,
            transaction
        });
        if (duplicateUser) {
            throw new Error('Purchased Twilio number is already assigned to another user.');
        }

        const [demoNumber, created] = await DemoNumber.findOrCreate({
            where: { phoneNumber: purchase.phoneNumber },
            defaults: {
                phoneNumber: purchase.phoneNumber,
                providerNumberId: purchase.phoneSid || '',
                countryCode: requestedCountry || '',
                status: 'available',
                metadata: {
                    purchasedForDemo: true,
                    purchasedAt: new Date().toISOString()
                }
            },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (!created && demoNumber.status !== 'available') {
            throw new Error('Purchased Twilio number is not available for demo assignment.');
        }

        demoNumber.providerNumberId = purchase.phoneSid || demoNumber.providerNumberId || '';
        demoNumber.countryCode = requestedCountry || demoNumber.countryCode || '';
        demoNumber.metadata = {
            ...normalizeMetadata(demoNumber.metadata),
            purchasedForDemo: true,
            purchasedAt: normalizeMetadata(demoNumber.metadata).purchasedAt || new Date().toISOString()
        };

        return attachDemoNumberToUser({
            user: lockedUser,
            demoNumber,
            requestedCountry,
            region,
            voicePreferences,
            ttlHours,
            transaction
        });
    });
};

const assignDemoNumber = async ({ userId, region, voicePreferences, ttlHours }) => {
    if (!userId) {
        throw new Error('Unauthorized');
    }

    const existingAssignment = await assignExistingDemoNumber({ userId, region, voicePreferences, ttlHours });
    if (existingAssignment) {
        return existingAssignment;
    }

    const user = await User.findByPk(userId, { attributes: ['id', 'countryCode'] });
    const requestedCountry = normalizeCountryCode(region || user?.countryCode);
    await syncOwnedTwilioDemoNumbers({
        force: true,
        countries: requestedCountry ? [requestedCountry] : undefined
    });

    const syncedAssignment = await assignExistingDemoNumber({ userId, region, voicePreferences, ttlHours });
    if (syncedAssignment) {
        return syncedAssignment;
    }

    return purchaseDemoNumberForUser({ userId, region, voicePreferences, ttlHours });
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

const syncOwnedTwilioDemoNumbers = async ({ force = false, countries } = {}) => {
    if (!force && TWILIO_DEMO_SYNC_ENABLED !== 'true') {
        return { synced: false, imported: 0, updated: 0, skipped: 0, reason: 'disabled' };
    }

    if (!twilioEnabled()) {
        return { synced: false, imported: 0, updated: 0, skipped: 0, reason: 'missing_twilio_credentials' };
    }

    const requestedCountries = Array.isArray(countries) ? countries.map(normalizeCountryCode).filter(Boolean) : [];
    const allowedCountries = requestedCountries.length > 0 ? requestedCountries : getAllowedTwilioDemoCountries();
    const minIdleDays = Math.max(1, Number(TWILIO_DEMO_MIN_IDLE_DAYS || 30));
    const ownedNumbers = await listOwnedTwilioNumbers({ limit: TWILIO_DEMO_IMPORT_LIMIT });
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const twilioNumber of ownedNumbers) {
        const phoneNumber = String(twilioNumber?.phone_number || '').trim();
        if (!phoneNumber) {
            skipped += 1;
            continue;
        }

        const countryCode = normalizeCountryCode(twilioNumber.iso_country || twilioNumber.country_code || '');
        if (allowedCountries.length > 0 && (!countryCode || !allowedCountries.includes(countryCode))) {
            skipped += 1;
            continue;
        }

        const assignedToUser = await numberExistsOnAnyUser(phoneNumber);
        if (assignedToUser) {
            skipped += 1;
            continue;
        }

        const existingDemoNumber = await DemoNumber.findOne({ where: { phoneNumber } });
        if (existingDemoNumber && existingDemoNumber.status !== 'available') {
            skipped += 1;
            continue;
        }

        const hasRecentCalls = await hasRecentInboundTwilioCalls({ phoneNumber, minIdleDays });
        if (hasRecentCalls) {
            skipped += 1;
            continue;
        }

        const metadata = {
            ...normalizeMetadata(existingDemoNumber?.metadata),
            importedFromTwilio: true,
            importedAt: normalizeMetadata(existingDemoNumber?.metadata).importedAt || new Date().toISOString(),
            updatedFromTwilioAt: new Date().toISOString(),
            minIdleDays,
            friendlyName: twilioNumber.friendly_name || undefined
        };

        if (existingDemoNumber) {
            existingDemoNumber.providerNumberId = twilioNumber.sid || existingDemoNumber.providerNumberId || '';
            existingDemoNumber.countryCode = countryCode || existingDemoNumber.countryCode || '';
            existingDemoNumber.metadata = metadata;
            await existingDemoNumber.save();
            updated += 1;
            continue;
        }

        await DemoNumber.create({
            phoneNumber,
            providerNumberId: twilioNumber.sid || '',
            countryCode: countryCode || '',
            status: 'available',
            metadata
        });
        imported += 1;
    }

    return { synced: true, imported, updated, skipped, checked: ownedNumbers.length };
};

const seedDemoNumbersFromEnv = async () => {
    const entries = parseDemoNumbersFromEnv();
    let seeded = 0;
    for (const entry of entries) {
        const [demoNumber, created] = await DemoNumber.findOrCreate({
            where: { phoneNumber: entry.phoneNumber },
            defaults: {
                phoneNumber: entry.phoneNumber,
                providerNumberId: entry.providerNumberId || '',
                countryCode: entry.countryCode || '',
                status: 'available',
                metadata: {
                    seededFromEnv: true,
                    label: entry.label || undefined,
                    seededAt: new Date().toISOString()
                }
            }
        });

        if (!created && demoNumber.status === 'available') {
            demoNumber.providerNumberId = entry.providerNumberId || demoNumber.providerNumberId || '';
            demoNumber.countryCode = entry.countryCode || demoNumber.countryCode || '';
            demoNumber.metadata = {
                ...normalizeMetadata(demoNumber.metadata),
                seededFromEnv: true,
                label: entry.label || normalizeMetadata(demoNumber.metadata).label,
                updatedFromEnvAt: new Date().toISOString()
            };
            await demoNumber.save();
        }

        if (created) {
            seeded += 1;
        }
    }

    const twilioSync = await syncOwnedTwilioDemoNumbers();
    return { seeded, configured: entries.length, twilioSync };
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
    seedDemoNumbersFromEnv,
    syncOwnedTwilioDemoNumbers,
    getActiveDemoForUser,
    reclaimExpiredDemoNumbers
};
