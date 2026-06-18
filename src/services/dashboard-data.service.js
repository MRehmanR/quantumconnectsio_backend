const https = require('https');
const { URL } = require('url');
const { Op } = require('sequelize');
const Stripe = require('stripe');
const {
    User,
    CallLog,
    CallContact,
    Appointment,
    AppointmentContact,
    KnowledgeBaseEntry,
    KnowledgeBaseAttachment,
    FeatureToggleConfig,
    ReferralBonusAward,
    SubscriptionPlan,
    Invoice,
    AutomationEvent,
    EscalationLog,
    KbQueryLog,
    DailySummary,
    DemoNumber
} = require('../models');
const { defaultFeatureToggles } = require('../constants/feature-toggles');
const {
    N8N_MANUAL_APPOINTMENT_WEBHOOK_URL,
    AUTOMATION_SHARED_KEY,
    BILLING_PORTAL_URL,
    FRONTEND_APP_URL,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    STRIPE_CURRENCY,
    RETELL_API_KEY,
    RETELL_API_BASE_URL,
    RETELL_UPDATE_AGENT_PATH
} = require('../config/env');
const provisioningService = require('./provisioning.service');
const demoNumberService = require('./demo-number.service');
const { normalizePhone, getCountryHintFromE164 } = require('../utils/phone');
const { resolveCountryFromPayload, normalizeCountryCode } = require('../utils/country');

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const defaultPlans = [
    { name: 'Trial', price: 0, callsLimit: 50, concurrentLimit: 2 },
    { name: 'Rise', price: 99, callsLimit: 150, concurrentLimit: 5 },
    { name: 'Elevate', price: 249, callsLimit: 500, concurrentLimit: 20 },
    { name: 'Apex', price: 499, callsLimit: 1100, concurrentLimit: 50 }
];

let stripeClient = null;

const normalizeStripeCurrency = (value, fallback = 'gbp') => {
    const safeValue = String(value || fallback)
        .trim()
        .toLowerCase();
    return /^[a-z]{3}$/.test(safeValue) ? safeValue : fallback;
};

const DEFAULT_STRIPE_CURRENCY = normalizeStripeCurrency(STRIPE_CURRENCY, 'gbp');

const formatDuration = (durationSeconds) => {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
};

const toLocalYmd = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const serializeAppointmentDeposit = (appointment) => ({
    status: appointment.depositStatus || 'None',
    requiredAmount: Number(appointment.depositRequiredAmount || 0),
    paidAmount: Number(appointment.depositPaidAmount || 0),
    currency: String(appointment.depositCurrency || DEFAULT_STRIPE_CURRENCY).toUpperCase(),
    paymentUrl: appointment.depositCheckoutUrl || '',
    checkoutSessionId: appointment.depositCheckoutSessionId || '',
    requestedAt: appointment.depositRequestedAt || null,
    paidAt: appointment.depositPaidAt || null
});

const cloneDefaultToggles = () => JSON.parse(JSON.stringify(defaultFeatureToggles));

const safeJsonParse = (value, fallback) => {
    try {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }
        return JSON.parse(String(value));
    } catch {
        return fallback;
    }
};

const requestJson = ({ method, url, headers = {}, body }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body ? JSON.stringify(body) : null;

        const req = https.request(
            {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                headers: {
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...headers
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
                        resolve(parsedBody);
                    } else {
                        reject(
                            new Error(
                                `HTTP ${res.statusCode} ${res.statusMessage || ''} ${
                                    typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody || {})
                                }`
                            )
                        );
                    }
                });
            }
        );

        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });

