const bcrypt = require('bcryptjs');
const { sequelize, ensureDefaultAdmin } = require('../config/db');
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
    Invoice
} = require('../models');
const { defaultFeatureToggles } = require('../constants/feature-toggles');

const usersSeed = [
    {
        username: 'Sarah Johnson',
        email: 'sarah@acme.com',
        password: 'Password@123',
        role: 'user',
        businessName: 'Acme Corp',
        inboundNumber: '+15550001001',
        ownerPhone: '+15550002001',
        timezone: 'America/New_York',
        billingAnniversaryDay: 15,
        plan: 'Pro',
        status: 'Active',
        callsUsed: 450,
        referralCode: 'SARAH1001'
    },
    {
        username: 'Michael Chen',
        email: 'm.chen@techflow.io',
        password: 'Password@123',
        role: 'user',
        businessName: 'TechFlow',
        inboundNumber: '+15550001002',
        ownerPhone: '+15550002002',
        timezone: 'America/Chicago',
        billingAnniversaryDay: 12,
        plan: 'Core',
        status: 'Active',
        callsUsed: 189,
        referralCode: 'MICHA1002',
        referredByCode: 'SARAH1001'
    },
    {
        username: 'Emma Williams',
        email: 'emma@beauspa.com',
        password: 'Password@123',
        role: 'user',
        businessName: 'Beau Spa',
        inboundNumber: '+15550001003',
        ownerPhone: '+15550002003',
        timezone: 'Europe/London',
        billingAnniversaryDay: 20,
        plan: 'Starter',
        status: 'Active',
        callsUsed: 67,
        referralCode: 'EMMAW1003'
    },
    {
        username: 'James Martinez',
        email: 'j.martinez@lawfirm.com',
        password: 'Password@123',
        role: 'user',
        businessName: 'Martinez Law',
        inboundNumber: '+15550001004',
        ownerPhone: '+15550002004',
        timezone: 'America/Los_Angeles',
        billingAnniversaryDay: 8,
        plan: 'Scale',
        status: 'Suspended',
        callsUsed: 1100,
        referralCode: 'JAMES1004'
    },
    {
        username: 'Lisa Thompson',
        email: 'lisa@dentalcare.com',
        password: 'Password@123',
        role: 'user',
        businessName: 'DentalCare Plus',
        inboundNumber: '+15550001005',
        ownerPhone: '+15550002005',
        timezone: 'Europe/London',
        billingAnniversaryDay: 5,
        plan: 'Pro',
        status: 'Active',
        callsUsed: 398,
        referralCode: 'LISAT1005'
    }
];

const callsSeed = [
    {
        callerNumber: '+1 (555) 234-5678',
        callTime: '2026-03-15T10:24:00.000Z',
        durationSeconds: 222,
        sentiment: 'Positive',
        status: 'Completed',
        transcript: 'Customer inquired about appointment scheduling and booked a consultation.'
    },
    {
        callerNumber: '+1 (555) 876-5432',
        callTime: '2026-03-15T11:10:00.000Z',
        durationSeconds: 75,
        sentiment: 'Neutral',
        status: 'Escalated',
        transcript: 'Customer requested to speak with a human agent regarding account limits.'
    },
    {
        callerNumber: '+1 (555) 345-6789',
        callTime: '2026-03-15T14:05:00.000Z',
        durationSeconds: 330,
        sentiment: 'Positive',
        status: 'Completed',
        transcript: 'Appointment booked for next week, including reminder preference details.'
    },
    {
        callerNumber: '+1 (555) 901-2345',
        callTime: '2026-03-14T09:45:00.000Z',
        durationSeconds: 45,
        sentiment: 'Negative',
        status: 'Missed',
        transcript: 'Caller disconnected before the AI assistant completed verification.'
    },
    {
        callerNumber: '+1 (555) 678-9012',
        callTime: '2026-03-14T15:30:00.000Z',
        durationSeconds: 252,
        sentiment: 'Positive',
        status: 'Completed',
        transcript: 'Customer asked about service pricing and requested a quote by email.'
    },
    {
        callerNumber: '+1 (555) 456-7890',
        callTime: '2026-03-13T13:20:00.000Z',
        durationSeconds: 175,
        sentiment: 'Neutral',
        status: 'Completed',
        transcript: 'Follow-up call regarding a previous booking and parking instructions.'
    }
];

const appointmentsSeed = [
    { caller: 'Sarah Johnson', appointmentDate: '2026-03-20', appointmentTime: '2:00 PM', type: 'Consultation', status: 'Confirmed' },
    { caller: 'Mark Davis', appointmentDate: '2026-03-21', appointmentTime: '10:30 AM', type: 'Follow-up', status: 'Pending' },
    { caller: 'Amy Wilson', appointmentDate: '2026-03-22', appointmentTime: '4:00 PM', type: 'Service', status: 'Confirmed' },
    { caller: 'Robert Lee', appointmentDate: '2026-03-18', appointmentTime: '11:00 AM', type: 'Consultation', status: 'Completed' }
];

const knowledgeBaseSeed = [
    { title: 'Business Hours', content: 'We are open Monday-Friday 9AM-6PM, Saturday 10AM-4PM.', category: 'General' },
    { title: 'Appointment Policy', content: 'Appointments can be booked up to 30 days in advance. 24-hour cancellation required.', category: 'Appointments' },
    { title: 'Service Pricing', content: 'Basic consultation starts at $99. Full service packages from $299.', category: 'Pricing' },
    { title: 'Cancellation Policy', content: 'Full refund if cancelled 48+ hours in advance. 50% refund within 24-48 hours.', category: 'Policies' }
];