const updateRetellAgentVoice = async ({ agentId, voiceId }) => {
    const apiKey = String(RETELL_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('Retell is missing RETELL_API_KEY. Configure it in backend .env.');
    }

    const baseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const configuredPath = String(RETELL_UPDATE_AGENT_PATH || '/update-agent').trim();
    const normalizedConfiguredPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`;

    const requestPlans = [
        {
            method: 'POST',
            url: `${baseUrl}${normalizedConfiguredPath}`,
            body: { agent_id: agentId, voice_id: voiceId }
        },
        {
            method: 'PATCH',
            url: `${baseUrl}/v2/agents/${encodeURIComponent(agentId)}`,
            body: { voice_id: voiceId }
        }
    ];

    let lastError = null;
    for (const plan of requestPlans) {
        try {
            return await requestJson({
                method: plan.method,
                url: plan.url,
                headers: {
                    Authorization: `Bearer ${apiKey}`
                },
                body: plan.body
            });
        } catch (error) {
            lastError = error;
            const message = String(error?.message || '');
            const isNotFound = message.includes('HTTP 404') || message.includes('Cannot');
            if (!isNotFound) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Failed to update Retell agent voice');
};

const ensureSubscriptionPlans = async () => {
    const desiredNames = defaultPlans.map((plan) => plan.name);

    await Promise.all(
        defaultPlans.map((plan) =>
            SubscriptionPlan.upsert({
                name: plan.name,
                price: plan.price,
                callsLimit: plan.callsLimit,
                concurrentLimit: plan.concurrentLimit
            })
        )
    );

    return SubscriptionPlan.findAll({
        where: {
            name: {
                [Op.in]: desiredNames
            }
        },
        order: [['price', 'ASC']]
    });
};

const getStripeClient = () => {
    if (!STRIPE_SECRET_KEY) {
        const stripeError = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in backend .env.');
        stripeError.code = 'STRIPE_NOT_CONFIGURED';
        throw stripeError;
    }

    if (!stripeClient) {
        stripeClient = new Stripe(STRIPE_SECRET_KEY);
    }

    return stripeClient;
};

const buildStripeWebhookEvent = ({ rawBody, signature }) => {
    const safeSignature = String(signature || '').trim();
    if (!safeSignature) {
        const signatureError = new Error('Missing Stripe signature header.');
        signatureError.code = 'STRIPE_WEBHOOK_SIGNATURE_REQUIRED';
        throw signatureError;
    }

    const webhookSecret = String(STRIPE_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
        const webhookConfigError = new Error('Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET in backend .env.');
        webhookConfigError.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED';
        throw webhookConfigError;
    }

    const stripe = getStripeClient();
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');

    try {
        return stripe.webhooks.constructEvent(payload, safeSignature, webhookSecret);
    } catch {
        const invalidSignatureError = new Error('Invalid Stripe webhook signature.');
        invalidSignatureError.code = 'STRIPE_WEBHOOK_SIGNATURE_INVALID';
        throw invalidSignatureError;
    }
};

const getFrontendBaseUrl = (origin) => {
    const originValue = String(origin || '').trim();
    if (originValue.startsWith('http://') || originValue.startsWith('https://')) {
        return originValue.replace(/\/$/, '');
    }

    return String(FRONTEND_APP_URL || 'http://localhost:8080').trim().replace(/\/$/, '');
};

const buildInvoiceNumber = async () => {
    const invoiceCount = await Invoice.count();
    return `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(4, '0')}`;
};

const applyReferralAwardIfEligible = async (user) => {
    let referralAward = null;
    if (user.referredByCode) {
        const referrer = await User.findOne({ where: { referralCode: user.referredByCode } });
        if (referrer && referrer.id !== user.id) {
            const existingAward = await ReferralBonusAward.findOne({
                where: {
                    referrerUserId: referrer.id,
                    referredUserId: user.id
                }
            });

            if (!existingAward) {
                const now = new Date();
                const baseExpiry =
                    referrer.referralBonusExpiresAt && new Date(referrer.referralBonusExpiresAt) > now
                        ? new Date(referrer.referralBonusExpiresAt)
                        : now;
                const newExpiry = new Date(baseExpiry);
                newExpiry.setDate(newExpiry.getDate() + 7);

                referrer.referralBonusMinutes = (referrer.referralBonusMinutes || 0) + 20;
                referrer.referralBonusExpiresAt = newExpiry;
                await referrer.save();

                referralAward = await ReferralBonusAward.create({
                    referrerUserId: referrer.id,
                    referredUserId: user.id,
                    minutesAwarded: 20,
                    expiresAt: newExpiry
                });
            }
        }
    }

    return referralAward;
};

const finalizePaidPlanPurchase = async ({ user, plan, paymentReference = '' }) => {
    if (paymentReference) {
        const existingInvoice = await Invoice.findOne({ where: { paymentReference } });
        if (existingInvoice) {
            return {
                plan: plan.name,
                invoiceId: existingInvoice.invoiceNumber,
                referralAwarded: false,
                referralBonusMinutes: 0,
                referralBonusExpiresAt: null,
                numberProvisioning: {
                    skipped: true,
                    reason: 'payment_already_processed'
                }
            };
        }
    }

    user.plan = plan.name;
    user.status = 'Active';
    await user.save();

    const invoice = await Invoice.create({
        userId: user.id,
        invoiceNumber: await buildInvoiceNumber(),
        issuedAt: new Date().toISOString().slice(0, 10),
        amount: plan.price,
        status: 'Paid',
        planName: plan.name,
        paymentReference
    });

    const referralAward = await applyReferralAwardIfEligible(user);
    let numberProvisioning = null;

    if (user.role === 'user') {
        try {
            const assignedDemoNumber = await DemoNumber.findOne({
                where: {
                    assignedToUserId: user.id,
                    status: 'assigned'
                },
                attributes: ['id', 'phoneNumber', 'providerNumberId']
            });
            const currentNumberIsDemo =
                Boolean(assignedDemoNumber?.phoneNumber) &&
                String(user.inboundNumber || '').trim() === String(assignedDemoNumber.phoneNumber || '').trim();
            const currentSidIsDemo =
                Boolean(assignedDemoNumber?.providerNumberId) &&
                String(user.twilioPhoneNumberSid || '').trim() === String(assignedDemoNumber.providerNumberId || '').trim();
            const shouldReplaceDemoNumber = Boolean(assignedDemoNumber) && (currentNumberIsDemo || currentSidIsDemo);

            numberProvisioning = await provisioningService.provisionForUser(user.id, {
                country: user.countryCode || undefined,
                autoAssign: true,
                forceTwilioPurchase: shouldReplaceDemoNumber
            });

            if (assignedDemoNumber && (shouldReplaceDemoNumber || !currentNumberIsDemo)) {
                await demoNumberService.releaseAssignedDemoForUser({ userId: user.id });
            }
        } catch (error) {
            const freshUser = await User.findByPk(user.id);
            numberProvisioning = {
                skipped: false,
                error: String(error?.message || 'Twilio number provisioning failed')
            };
            if (freshUser) {
                freshUser.provisioningStatus = 'failed';
                freshUser.provisioningError = numberProvisioning.error.slice(0, 240);
                await freshUser.save();
            }
        }
    }

    return {
        plan: plan.name,
        invoiceId: invoice.invoiceNumber,
        referralAwarded: Boolean(referralAward),
        referralBonusMinutes: referralAward ? referralAward.minutesAwarded : 0,
        referralBonusExpiresAt: referralAward ? referralAward.expiresAt : null,
        numberProvisioning
    };
};

const getOrCreateStripeCustomerId = async (user, stripe) => {
    if (user.stripeCustomerId) {
        try {
            const existing = await stripe.customers.retrieve(user.stripeCustomerId);
            if (existing && !existing.deleted) {
                return user.stripeCustomerId;
            }
        } catch {
            // create a fresh customer if previously saved id is invalid
        }
    }

    const listed = await stripe.customers.list({ email: user.email, limit: 1 });
    const existingByEmail = listed?.data?.[0];

    const customer =
        existingByEmail ||
        (await stripe.customers.create({
            email: user.email,
            name: user.username,
            metadata: {
                userId: String(user.id),
                businessName: user.businessName || ''
            }
        }));

    user.stripeCustomerId = customer.id;
    await user.save();

    return customer.id;
};

const parseTimeToMinutes = (timeValue) => {
    if (!timeValue) {
        return null;
    }

    const raw = String(timeValue).trim();

    const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (hhmmMatch) {
        const hours = Number(hhmmMatch[1]);
        const minutes = Number(hhmmMatch[2]);
        return hours * 60 + minutes;
    }

    const ampmMatch = raw.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([AaPp][Mm])$/);
    if (ampmMatch) {
        let hours = Number(ampmMatch[1]) % 12;
        const minutes = Number(ampmMatch[2]);
        const period = ampmMatch[3].toUpperCase();
        if (period === 'PM') {
            hours += 12;
        }
        return hours * 60 + minutes;
    }

    return null;
};

const parseDateOnly = (dateValue) => {
    const raw = String(dateValue || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return date;
};

const buildLocalDateTime = (dateValue, minutes) => {
    const dateOnly = parseDateOnly(dateValue);
    if (!dateOnly || minutes === null || Number.isNaN(minutes)) {
        return null;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return new Date(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate(), hours, mins, 0, 0);
};

const assertAppointmentNotInPast = (dateValue, minutes) => {
    const dateTime = buildLocalDateTime(dateValue, minutes);
    if (!dateTime) {
        const invalidDateError = new Error('Invalid appointment date format. Use YYYY-MM-DD.');
        invalidDateError.code = 'INVALID_DATE_FORMAT';
        throw invalidDateError;
    }

    if (dateTime < new Date()) {
        const pastDateError = new Error('Appointment time must be in the future.');
        pastDateError.code = 'PAST_DATE_NOT_ALLOWED';
        throw pastDateError;
    }
};

const formatMinutesToHHmm = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getBookedSlotSetForDate = async (date, userId) => {
    const where = {
        appointmentDate: date,
        status: {
            [Op.in]: ['Pending', 'Confirmed']
        }
    };

    if (userId) {
        where.userId = userId;
    }

    const appointments = await Appointment.findAll({ where });

    return new Set(
        appointments
            .map((appointment) => parseTimeToMinutes(appointment.appointmentTime))
            .filter((value) => value !== null)
    );
};

const generateDailySlots = ({ startHour = 9, endHour = 18, intervalMinutes = 30 }) => {
    const slots = [];
    const start = startHour * 60;
    const end = endHour * 60;

    for (let current = start; current < end; current += intervalMinutes) {
        slots.push(current);
    }

    return slots;
};

const suggestAlternativeSlots = ({ requestedMinutes, availableMinutes, maxSuggestions = 5 }) => {
    const sorted = [...availableMinutes].sort((a, b) => Math.abs(a - requestedMinutes) - Math.abs(b - requestedMinutes));
    return sorted.slice(0, maxSuggestions).map((minutes) => formatMinutesToHHmm(minutes));
};

const resolveUserByEmail = async (email, actor) => {
    if (actor?.id) {
        const actorUser = await User.findByPk(actor.id);
        if (actorUser) {
            return actorUser;
        }
    }

    if (email) {
        const exact = await User.findOne({ where: { email } });
        if (exact) {
            return exact;
        }
    }

    return User.findOne({ where: { role: 'user' }, order: [['createdAt', 'ASC']] });
};

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const resolveUserByOwnerPhone = async (ownerPhone) => {
    const rawPhone = String(ownerPhone || '').trim();
    if (!rawPhone) {
        return null;
    }

    const exact = await User.findOne({ where: { ownerPhone: rawPhone } });
    if (exact) {
        return exact;
    }

    const digits = normalizePhoneDigits(rawPhone);
    if (!digits) {
        return null;
    }

    const usersWithPhone = await User.findAll({
        where: {
            role: 'user',
            ownerPhone: {
                [Op.ne]: ''
            }
        }
    });

    return (
        usersWithPhone.find((user) => {
            const userDigits = normalizePhoneDigits(user.ownerPhone);
            return userDigits === digits || userDigits.endsWith(digits) || digits.endsWith(userDigits);
        }) || null
    );
};

const resolveTenantUserForOperation = async ({ actor, tenantEmail, dialedNumber, ownerPhone }) => {
    if (actor?.id) {
        const actorUser = await User.findByPk(actor.id);
        if (actorUser && actorUser.role !== 'admin') {
            return actorUser;
        }
    }

    if (dialedNumber) {
        const byNumber = await User.findOne({ where: { inboundNumber: dialedNumber } });
        if (byNumber) {
            return byNumber;
        }
    }

    if (ownerPhone) {
        const byOwnerPhone = await resolveUserByOwnerPhone(ownerPhone);
        if (byOwnerPhone) {
            return byOwnerPhone;
        }
    }

    if (tenantEmail) {
        const byEmail = await User.findOne({ where: { email: tenantEmail } });
        if (byEmail) {
            return byEmail;
        }
    }

    return null;
};

const ensureTenantForAutomation = ({ actor, tenantUser }) => {
    const isAutomationContext = !actor?.id;
    if (isAutomationContext && !tenantUser) {
        const tenantError = new Error('Tenant not found. Provide a valid ownerPhone, tenantEmail, or dialedNumber.');
        tenantError.code = 'TENANT_NOT_FOUND';
        throw tenantError;
    }
};

const ensureFeatureToggleConfig = async (accountKey) => {
    const safeAccountKey = String(accountKey || 'default').trim() || 'default';
    const existing = await FeatureToggleConfig.findOne({ where: { accountKey: safeAccountKey } });
    if (existing) {
        return existing;
    }

    return FeatureToggleConfig.create({
        accountKey: safeAccountKey,
        config: cloneDefaultToggles()
    });
};

const getProfile = async ({ actor }) => {
    if (!actor?.id) {
        throw new Error('Unauthorized');
    }

    const user = await User.findByPk(actor.id);
    if (!user) {
        throw new Error('User not found');
    }

    const demoNumber = await DemoNumber.findOne({
        where: {
            assignedToUserId: user.id,
            status: {
                [Op.in]: ['assigned', 'promoted']
            }
        }
    });

    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        businessName: user.businessName || '',
        ownerPhone: user.ownerPhone || '',
        inboundNumber: user.inboundNumber || '',
        timezone: user.timezone || 'UTC',
        countryCode: user.countryCode || '',
        retellSipTerminationUri: user.retellSipTerminationUri || '',
        retellSipTrunkAuthUsername: user.retellSipTrunkAuthUsername || '',
        hasRetellSipTrunkAuthPassword: Boolean(user.retellSipTrunkAuthPassword),
        retellAgentId: user.retellAgentId || '',
        provisioningStatus: user.provisioningStatus || 'pending',
        provisioningError: user.provisioningError || '',
        demoNumber: demoNumber
            ? {
                  id: demoNumber.id,
                  phoneNumber: demoNumber.phoneNumber,
                  status: demoNumber.status,
                  expiresAt: demoNumber.expiresAt
              }
            : null
    };
};

const updateProfile = async ({ actor, payload }) => {
    if (!actor?.id) {
        throw new Error('Unauthorized');
    }

    const user = await User.findByPk(actor.id);
    if (!user) {
        throw new Error('User not found');
    }

    const nextUsername = String(payload?.username || user.username || '').trim();
    const nextEmail = String(payload?.email || user.email || '').trim().toLowerCase();
    const nextBusinessName = String(payload?.businessName || '').trim();
    const nextOwnerPhoneRaw = String(payload?.ownerPhone || '').trim();
    const nextTimezone = String(payload?.timezone || user.timezone || 'UTC').trim();
    const nextInboundNumber = String(payload?.inboundNumber || user.inboundNumber || '').trim();
    const nextCountryCode = normalizeCountryCode(
        resolveCountryFromPayload(payload) || user.countryCode || getCountryHintFromE164(nextOwnerPhoneRaw)
    );
    const nextRetellSipTerminationUri = String(payload?.retellSipTerminationUri || '').trim();
    const nextRetellSipTrunkAuthUsername = String(payload?.retellSipTrunkAuthUsername || '').trim();
    const hasSipPasswordPayload = Object.prototype.hasOwnProperty.call(payload || {}, 'retellSipTrunkAuthPassword');
    const nextRetellSipTrunkAuthPassword = hasSipPasswordPayload
        ? String(payload?.retellSipTrunkAuthPassword || '').trim()
        : String(user.retellSipTrunkAuthPassword || '');

    const normalizedOwnerPhone = normalizePhone(nextOwnerPhoneRaw, {
        referenceE164: user.ownerPhone || nextInboundNumber || ''
    });

    if (!normalizedOwnerPhone.ok && nextOwnerPhoneRaw) {
        const phoneError = new Error(normalizedOwnerPhone.reason);
        phoneError.code = 'INVALID_PHONE_FORMAT';
        throw phoneError;
    }

    if (!nextUsername || !nextEmail) {
        const invalidError = new Error('username and email are required');
        invalidError.code = 'INVALID_PROFILE_PAYLOAD';
        throw invalidError;
    }

    const emailTaken = await User.findOne({
        where: {
            email: nextEmail,
            id: {
                [Op.ne]: user.id
            }
        },
        attributes: ['id']
    });

    if (emailTaken) {
        const conflictError = new Error('Email already exists');
        conflictError.code = 'EMAIL_ALREADY_EXISTS';
        throw conflictError;
    }

    if (nextInboundNumber && nextInboundNumber !== String(user.inboundNumber || '').trim()) {
        const numberTaken = await User.findOne({
            where: {
                inboundNumber: nextInboundNumber,
                id: {
                    [Op.ne]: user.id
                }
            },
            attributes: ['id', 'email']
        });

        if (numberTaken) {
            const conflictError = new Error(`This number is already assigned to another business account (${numberTaken.email}).`);
            conflictError.code = 'NUMBER_ALREADY_ASSIGNED';
            throw conflictError;
        }
    }

    user.username = nextUsername;
    user.email = nextEmail;
    user.businessName = nextBusinessName;
    user.ownerPhone = normalizedOwnerPhone.e164 || '';
    user.timezone = nextTimezone || 'UTC';
    user.countryCode = nextCountryCode;
    user.inboundNumber = nextInboundNumber || null;
    user.retellSipTerminationUri = nextRetellSipTerminationUri;
    user.retellSipTrunkAuthUsername = nextRetellSipTrunkAuthUsername;
    user.retellSipTrunkAuthPassword = nextRetellSipTrunkAuthPassword;
    await user.save();

    return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        businessName: user.businessName || '',
        ownerPhone: user.ownerPhone || '',
        inboundNumber: user.inboundNumber || '',
        timezone: user.timezone || 'UTC',
        countryCode: user.countryCode || '',
        retellSipTerminationUri: user.retellSipTerminationUri || '',
        retellSipTrunkAuthUsername: user.retellSipTrunkAuthUsername || '',
        hasRetellSipTrunkAuthPassword: Boolean(user.retellSipTrunkAuthPassword)
    };
};

const getDefaultWeeklySchedule = () => ([
    { day: 'monday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'tuesday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'wednesday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'thursday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'friday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'saturday', enabled: false, start: '09:00', end: '17:00' },
    { day: 'sunday', enabled: false, start: '09:00', end: '17:00' }
]);

const normalizeWeeklySchedule = (inputSchedule) => {
    const defaultSchedule = getDefaultWeeklySchedule();
    if (!Array.isArray(inputSchedule) || inputSchedule.length === 0) {
        return defaultSchedule;
    }

    const allowedDays = new Set(defaultSchedule.map((item) => item.day));
    const normalized = inputSchedule
        .map((item) => ({
            day: String(item?.day || '').toLowerCase(),
            enabled: Boolean(item?.enabled),
            start: String(item?.start || '09:00'),
            end: String(item?.end || '17:00')
        }))
        .filter((item) => allowedDays.has(item.day));

    if (normalized.length === 0) {
        return defaultSchedule;
    }

    return defaultSchedule.map((defaultDay) => {
        const matched = normalized.find((item) => item.day === defaultDay.day);
        return matched || defaultDay;
    });
};

const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const isReceptionistActiveForUser = (user, nowDate = new Date()) => {
    const status = String(user?.receptionistStatus || 'paused');
    if (status === 'paused') {
        return false;
    }
    if (status === 'live') {
        return true;
    }

    const scheduleMode = String(user?.receptionistScheduleMode || 'always_on');
    if (scheduleMode === 'always_on') {
        return true;
    }

    const schedule = normalizeWeeklySchedule(safeJsonParse(user?.receptionistWeeklySchedule, getDefaultWeeklySchedule()));
    const currentDay = dayNames[nowDate.getDay()];
    const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const row = schedule.find((item) => item.day === currentDay);

    if (!row || !row.enabled) {
        return false;
    }

    const start = parseTimeToMinutes(row.start);
    const end = parseTimeToMinutes(row.end);
    if (start === null || end === null) {
        return false;
    }
    return currentMinutes >= start && currentMinutes <= end;
};

const getAiReceptionistConfig = async ({ actor }) => {
    if (!actor?.id) {
        throw new Error('Unauthorized');
    }

    const user = await User.findByPk(actor.id);
    if (!user) {
        throw new Error('User not found');
    }

    return {
        name: String(user.receptionistName || 'Aria'),
        voice: String(user.receptionistVoice || 'Aria'),
        customGreeting: String(user.receptionistCustomGreeting || ''),
        status: String(user.receptionistStatus || 'paused'),
        scheduleMode: String(user.receptionistScheduleMode || 'always_on'),
        weeklySchedule: normalizeWeeklySchedule(safeJsonParse(user.receptionistWeeklySchedule, getDefaultWeeklySchedule())),
        faqActiveMap: safeJsonParse(user.receptionistFaqActiveMap, {}),
        bookingRules: safeJsonParse(user.receptionistBookingRules, {}),
        isActiveNow: isReceptionistActiveForUser(user),
        timezone: user.timezone || 'UTC'
    };
};

const updateAiReceptionistConfig = async ({ actor, payload }) => {
    if (!actor?.id) {
        throw new Error('Unauthorized');
    }

    const user = await User.findByPk(actor.id);
    if (!user) {
        throw new Error('User not found');
    }

    const nextName = String(payload?.name || user.receptionistName || 'Aria').trim() || 'Aria';
    const nextVoice = String(payload?.voice || user.receptionistVoice || 'Aria').trim() || 'Aria';
    const voiceChanged = Boolean(payload?.voice) && nextVoice !== String(user.receptionistVoice || 'Aria');

    if (voiceChanged) {
        if (!user.retellAgentId) {
            throw new Error('Retell agent is not connected yet. Provision the agent before changing voice.');
        }
        await updateRetellAgentVoice({ agentId: user.retellAgentId, voiceId: nextVoice });
    }

    user.receptionistName = nextName;
    user.receptionistVoice = nextVoice;
    user.receptionistCustomGreeting = String(payload?.customGreeting || user.receptionistCustomGreeting || '').trim();

    const nextStatus = String(payload?.status || user.receptionistStatus || 'paused').toLowerCase();
    user.receptionistStatus = ['live', 'paused', 'scheduled'].includes(nextStatus) ? nextStatus : 'paused';

    const nextScheduleMode = String(payload?.scheduleMode || user.receptionistScheduleMode || 'always_on').toLowerCase();
    user.receptionistScheduleMode = ['always_on', 'custom'].includes(nextScheduleMode) ? nextScheduleMode : 'always_on';
    user.receptionistWeeklySchedule = JSON.stringify(normalizeWeeklySchedule(payload?.weeklySchedule));
    user.receptionistFaqActiveMap = JSON.stringify((payload?.faqActiveMap && typeof payload.faqActiveMap === 'object') ? payload.faqActiveMap : {});
    user.receptionistBookingRules = JSON.stringify((payload?.bookingRules && typeof payload.bookingRules === 'object') ? payload.bookingRules : {});
    await user.save();

    return getAiReceptionistConfig({ actor });
};

const triggerManualAppointmentNotification = async ({
    appointment,
    contact,
    tenantUser,
    tenantEmail,
    ownerPhone,
    action,
    previousStatus,
    extraPayload
}) => {
    const webhookUrl = String(N8N_MANUAL_APPOINTMENT_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
        return { attempted: false, ok: false, status: 0, message: 'Webhook URL is not configured' };
    }

    const sharedKey = String(AUTOMATION_SHARED_KEY || '').trim();

    const payload = {
        source: 'backend.dashboard',
        action,
        appointmentId: String(appointment.id),
        status: appointment.status,
        previousStatus: previousStatus || '',
        tenantEmail: tenantUser?.email || tenantEmail || '',
        ownerPhone: String(ownerPhone || tenantUser?.ownerPhone || '').trim(),
        customerName: contact?.name || appointment.caller || '',
        customerPhone: contact?.phone || '',
        customerEmail: contact?.email || '',
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        appointmentType: appointment.type,
        ...((extraPayload && typeof extraPayload === 'object') ? extraPayload : {}),
        occurredAt: new Date().toISOString(),
        idempotencyKey: `manual_appointment_${action}_${appointment.id}_${Date.now()}`,
        automationKey: sharedKey
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-automation-key': sharedKey
            },
            body: JSON.stringify(payload)
        });

        const body = await response.text().catch(() => '');

        if (!response.ok) {
            console.warn(`Manual appointment notification webhook failed (${response.status}): ${body}`);
            return {
                attempted: true,
                ok: false,
                status: response.status,
                message: body || `HTTP ${response.status}`
            };
        }

        return {
            attempted: true,
            ok: true,
            status: response.status,
            message: body || 'Notification webhook accepted'
        };
    } catch (error) {
        console.warn(`Manual appointment notification webhook error: ${error.message}`);
        return {
            attempted: true,
            ok: false,
            status: 0,
            message: error.message
        };
    }
};

const resolvePerformanceWindow = ({ range, startDate, endDate }) => {
    const normalizedRange = String(range || 'weekly').trim().toLowerCase();
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);

    if (normalizedRange === 'monthly') {
        start.setDate(end.getDate() - 29);
        return { start, end };
    }

    if (normalizedRange === 'custom') {
        const parsedStart = parseDateOnly(startDate);
        const parsedEnd = parseDateOnly(endDate);
        if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
            const error = new Error('Invalid custom range. Provide startDate and endDate in YYYY-MM-DD format.');
            error.code = 'INVALID_DATE_RANGE';
            throw error;
        }
        return { start: parsedStart, end: parsedEnd };
    }

    start.setDate(end.getDate() - 6);
    return { start, end };
};

const buildDailyPerformance = (calls, appointments, { start, end }) => {
    const buckets = [];
    const dayCursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const safeEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    while (dayCursor <= safeEnd) {
        const d = new Date(dayCursor);
        buckets.push({
            key: d.toISOString().slice(0, 10),
            date: d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
            calls: 0,
            bookings: 0,
            revenue: 0
        });
        dayCursor.setDate(dayCursor.getDate() + 1);
    }

    const lookup = new Map(buckets.map((item) => [item.key, item]));

    calls.forEach((call) => {
        const key = new Date(call.callTime).toISOString().slice(0, 10);
        const bucket = lookup.get(key);
        if (bucket) {
            bucket.calls += 1;
        }
    });

    appointments.forEach((appointment) => {
        const key = new Date(appointment.appointmentDate).toISOString().slice(0, 10);
        const bucket = lookup.get(key);
        if (!bucket) {
            return;
        }

        const status = String(appointment.status || '');
        if (['Pending', 'Confirmed', 'Completed'].includes(status)) {
            bucket.bookings += 1;
        }

        bucket.revenue += Number(appointment.depositPaidAmount || 0);
    });

    return buckets.map(({ date, calls: totalCalls, bookings, revenue }) => ({
        date,
        calls: totalCalls,
        bookings,
        revenue: Number(Number(revenue || 0).toFixed(2))
    }));
};

const getDashboardOverview = async ({ actor, range = 'weekly', startDate = '', endDate = '' } = {}) => {
    const isAdmin = actor?.role === 'admin';
    const whereForCalls = {};
    const whereForAppointments = {};
    const whereForKb = {};

    if (!isAdmin && actor?.id) {
        whereForCalls.userId = actor.id;
        whereForAppointments.userId = actor.id;
        whereForKb.userId = actor.id;
    }

    const [calls, callContacts, appointments, appointmentContacts, user, websiteKnowledgeEntries] = await Promise.all([
        CallLog.findAll({ where: whereForCalls, order: [['callTime', 'DESC']] }),
        CallContact.findAll(),
        Appointment.findAll({ where: whereForAppointments, order: [['appointmentDate', 'ASC'], ['appointmentTime', 'ASC']] }),
        AppointmentContact.findAll(),
        actor?.id ? User.findByPk(actor.id) : null,
        KnowledgeBaseEntry.findAll({
            where: {
                ...whereForKb,
                category: 'Website'
            },
            order: [['createdAt', 'DESC']],
            limit: 3
        })
    ]);

    const activePlanName = user?.plan || 'Trial';
    const activePlan = await SubscriptionPlan.findOne({ where: { name: activePlanName } });
    const callsLimit = Number(activePlan?.callsLimit || 50);
    const callsUsed = calls.length;
    const callsAnswered = calls.filter((call) => String(call.status || '').toLowerCase() === 'completed').length;
    const totalRevenueGenerated = Number(
        appointments.reduce((sum, appointment) => sum + Number(appointment.depositPaidAmount || 0), 0).toFixed(2)
    );

    const appointmentContactMap = new Map(
        appointmentContacts.map((contact) => [contact.appointmentId, contact])
    );

    const callContactMap = new Map(callContacts.map((contact) => [contact.callLogId, contact]));

    const recentCalls = calls.slice(0, 4).map((call) => ({
        id: String(call.id),
        callerNumber: call.callerNumber,
        callerName: callContactMap.get(call.id)?.name || 'Unknown Caller',
        callerPhone: callContactMap.get(call.id)?.phone || call.callerNumber,
        callerEmail: callContactMap.get(call.id)?.email || '',
        date: dateFormatter.format(new Date(call.callTime)),
        time: timeFormatter.format(new Date(call.callTime)),
        duration: formatDuration(call.durationSeconds),
        sentiment: call.sentiment,
        status: call.status,
        transcript: call.transcript
    }));

    const serializedAppointments = appointments.map((appointment) => ({
        id: String(appointment.id),
        caller: appointment.caller,
        customerName: appointmentContactMap.get(appointment.id)?.name || appointment.caller,
        customerPhone: appointmentContactMap.get(appointment.id)?.phone || '',
        customerEmail: appointmentContactMap.get(appointment.id)?.email || '',
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment)
    }));

    const extractedKnowledgePreview = websiteKnowledgeEntries.map((entry) => ({
        id: String(entry.id),
        title: String(entry.title || '').trim(),
        extractedAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : '',
        preview: String(entry.content || '').replace(/\s+/g, ' ').trim().slice(0, 260)
    }));

    const performanceWindow = resolvePerformanceWindow({ range, startDate, endDate });
    const dailyPerformance = buildDailyPerformance(calls, appointments, performanceWindow);

    return {
        callsUsed,
        callsRemaining: Math.max(callsLimit - callsUsed, 0),
        totalRevenueGenerated,
        totalCallsAnswered: callsAnswered,
        currentPlan: activePlanName,
        nextBillingDate: dateFormatter.format(new Date(new Date().setDate(new Date().getDate() + 30))),
        businessName: user?.businessName || '',
        businessNumber: user?.inboundNumber || '',
        extractedKnowledgePreview,
        dailyCalls: dailyPerformance.map((item) => ({ date: item.date, calls: item.calls, bookings: item.bookings })),
        dailyPerformance,
        recentCalls,
        appointments: serializedAppointments
    };
};

const getCalls = async ({ search, filter, actor }) => {
    const normalizedSearch = String(search || '').trim();
    const normalizedFilter = String(filter || '').trim();
    const where = {};
    const isAdmin = actor?.role === 'admin';

    if (!isAdmin && actor?.id) {
        where.userId = actor.id;
    }

    if (normalizedFilter && normalizedFilter !== 'All' && normalizedFilter !== 'undefined' && normalizedFilter !== 'null') {
        const allowedStatuses = new Set(['Completed', 'Escalated', 'Missed']);
        if (allowedStatuses.has(normalizedFilter)) {
            where.status = normalizedFilter;
        }
    }

    if (normalizedSearch && normalizedSearch !== 'undefined' && normalizedSearch !== 'null') {
        const matchedContactRows = await CallContact.findAll({
            where: {
                [Op.or]: [
                    { name: { [Op.like]: `%${normalizedSearch}%` } },
                    { phone: { [Op.like]: `%${normalizedSearch}%` } },
                    { email: { [Op.like]: `%${normalizedSearch}%` } }
                ]
            },
            attributes: ['callLogId']
        });

        const callIdsFromContacts = matchedContactRows.map((row) => row.callLogId);

        where[Op.or] = [
            { callerNumber: { [Op.like]: `%${normalizedSearch}%` } },
            { transcript: { [Op.like]: `%${normalizedSearch}%` } },
            ...(callIdsFromContacts.length > 0 ? [{ id: { [Op.in]: callIdsFromContacts } }] : [])
        ];
    }

    const [calls, callContacts] = await Promise.all([
        CallLog.findAll({
            where,
            order: [['callTime', 'DESC']]
        }),
        CallContact.findAll()
    ]);

    const contactsMap = new Map(callContacts.map((contact) => [contact.callLogId, contact]));

    return calls.map((call) => ({
        id: String(call.id),
        callerNumber: call.callerNumber,
        callerName: contactsMap.get(call.id)?.name || 'Unknown Caller',
        callerPhone: contactsMap.get(call.id)?.phone || call.callerNumber,
        callerEmail: contactsMap.get(call.id)?.email || '',
        date: dateFormatter.format(new Date(call.callTime)),
        time: timeFormatter.format(new Date(call.callTime)),
        duration: formatDuration(call.durationSeconds),
        sentiment: call.sentiment,
        status: call.status,
        transcript: call.transcript
    }));
};

const getAppointments = async ({ actor }) => {
    const where = {};
    const isAdmin = actor?.role === 'admin';

    if (!isAdmin && actor?.id) {
        where.userId = actor.id;
    }

    const [appointments, appointmentContacts] = await Promise.all([
        Appointment.findAll({
            where,
            order: [['appointmentDate', 'ASC'], ['appointmentTime', 'ASC']]
        }),
        AppointmentContact.findAll()
    ]);

    const appointmentContactMap = new Map(appointmentContacts.map((contact) => [contact.appointmentId, contact]));

    return appointments.map((appointment) => ({
        id: String(appointment.id),
        caller: appointment.caller,
        customerName: appointmentContactMap.get(appointment.id)?.name || appointment.caller,
        customerPhone: appointmentContactMap.get(appointment.id)?.phone || '',
        customerEmail: appointmentContactMap.get(appointment.id)?.email || '',
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment)
    }));
};

const generateManualDailySummary = async ({ actor, targetDate }) => {
    const isAdmin = actor?.role === 'admin';
    let date = new Date();
    const target = String(targetDate || '').trim();
    const ymdMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (ymdMatch) {
        const year = Number(ymdMatch[1]);
        const month = Number(ymdMatch[2]) - 1;
        const day = Number(ymdMatch[3]);
        date = new Date(year, month, day);
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
            const invalidDateError = new Error('Invalid targetDate. Use a real calendar date in YYYY-MM-DD format.');
            invalidDateError.code = 'INVALID_TARGET_DATE';
            throw invalidDateError;
        }
    } else if (target) {
        const parsed = new Date(target);
        if (Number.isNaN(parsed.getTime())) {
            const invalidDateError = new Error('Invalid targetDate. Use YYYY-MM-DD format.');
            invalidDateError.code = 'INVALID_TARGET_DATE';
            throw invalidDateError;
        }
        date = parsed;
    }

    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (start > todayStart) {
        const futureDateError = new Error('Daily summary can only be generated for today or previous dates.');
        futureDateError.code = 'FUTURE_DATE_NOT_ALLOWED';
        throw futureDateError;
    }

    const scopedWhereCalls = {
        callTime: {
            [Op.between]: [start, end]
        }
    };

    const scopedWhereCreatedAppointments = {
        createdAt: {
            [Op.between]: [start, end]
        }
    };

    const scopedWhereUpdatedAppointments = {
        updatedAt: {
            [Op.between]: [start, end]
        }
    };

    const scopedWhereEscalations = {
        createdAt: {
            [Op.between]: [start, end]
        }
    };

    const scopedWhereKb = {
        createdAt: {
            [Op.between]: [start, end]
        }
    };

    if (!isAdmin && actor?.id) {
        scopedWhereCalls.userId = actor.id;
        scopedWhereCreatedAppointments.userId = actor.id;
        scopedWhereUpdatedAppointments.userId = actor.id;
        scopedWhereEscalations.userId = actor.id;
        scopedWhereKb.userId = actor.id;
    }

    const [totalCalls, bookings, cancellations, escalations, noShows, kbQueries, revenueGeneratedRaw] = await Promise.all([
        CallLog.count({ where: scopedWhereCalls }),
        Appointment.count({
            where: {
                ...scopedWhereCreatedAppointments,
                status: {
                    [Op.in]: ['Confirmed', 'Pending', 'Completed']
                }
            }
        }),
        Appointment.count({
            where: {
                ...scopedWhereUpdatedAppointments,
                status: 'Cancelled'
            }
        }),
        EscalationLog.count({ where: scopedWhereEscalations }),
        Appointment.count({
            where: {
                ...scopedWhereUpdatedAppointments,
                status: 'NoShow'
            }
        }),
        KbQueryLog.count({ where: scopedWhereKb }),
        Appointment.sum('depositPaidAmount', {
            where: {
                ...scopedWhereUpdatedAppointments,
                depositStatus: 'Paid'
            }
        })
    ]);
    const revenueGenerated = Number(Number(revenueGeneratedRaw || 0).toFixed(2));

    const payload = {
        date: toLocalYmd(start),
        totalCalls,
        bookings,
        cancellations,
        escalations,
        noShows,
        kbQueries,
        revenueGenerated,
        generatedFor: !isAdmin && actor?.email ? actor.email : 'all'
    };

    const tenantSummaryKey = String(payload.generatedFor || 'all').toLowerCase();
    await DailySummary.upsert({
        userId: !isAdmin && actor?.id ? actor.id : null,
        tenantEmail: tenantSummaryKey,
        summaryDate: payload.date,
        totalCalls,
        bookings,
        cancellations,
        escalations,
        noShows,
        kbQueries,
        source: 'manual',
        generatedAt: new Date()
    });

    const summaryEventKey = `manual_daily_summary_${payload.generatedFor}_${payload.date}_${Date.now()}`;

    await AutomationEvent.create({
        source: 'system',
        eventType: 'daily.summary.generated.manual',
        idempotencyKey: summaryEventKey,
        tenantEmail: !isAdmin && actor?.email ? actor.email : '',
        occurredAt: new Date(),
        payload,
        status: 'processed',
        processedAt: new Date()
    });

    return payload;
};

const getDailySummaryHistory = async ({ actor, date, startDate, endDate, limit = 30 }) => {
    const isAdmin = actor?.role === 'admin';
    const tenantSummaryKey = !isAdmin && actor?.email ? String(actor.email).toLowerCase() : 'all';

    const where = {
        tenantEmail: tenantSummaryKey
    };

    if (date) {
        where.summaryDate = date;
    } else if (startDate || endDate) {
        where.summaryDate = {
            [Op.between]: [startDate || '1970-01-01', endDate || '9999-12-31']
        };
    }

    const rows = await DailySummary.findAll({
        where,
        order: [['summaryDate', 'DESC']],
        limit: Math.min(Number(limit || 30), 180)
    });

    const history = await Promise.all(rows.map(async (row) => {
        const revenueRaw = await Appointment.sum('depositPaidAmount', {
            where: {
                appointmentDate: row.summaryDate,
                depositStatus: 'Paid',
                ...(row.userId ? { userId: row.userId } : {})
            }
        });
        const revenueGenerated = Number(Number(revenueRaw || 0).toFixed(2));

        return {
            date: row.summaryDate,
            totalCalls: row.totalCalls,
            bookings: row.bookings,
            cancellations: row.cancellations,
            escalations: row.escalations,
            noShows: row.noShows,
            kbQueries: row.kbQueries,
            revenueGenerated,
            generatedFor: row.tenantEmail,
            generatedAt: row.generatedAt
        };
    }));

    return history;
};

const getKnowledgeBaseEntries = async ({ actor } = {}) => {
    const where = actor?.id ? { userId: actor.id } : undefined;
    const entries = await KnowledgeBaseEntry.findAll({ where, order: [['createdAt', 'DESC']] });

    return entries.map((entry) => ({
        id: String(entry.id),
        title: entry.title,
        content: entry.content,
        category: entry.category,
        attachmentName: '',
        attachmentDataUrl: ''
    }));
};

const createKnowledgeBaseEntry = async (payload) => {
    const { title, content, category } = payload;

    const entry = await KnowledgeBaseEntry.create({
        title,
        content,
        category,
        userId: payload?.actor?.id || null
    });

    return {
        id: String(entry.id),
        title: entry.title,
        content: entry.content,
        category: entry.category,
        attachmentName: '',
        attachmentDataUrl: ''
    };
};

const deleteKnowledgeBaseEntry = async (id, { actor } = {}) => {
    const where = { id };
    if (actor?.id) {
        where.userId = actor.id;
    }
    const entry = await KnowledgeBaseEntry.findOne({ where });
    if (!entry) {
        return false;
    }
    await KnowledgeBaseAttachment.destroy({ where: { knowledgeBaseEntryId: entry.id } });
    const deleted = await KnowledgeBaseEntry.destroy({ where: { id: entry.id } });
    return deleted > 0;
};

const createAppointment = async ({ customerName, customerPhone, customerEmail, date, time, type, status, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });

    const ownerPhoneRaw = String(ownerPhone || tenantUser?.ownerPhone || '').trim();
    const normalizedOwnerPhone = normalizePhone(ownerPhoneRaw, {
        referenceE164: tenantUser?.ownerPhone || tenantUser?.inboundNumber || dialedNumber || ''
    });

    const customerPhoneRaw = String(customerPhone || '').trim();
    const normalizedCustomerPhone = normalizePhone(customerPhoneRaw, {
        referenceE164: normalizedOwnerPhone.e164 || tenantUser?.ownerPhone || tenantUser?.inboundNumber || dialedNumber || ''
    });

    if (!normalizedCustomerPhone.ok && customerPhoneRaw && actor?.id) {
        const invalidPhoneError = new Error(normalizedCustomerPhone.reason);
        invalidPhoneError.code = 'INVALID_PHONE_FORMAT';
        throw invalidPhoneError;
    }

    const requestedMinutes = parseTimeToMinutes(time);
    if (requestedMinutes === null) {
        const invalidTimeError = new Error('Invalid appointment time format');
        invalidTimeError.code = 'INVALID_TIME_FORMAT';
        throw invalidTimeError;
    }

    assertAppointmentNotInPast(date, requestedMinutes);
    const formattedTime = formatMinutesToHHmm(requestedMinutes);
    const requestedStatus = ['Pending', 'Confirmed'].includes(status) ? status : 'Pending';

    const existingAtSlot = await Appointment.findOne({
        where: {
            appointmentDate: date,
            appointmentTime: formattedTime,
            status: {
                [Op.in]: ['Pending', 'Confirmed']
            },
            ...(tenantUser?.id ? { userId: tenantUser.id } : {})
        },
        order: [['createdAt', 'DESC']]
    });

    if (existingAtSlot) {
        const existingContact = await AppointmentContact.findOne({ where: { appointmentId: existingAtSlot.id } });
        const existingPhone = String(existingContact?.phone || '').trim();
        const nextPhone = String(normalizedCustomerPhone.e164 || customerPhoneRaw || '').trim();
        const existingEmail = String(existingContact?.email || '').trim().toLowerCase();
        const nextEmail = String(customerEmail || '').trim().toLowerCase();
        const existingName = String(existingContact?.name || existingAtSlot.caller || '').trim().toLowerCase();
        const nextName = String(customerName || '').trim().toLowerCase();
        const sameCustomer =
            (nextPhone && existingPhone === nextPhone) ||
            (nextEmail && existingEmail === nextEmail) ||
            (nextName && existingName === nextName);

        if (sameCustomer) {
            return {
                id: String(existingAtSlot.id),
                userId: existingAtSlot.userId,
                caller: existingAtSlot.caller,
                customerName: existingContact?.name || existingAtSlot.caller,
                customerPhone: existingContact?.phone || '',
                customerEmail: existingContact?.email || '',
                date: dateFormatter.format(new Date(existingAtSlot.appointmentDate)),
                time: existingAtSlot.appointmentTime,
                type: existingAtSlot.type,
                status: existingAtSlot.status,
                deposit: serializeAppointmentDeposit(existingAtSlot),
                duplicate: true
            };
        }
    }

    const bookedSlotSet = await getBookedSlotSetForDate(date, tenantUser?.id);
    if (bookedSlotSet.has(requestedMinutes)) {
        const allSlots = generateDailySlots({});
        const availableSlots = allSlots.filter((slot) => !bookedSlotSet.has(slot));

        const slotUnavailableError = new Error('Requested time slot is not available');
        slotUnavailableError.code = 'SLOT_UNAVAILABLE';
        slotUnavailableError.alternatives = suggestAlternativeSlots({
            requestedMinutes,
            availableMinutes: availableSlots,
            maxSuggestions: 5
        });
        throw slotUnavailableError;
    }

    const appointment = await Appointment.create({
        caller: customerName,
        appointmentDate: date,
        appointmentTime: formattedTime,
        type: type || 'Consultation',
        status: requestedStatus,
        userId: tenantUser?.id || null,
        inboundNumber: tenantUser?.inboundNumber || dialedNumber || ''
    });

    await AppointmentContact.create({
        appointmentId: appointment.id,
        name: customerName,
        phone: normalizedCustomerPhone.e164 || customerPhoneRaw || '',
        email: customerEmail || ''
    });

    const notificationResult = await triggerManualAppointmentNotification({
        appointment,
        contact: {
            name: customerName,
            phone: normalizedCustomerPhone.e164 || customerPhoneRaw || '',
            email: customerEmail || ''
        },
        tenantUser,
        tenantEmail,
        ownerPhone: normalizedOwnerPhone.e164 || ownerPhoneRaw || '',
        action: 'booked',
        previousStatus: ''
    });

    if (notificationResult?.attempted && !notificationResult.ok) {
        const configuredWebhookUrl = String(N8N_MANUAL_APPOINTMENT_WEBHOOK_URL || '').trim();
        await AutomationEvent.create({
            source: 'system',
            eventType: 'appointment.notification.failed',
            idempotencyKey: `appointment_notify_failed_${appointment.id}_${Date.now()}`,
            tenantEmail: tenantUser?.email || tenantEmail || '',
            occurredAt: new Date(),
            payload: {
                appointmentId: appointment.id,
                action: 'booked',
                statusCode: notificationResult.status,
                error: notificationResult.message,
                webhookUrl: configuredWebhookUrl
            },
            status: 'failed',
            processedAt: new Date()
        });
    }

    await AutomationEvent.create({
        source: 'system',
        eventType: 'appointment.booked',
        idempotencyKey: `appointment_booked_${appointment.id}`,
        tenantEmail: tenantUser?.email || tenantEmail || '',
        occurredAt: new Date(),
        payload: {
            appointmentId: appointment.id,
            userId: tenantUser?.id || null,
            customerName,
            customerPhone: normalizedCustomerPhone.e164 || customerPhoneRaw || '',
            customerEmail: customerEmail || '',
            date,
            time,
            type: type || 'Consultation'
        },
        status: 'processed',
        processedAt: new Date()
    });

    return {
        id: String(appointment.id),
        userId: appointment.userId,
        caller: appointment.caller,
        customerName,
        customerPhone: normalizedCustomerPhone.e164 || customerPhoneRaw || '',
        customerEmail: customerEmail || '',
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment),
        notification: notificationResult
    };
};

const getAppointmentAvailability = async ({ date, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const targetDateOnly = parseDateOnly(targetDate);
    if (!targetDateOnly) {
        const invalidDateError = new Error('Invalid appointment date format. Use YYYY-MM-DD.');
        invalidDateError.code = 'INVALID_DATE_FORMAT';
        throw invalidDateError;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (targetDateOnly < todayStart) {
        const pastDateError = new Error('Appointment date must be today or later.');
        pastDateError.code = 'PAST_DATE_NOT_ALLOWED';
        throw pastDateError;
    }

    if (tenantUser && !isReceptionistActiveForUser(tenantUser)) {
        return {
            date: targetDate,
            availableSlots: [],
            fullyBooked: true,
            inactiveReason: 'AI receptionist is currently outside active schedule.'
        };
    }

    const bookedSlotSet = await getBookedSlotSetForDate(targetDate, tenantUser?.id);
    const allSlots = generateDailySlots({});

    const availableSlots = allSlots
        .filter((slot) => !bookedSlotSet.has(slot))
        .map((slot) => formatMinutesToHHmm(slot));

    return {
        date: targetDate,
        availableSlots,
        fullyBooked: availableSlots.length === 0
    };
};

const cancelAppointment = async ({ appointmentId, reason, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });
    const where = { id: appointmentId };
    if (tenantUser?.id) {
        where.userId = tenantUser.id;
    }

    const appointment = await Appointment.findOne({ where });
    if (!appointment) {
        return null;
    }

    const previousStatus = appointment.status;
    appointment.status = 'Cancelled';
    await appointment.save();

    const contact = await AppointmentContact.findOne({ where: { appointmentId: appointment.id } });

    await AutomationEvent.create({
        source: 'system',
        eventType: 'appointment.cancelled',
        idempotencyKey: `appointment_cancelled_${appointment.id}_${new Date().toISOString().slice(0, 16)}`,
        tenantEmail: tenantUser?.email || tenantEmail || '',
        occurredAt: new Date(),
        payload: {
            appointmentId: appointment.id,
            userId: appointment.userId,
            date: appointment.appointmentDate,
            time: appointment.appointmentTime,
            type: appointment.type,
            reason: reason || ''
        },
        status: 'processed',
        processedAt: new Date()
    });

    await triggerManualAppointmentNotification({
        appointment,
        contact,
        tenantUser,
        tenantEmail,
        ownerPhone,
        action: 'cancelled',
        previousStatus
    });

    return {
        id: String(appointment.id),
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment)
    };
};

const updateAppointmentStatus = async ({ appointmentId, status, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const normalizedStatus = String(status || '').trim();
    const allowedStatuses = new Set(['Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow']);

    if (!allowedStatuses.has(normalizedStatus)) {
        const invalidStatusError = new Error('Invalid appointment status');
        invalidStatusError.code = 'INVALID_APPOINTMENT_STATUS';
        throw invalidStatusError;
    }

    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });

    const where = { id: appointmentId };
    if (tenantUser?.id) {
        where.userId = tenantUser.id;
    }

    const appointment = await Appointment.findOne({ where });
    if (!appointment) {
        return null;
    }

    const previousStatus = appointment.status;
    appointment.status = normalizedStatus;
    await appointment.save();

    const contact = await AppointmentContact.findOne({ where: { appointmentId: appointment.id } });

    await AutomationEvent.create({
        source: 'system',
        eventType: 'appointment.status_updated',
        idempotencyKey: `appointment_status_${appointment.id}_${normalizedStatus}_${new Date().toISOString().slice(0, 16)}`,
        tenantEmail: tenantUser?.email || tenantEmail || '',
        occurredAt: new Date(),
        payload: {
            appointmentId: appointment.id,
            userId: appointment.userId,
            date: appointment.appointmentDate,
            time: appointment.appointmentTime,
            type: appointment.type,
            status: appointment.status
        },
        status: 'processed',
        processedAt: new Date()
    });

    await triggerManualAppointmentNotification({
        appointment,
        contact,
        tenantUser,
        tenantEmail,
        ownerPhone,
        action: 'status_updated',
        previousStatus
    });

    return {
        id: String(appointment.id),
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment)
    };
};

const rescheduleAppointment = async ({ appointmentId, date, time, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });
    const where = { id: appointmentId };
    if (tenantUser?.id) {
        where.userId = tenantUser.id;
    }

    const appointment = await Appointment.findOne({ where });
    if (!appointment) {
        return null;
    }

    const requestedMinutes = parseTimeToMinutes(time);
    if (requestedMinutes === null) {
        const invalidTimeError = new Error('Invalid appointment time format');
        invalidTimeError.code = 'INVALID_TIME_FORMAT';
        throw invalidTimeError;
    }

    assertAppointmentNotInPast(date, requestedMinutes);

    appointment.appointmentDate = date || appointment.appointmentDate;
    appointment.appointmentTime = formatMinutesToHHmm(requestedMinutes);
    appointment.status = 'Pending';
    await appointment.save();

    await AutomationEvent.create({
        source: 'system',
        eventType: 'appointment.rescheduled',
        idempotencyKey: `appointment_rescheduled_${appointment.id}_${new Date().toISOString().slice(0, 16)}`,
        tenantEmail: tenantUser?.email || tenantEmail || '',
        occurredAt: new Date(),
        payload: {
            appointmentId: appointment.id,
            userId: appointment.userId,
            date: appointment.appointmentDate,
            time: appointment.appointmentTime,
            type: appointment.type
        },
        status: 'processed',
        processedAt: new Date()
    });

    return {
        id: String(appointment.id),
        date: dateFormatter.format(new Date(appointment.appointmentDate)),
        time: appointment.appointmentTime,
        type: appointment.type,
        status: appointment.status,
        deposit: serializeAppointmentDeposit(appointment)
    };
};

const createAppointmentDepositCheckoutSession = async ({
    appointmentId,
    amount,
    totalAmount,
    percentage = 30,
    currency = DEFAULT_STRIPE_CURRENCY,
    tenantEmail,
    dialedNumber,
    ownerPhone,
    actor,
    origin
}) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });

    const where = { id: appointmentId };
    if (tenantUser?.id) {
        where.userId = tenantUser.id;
    }

    const appointment = await Appointment.findOne({ where });
    if (!appointment) {
        return null;
    }

    const amountValue = Number(amount || 0);
    const totalAmountValue = Number(totalAmount || 0);
    const percentageValue = Number(percentage || 0);

    let depositAmount = amountValue;
    if (!(depositAmount > 0) && totalAmountValue > 0 && percentageValue > 0) {
        depositAmount = (totalAmountValue * percentageValue) / 100;
    }

    if (!(depositAmount > 0)) {
        const invalidAmountError = new Error('Provide amount, or provide totalAmount with percentage.');
        invalidAmountError.code = 'INVALID_DEPOSIT_AMOUNT';
        throw invalidAmountError;
    }

    const safeCurrency = normalizeStripeCurrency(currency, DEFAULT_STRIPE_CURRENCY);
    const stripe = getStripeClient();
    const frontendBase = getFrontendBaseUrl(origin);
    const contact = await AppointmentContact.findOne({ where: { appointmentId: appointment.id } });

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: contact?.email || undefined,
        line_items: [
            {
                price_data: {
                    currency: safeCurrency,
                    product_data: {
                        name: `Appointment Deposit - ${appointment.type}`,
                        description: `Deposit for ${appointment.appointmentDate} ${appointment.appointmentTime}`
                    },
                    unit_amount: Math.round(depositAmount * 100)
                },
                quantity: 1
            }
        ],
        metadata: {
            paymentType: 'appointment_deposit',
            appointmentId: String(appointment.id),
            userId: String(appointment.userId || tenantUser?.id || '')
        },
        success_url: `${frontendBase}/?appointment_deposit=success&session_id={CHECKOUT_SESSION_ID}&appointment_id=${appointment.id}`,
        cancel_url: `${frontendBase}/?appointment_deposit=cancel&appointment_id=${appointment.id}`
    });

    appointment.depositStatus = 'Requested';
    appointment.depositRequiredAmount = Number(depositAmount.toFixed(2));
    appointment.depositCurrency = safeCurrency;
    appointment.depositCheckoutUrl = session.url || '';
    appointment.depositCheckoutSessionId = session.id || '';
    appointment.depositRequestedAt = new Date();
    appointment.depositPaidAt = null;
    appointment.depositPaidAmount = 0;
    await appointment.save();

    await AutomationEvent.create({
        source: 'system',
        eventType: 'appointment.deposit.requested',
        idempotencyKey: `appointment_deposit_requested_${appointment.id}_${Date.now()}`,
        tenantEmail: tenantUser?.email || tenantEmail || '',
        occurredAt: new Date(),
        payload: {
            appointmentId: appointment.id,
            userId: appointment.userId,
            amount: Number(depositAmount.toFixed(2)),
            currency: safeCurrency,
            paymentUrl: appointment.depositCheckoutUrl,
            checkoutSessionId: appointment.depositCheckoutSessionId
        },
        status: 'processed',
        processedAt: new Date()
    });

    const notificationResult = await triggerManualAppointmentNotification({
        appointment,
        contact,
        tenantUser,
        tenantEmail,
        ownerPhone,
        action: 'deposit_requested',
        previousStatus: '',
        extraPayload: {
            depositAmount: Number(depositAmount.toFixed(2)),
            depositCurrency: safeCurrency.toUpperCase(),
            depositPaymentUrl: appointment.depositCheckoutUrl,
            depositCheckoutSessionId: appointment.depositCheckoutSessionId
        }
    });

    return {
        appointmentId: String(appointment.id),
        amount: Number(depositAmount.toFixed(2)),
        currency: safeCurrency.toUpperCase(),
        paymentUrl: appointment.depositCheckoutUrl,
        checkoutSessionId: appointment.depositCheckoutSessionId,
        status: appointment.depositStatus,
        notification: notificationResult
    };
};

const refreshAppointmentDepositStatus = async ({ appointmentId, tenantEmail, dialedNumber, ownerPhone, actor }) => {
    const tenantUser = await resolveTenantUserForOperation({ actor, tenantEmail, dialedNumber, ownerPhone });
    ensureTenantForAutomation({ actor, tenantUser });

    const where = { id: appointmentId };
    if (tenantUser?.id) {
        where.userId = tenantUser.id;
    }

    const appointment = await Appointment.findOne({ where });
    if (!appointment) {
        return null;
    }

    if (!appointment.depositCheckoutSessionId) {
        return {
            appointmentId: String(appointment.id),
            status: appointment.depositStatus || 'None',
            paymentStatus: 'not_requested'
        };
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(String(appointment.depositCheckoutSessionId));
    const paymentStatus = String(session?.payment_status || 'unpaid');

    const previousDepositStatus = appointment.depositStatus || 'None';
    if (paymentStatus === 'paid') {
        appointment.depositStatus = 'Paid';
        appointment.depositPaidAmount = Number(appointment.depositRequiredAmount || 0);
        appointment.depositPaidAt = appointment.depositPaidAt || new Date();
        await appointment.save();

        if (previousDepositStatus !== 'Paid') {
            const contact = await AppointmentContact.findOne({ where: { appointmentId: appointment.id } });

            await AutomationEvent.create({
                source: 'system',
                eventType: 'appointment.deposit.paid',
                idempotencyKey: `appointment_deposit_paid_${appointment.id}_${Date.now()}`,
                tenantEmail: tenantUser?.email || tenantEmail || '',
                occurredAt: new Date(),
                payload: {
                    appointmentId: appointment.id,
                    userId: appointment.userId,
                    amount: Number(appointment.depositPaidAmount || 0),
                    currency: String(appointment.depositCurrency || DEFAULT_STRIPE_CURRENCY).toUpperCase(),
                    checkoutSessionId: appointment.depositCheckoutSessionId,
                    paymentStatus
                },
                status: 'processed',
                processedAt: new Date()
            });

            await triggerManualAppointmentNotification({
                appointment,
                contact,
                tenantUser,
                tenantEmail,
                ownerPhone,
                action: 'deposit_paid',
                previousStatus: previousDepositStatus,
                extraPayload: {
                    depositAmount: Number(appointment.depositPaidAmount || 0),
                    depositCurrency: String(appointment.depositCurrency || DEFAULT_STRIPE_CURRENCY).toUpperCase(),
                    depositPaymentUrl: appointment.depositCheckoutUrl || '',
                    depositCheckoutSessionId: appointment.depositCheckoutSessionId || ''
                }
            });
        }
    } else if (appointment.depositStatus === 'None') {
        appointment.depositStatus = 'Requested';
        await appointment.save();
    }

    return {
        appointmentId: String(appointment.id),
        status: appointment.depositStatus,
        paymentStatus,
        deposit: serializeAppointmentDeposit(appointment)
    };
};

const getFeatureToggles = async ({ actor }) => {
    const accountKey = actor?.id ? `user_${actor.id}` : 'default';
    const configRow = await ensureFeatureToggleConfig(accountKey);
    return configRow.config;
};

const updateFeatureToggles = async ({ actor, nextConfig }) => {
    const accountKey = actor?.id ? `user_${actor.id}` : 'default';
    const configRow = await ensureFeatureToggleConfig(accountKey);
    const merged = {
        ...cloneDefaultToggles(),
        ...nextConfig
    };

    if (!merged.reportingAndAlerts) {
        merged.reportingAndAlerts = {};
    }
    merged.reportingAndAlerts.usageAlert70Percent = {
        enabled: true,
        locked: true
    };

    configRow.config = merged;
    await configRow.save();
    return configRow.config;
};

const getBillingInfo = async ({ email, actor } = {}) => {
    const user = await resolveUserByEmail(email, actor);
    const [plans, userInvoices, callsCount] = await Promise.all([
        ensureSubscriptionPlans(),
        Invoice.findAll({ where: user ? { userId: user.id } : undefined, order: [['issuedAt', 'DESC']] }),
        CallLog.count()
    ]);
    const invoices = userInvoices.length > 0 ? userInvoices : await Invoice.findAll({ order: [['issuedAt', 'DESC']] });

    const activePlanName = user?.plan || 'Trial';
    const currentPlan = plans.find((plan) => plan.name === activePlanName) || plans[0] || null;
    const hasActiveReferralBonus = Boolean(
        user?.referralBonusExpiresAt && new Date(user.referralBonusExpiresAt) > new Date()
    );

    return {
        currentPlan: currentPlan
            ? {
                  name: currentPlan.name,
                  price: currentPlan.price,
                  calls: currentPlan.callsLimit,
                  current: true
              }
            : null,
        callsUsed: callsCount,
        callsLimit: currentPlan ? currentPlan.callsLimit : 200,
        nextBillingDate: dateFormatter.format(new Date(new Date().setDate(new Date().getDate() + 30))),
        plans: plans
            .filter((plan) => plan.name !== 'Trial')
            .map((plan) => ({
            name: plan.name,
            price: plan.price,
            calls: plan.callsLimit,
            current: currentPlan ? plan.name === currentPlan.name : false
        })),
        referralBonus: {
            minutes: hasActiveReferralBonus ? user.referralBonusMinutes : 0,
            expiresAt: hasActiveReferralBonus ? user.referralBonusExpiresAt : null,
            referralCode: user?.referralCode || ''
        },
        invoices: invoices.map((invoice) => ({
            id: invoice.invoiceNumber,
            date: dateFormatter.format(new Date(invoice.issuedAt)),
            amount: `GBP ${Number(invoice.amount).toFixed(2)}`,
            status: invoice.status
        }))
    };
};

const purchasePlan = async ({ email, planName, actor }) => {
    const user = await resolveUserByEmail(email, actor);
    if (!user) {
        throw new Error('User not found for purchase');
    }

    await ensureSubscriptionPlans();
    const plan = await SubscriptionPlan.findOne({ where: { name: planName } });
    if (!plan) {
        throw new Error('Plan not found');
    }

    return finalizePaidPlanPurchase({ user, plan });
};

const createStripeCheckoutSession = async ({ email, planName, actor, origin }) => {
    const user = await resolveUserByEmail(email, actor);
    if (!user) {
        throw new Error('User not found for checkout');
    }

    await ensureSubscriptionPlans();
    const plan = await SubscriptionPlan.findOne({ where: { name: planName } });
    if (!plan) {
        throw new Error('Plan not found');
    }

    if (Number(plan.price) <= 0) {
        const freeResult = await finalizePaidPlanPurchase({ user, plan, paymentReference: `manual_free_${Date.now()}` });
        return {
            mode: 'free',
            url: '',
            sessionId: '',
            ...freeResult
        };
    }

    const stripe = getStripeClient();
    const customerId = await getOrCreateStripeCustomerId(user, stripe);
    const frontendBase = getFrontendBaseUrl(origin);

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
            {
                price_data: {
                    currency: DEFAULT_STRIPE_CURRENCY,
                    product_data: {
                        name: `${plan.name} Plan`,
                        description: `${plan.callsLimit} calls per month`
                    },
                    recurring: {
                        interval: 'month'
                    },
                    unit_amount: Math.round(Number(plan.price) * 100)
                },
                quantity: 1
            }
        ],
        metadata: {
            planName: plan.name,
            userId: String(user.id),
            userEmail: user.email
        },
        success_url: `${frontendBase}/dashboard/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendBase}/dashboard/billing?checkout=cancel`
    });

    return {
        mode: 'stripe',
        url: session.url || '',
        sessionId: session.id
    };
};

const confirmStripeCheckoutSession = async ({ sessionId, email, actor }) => {
    const safeSessionId = String(sessionId || '').trim();
    if (!safeSessionId) {
        throw new Error('sessionId is required');
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(safeSessionId);
    if (!session) {
        throw new Error('Checkout session not found');
    }

    if (session.payment_status !== 'paid') {
        throw new Error('Payment is not completed yet');
    }

    const sessionPlanName = String(session.metadata?.planName || '').trim();
    if (!sessionPlanName) {
        throw new Error('Paid session does not contain plan metadata');
    }

    const metadataUserId = Number(session.metadata?.userId || 0);
    let user = null;
    if (metadataUserId) {
        user = await User.findByPk(metadataUserId);
    }

    if (!user) {
        user = await resolveUserByEmail(email || session.metadata?.userEmail || '', actor);
    }

    if (!user) {
        throw new Error('User not found for checkout confirmation');
    }

    await ensureSubscriptionPlans();
    const plan = await SubscriptionPlan.findOne({ where: { name: sessionPlanName } });
    if (!plan) {
        throw new Error('Plan not found for checkout confirmation');
    }

    const purchaseResult = await finalizePaidPlanPurchase({
        user,
        plan,
        paymentReference: safeSessionId
    });

    return {
        ...purchaseResult,
        sessionId: safeSessionId,
        paymentStatus: session.payment_status
    };
};

const processStripeCheckoutSessionWebhook = async ({ session, eventType }) => {
    if (!session || session.object !== 'checkout.session') {
        return;
    }

    const metadata = session.metadata || {};
    const paymentType = String(metadata.paymentType || '').trim().toLowerCase();

    if (paymentType === 'appointment_deposit') {
        const appointmentId = String(metadata.appointmentId || '').trim();
        if (!appointmentId) {
            return;
        }

        if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
            const appointment = await Appointment.findByPk(Number(appointmentId));
            const actor = appointment?.userId ? { id: appointment.userId } : undefined;
            await refreshAppointmentDepositStatus({ appointmentId, actor });
            return;
        }

        if (eventType === 'checkout.session.async_payment_failed' || eventType === 'checkout.session.expired') {
            const appointment = await Appointment.findByPk(Number(appointmentId));
            if (!appointment || appointment.depositStatus === 'Paid') {
                return;
            }

            appointment.depositStatus = 'Failed';
            await appointment.save();
        }

        return;
    }

    const planName = String(metadata.planName || '').trim();
    if (!planName) {
        return;
    }

    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
        const metadataUserId = Number(metadata.userId || 0);
        const actor = metadataUserId > 0 ? { id: metadataUserId } : undefined;
        await confirmStripeCheckoutSession({
            sessionId: session.id,
            email: String(metadata.userEmail || ''),
            actor
        });
    }
};

const processStripeWebhook = async ({ rawBody, signature }) => {
    const event = buildStripeWebhookEvent({ rawBody, signature });
    const eventType = String(event.type || '').trim();

    if (eventType.startsWith('checkout.session.')) {
        await processStripeCheckoutSessionWebhook({
            session: event.data?.object,
            eventType
        });
    }

    return {
        received: true,
        eventType
    };
};

const getPaymentMethodUpdateUrl = async ({ email, actor, origin }) => {
    const user = await resolveUserByEmail(email, actor);
    if (!user) {
        throw new Error('User not found for billing portal');
    }

    try {
        const stripe = getStripeClient();
        const customerId = await getOrCreateStripeCustomerId(user, stripe);
        const frontendBase = getFrontendBaseUrl(origin);
        const portal = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${frontendBase}/dashboard/billing`
        });

        return {
            url: portal.url,
            provider: 'portal'
        };
    } catch (error) {
        if (error.code !== 'STRIPE_NOT_CONFIGURED') {
            throw error;
        }
    }

    const portalBase = String(BILLING_PORTAL_URL || '').trim();
    if (portalBase) {
        const separator = portalBase.includes('?') ? '&' : '?';
        return {
            url: `${portalBase}${separator}email=${encodeURIComponent(user.email)}`,
            provider: 'portal'
        };
    }

    return {
        url: '',
        provider: 'unavailable',
        message: 'Payment portal is not configured yet. Set STRIPE_SECRET_KEY (recommended) or BILLING_PORTAL_URL in backend .env.'
    };
};

const getReferralOverview = async ({ email, actor }) => {
    const user = await resolveUserByEmail(email, actor);
    if (!user) {
        throw new Error('User not found for referral overview');
    }

    const referredUsers = await User.findAll({
        where: {
            referredByCode: user.referralCode
        },
        order: [['createdAt', 'DESC']]
    });

    const awards = await ReferralBonusAward.findAll({
        where: { referrerUserId: user.id }
    });
    const awardMap = new Map(awards.map((award) => [award.referredUserId, award]));

    return {
        referralCode: user.referralCode,
        referralBonusMinutes: user.referralBonusMinutes || 0,
        referralBonusExpiresAt: user.referralBonusExpiresAt,
        referredUsers: referredUsers.map((referredUser) => {
            const award = awardMap.get(referredUser.id);
            return {
                id: String(referredUser.id),
                name: referredUser.username,
                email: referredUser.email,
                businessName: referredUser.businessName,
                plan: referredUser.plan,
                status: referredUser.status,
                joinedAt: dateFormatter.format(new Date(referredUser.createdAt)),
                joinedVia: referredUser.referredByMethod || 'code',
                bonusAwardedMinutes: award ? award.minutesAwarded : 0,
                bonusExpiresAt: award ? award.expiresAt : null
            };
        })
    };
};