const plansSeed = [
    { name: 'Free', price: 0, callsLimit: 0, concurrentLimit: 0 },
    { name: 'Starter', price: 29, callsLimit: 75, concurrentLimit: 5 },
    { name: 'Core', price: 79, callsLimit: 200, concurrentLimit: 10 },
    { name: 'Pro', price: 149, callsLimit: 500, concurrentLimit: 20 },
    { name: 'Scale', price: 299, callsLimit: 1200, concurrentLimit: 50 }
];

const invoicesSeed = [
    { invoiceNumber: 'INV-2026-003', issuedAt: '2026-03-15', amount: 79, status: 'Paid', planName: 'Core' },
    { invoiceNumber: 'INV-2026-002', issuedAt: '2026-02-15', amount: 79, status: 'Paid', planName: 'Core' },
    { invoiceNumber: 'INV-2026-001', issuedAt: '2026-01-15', amount: 79, status: 'Paid', planName: 'Core' },
    { invoiceNumber: 'INV-2025-012', issuedAt: '2025-12-15', amount: 29, status: 'Paid', planName: 'Starter' }
];

const seedUsers = async () => {
    const count = await User.count({ where: { role: 'user' } });
    if (count > 0) {
        return;
    }

    for (const user of usersSeed) {
        const password = await bcrypt.hash(user.password, 10);
        await User.create({ ...user, password });
    }
};

const createIfEmpty = async (model, data) => {
    const count = await model.count();
    if (count === 0) {
        await model.bulkCreate(data);
    }
};

const seedInvoices = async () => {
    const count = await Invoice.count();
    if (count > 0) {
        return;
    }

    const users = await User.findAll({ where: { role: 'user' }, order: [['id', 'ASC']] });
    const fallbackUserId = users[0]?.id || null;

    await Invoice.bulkCreate(
        invoicesSeed.map((inv, idx) => ({
            ...inv,
            userId: users[idx % Math.max(users.length, 1)]?.id || fallbackUserId
        }))
    );
};

const seedCallContacts = async () => {
    const callLogs = await CallLog.findAll({ order: [['id', 'ASC']] });
    if (callLogs.length === 0) {
        return;
    }

    const existing = await CallContact.count();
    if (existing > 0) {
        return;
    }

    const contacts = [
        { name: 'Sarah Johnson', email: 'sarah.johnson@example.com' },
        { name: 'Mark Davis', email: 'mark.davis@example.com' },
        { name: 'Amy Wilson', email: 'amy.wilson@example.com' },
        { name: 'Robert Lee', email: 'robert.lee@example.com' },
        { name: 'Nina Brooks', email: 'nina.brooks@example.com' },
        { name: 'Daniel Kim', email: 'daniel.kim@example.com' }
    ];

    await CallContact.bulkCreate(
        callLogs.map((call, idx) => ({
            callLogId: call.id,
            name: contacts[idx % contacts.length].name,
            phone: call.callerNumber,
            email: contacts[idx % contacts.length].email
        }))
    );
};

const seedAppointmentContacts = async () => {
    const appointments = await Appointment.findAll({ order: [['id', 'ASC']] });
    if (appointments.length === 0) {
        return;
    }

    const existing = await AppointmentContact.count();
    if (existing > 0) {
        return;
    }

    await AppointmentContact.bulkCreate(
        appointments.map((appointment, idx) => ({
            appointmentId: appointment.id,
            name: appointment.caller,
            phone: `+1 (555) 000-${String(2000 + idx)}`,
            email: `${appointment.caller.toLowerCase().replace(/\s+/g, '.')}@example.com`
        }))
    );
};

const seedKnowledgeBaseAttachments = async () => {
    const entries = await KnowledgeBaseEntry.findAll({ order: [['id', 'ASC']] });
    if (entries.length === 0) {
        return;
    }

    const existing = await KnowledgeBaseAttachment.count();
    if (existing > 0) {
        return;
    }

    await KnowledgeBaseAttachment.create({
        knowledgeBaseEntryId: entries[0].id,
        fileName: 'business-hours.pdf',
        fileDataUrl: 'data:text/plain;base64,SGVsbG8sIHRoaXMgaXMgYSBkZW1vIGF0dGFjaG1lbnQgZm9yIHRoZSBrbm93bGVkZ2UgYmFzZS4='
    });
};

const seedFeatureToggles = async () => {
    const count = await FeatureToggleConfig.count();
    if (count > 0) {
        return;
    }

    await FeatureToggleConfig.create({
        accountKey: 'default',
        config: JSON.parse(JSON.stringify(defaultFeatureToggles))
    });
};

const runSeed = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ force: true });
        await ensureDefaultAdmin();

        await createIfEmpty(SubscriptionPlan, plansSeed);
        await seedUsers();
        await createIfEmpty(CallLog, callsSeed);
        await createIfEmpty(Appointment, appointmentsSeed);
        await createIfEmpty(KnowledgeBaseEntry, knowledgeBaseSeed);
        await seedCallContacts();
        await seedAppointmentContacts();
        await seedKnowledgeBaseAttachments();
        await seedFeatureToggles();
        await seedInvoices();

        console.log('Database seed complete.');
    } catch (error) {
        console.error('Failed to seed database:', error);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
};

runSeed();