const getAdminOverview = async () => {
    const [totalUsers, activeSubscriptions, monthlyRevenue, totalCalls] = await Promise.all([
        User.count({ where: { role: 'user' } }),
        User.count({ where: { role: 'user', status: 'Active' } }),
        Invoice.sum('amount') || 0,
        CallLog.count()
    ]);

    const last6Months = [];
    const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });

    for (let i = 5; i >= 0; i -= 1) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const month = monthFormatter.format(date);
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

        const sum =
            (await Invoice.sum('amount', {
                where: {
                    issuedAt: {
                        [Op.between]: [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
                    }
                }
            })) || 0;

        last6Months.push({ month, revenue: Number(sum) });
    }

    return {
        totalUsers,
        activeSubscriptions,
        monthlyRevenue: Number(monthlyRevenue),
        totalCalls,
        growth: { users: 12.4, revenue: 8.7, calls: 23.1 },
        revenueData: last6Months
    };
};

const getAdminUsers = async () => {
    const users = await User.findAll({
        where: { role: 'user' },
        order: [['createdAt', 'DESC']]
    });

    return users.map((user) => ({
        id: String(user.id),
        name: user.username,
        email: user.email,
        business: user.businessName || 'N/A',
        plan: user.plan,
        status: user.status,
        calls: user.callsUsed,
        joined: dateFormatter.format(new Date(user.createdAt))
    }));
};

const getAdminSubscriptions = async () => {
    const [plans, users] = await Promise.all([
        SubscriptionPlan.findAll({ order: [['price', 'ASC']] }),
        User.findAll({ where: { role: 'user' } })
    ]);

    const planCounts = users.reduce((acc, user) => {
        const key = user.plan || 'Trial';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const chartColors = {
        Rise: 'bg-primary/40',
        Elevate: 'bg-primary/70',
        Apex: 'bg-primary'
    };

    const planRows = plans.map((plan) => ({
        name: plan.name,
        count: planCounts[plan.name] || 0,
        revenue: (planCounts[plan.name] || 0) * plan.price,
        color: chartColors[plan.name] || 'bg-muted'
    }));

    const totalSubscribers = users.filter((user) => user.status === 'Active').length;
    const monthlyRevenue = planRows.reduce((sum, row) => sum + row.revenue, 0);

    return {
        summary: {
            totalSubscribers,
            monthlyRevenue,
            avgRevenuePerUser: totalSubscribers > 0 ? monthlyRevenue / totalSubscribers : 0
        },
        plans: planRows
    };
};

const getAdminAnalytics = async () => {
    const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });

    const callData = [];
    for (let i = 5; i >= 0; i -= 1) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const month = monthFormatter.format(date);
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

        const calls = await CallLog.count({
            where: {
                callTime: {
                    [Op.between]: [start, end]
                }
            }
        });

        callData.push({ month, calls });
    }

    const totalCalls = await CallLog.count();

    const sentimentCounts = await Promise.all([
        CallLog.count({ where: { sentiment: 'Positive' } }),
        CallLog.count({ where: { sentiment: 'Neutral' } }),
        CallLog.count({ where: { sentiment: 'Negative' } })
    ]);

    const [positive, neutral, negative] = sentimentCounts;
    const safeTotal = totalCalls || 1;

    return {
        callData,
        sentimentData: [
            { name: 'Positive', value: Math.round((positive / safeTotal) * 100), color: 'hsl(160 84% 39%)' },
            { name: 'Neutral', value: Math.round((neutral / safeTotal) * 100), color: 'hsl(239 84% 67%)' },
            { name: 'Negative', value: Math.round((negative / safeTotal) * 100), color: 'hsl(0 84% 60%)' }
        ]
    };
};

module.exports = {
    getDashboardOverview,
    getCalls,
    getAppointments,
    generateManualDailySummary,
    getDailySummaryHistory,
    getProfile,
    updateProfile,
    getKnowledgeBaseEntries,
    createKnowledgeBaseEntry,
    deleteKnowledgeBaseEntry,
    createAppointment,
    getAppointmentAvailability,
    updateAppointmentStatus,
    cancelAppointment,
    rescheduleAppointment,
    createAppointmentDepositCheckoutSession,
    refreshAppointmentDepositStatus,
    getFeatureToggles,
    updateFeatureToggles,
    getAiReceptionistConfig,
    updateAiReceptionistConfig,
    getBillingInfo,
    purchasePlan,
    createStripeCheckoutSession,
    confirmStripeCheckoutSession,
    processStripeWebhook,
    getPaymentMethodUpdateUrl,
    getReferralOverview,
    getAdminOverview,
    getAdminUsers,
    getAdminSubscriptions,
    getAdminAnalytics
};
