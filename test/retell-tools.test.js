const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-retell-tools-'));
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'tools.sqlite');
process.env.DB_LOGGING = 'false';
process.env.N8N_MANUAL_APPOINTMENT_WEBHOOK_URL = '';

const { sequelize } = require('../src/config/db');
const {
    User,
    Appointment,
    AppointmentContact,
    KnowledgeBaseEntry
} = require('../src/models');
const {
    handleInboundCall,
    executeRetellTool
} = require('../src/services/retell-integration.service');

let tenantA;
let tenantB;
let tenantBAppointment;

const caller = '+447700900001';
const dateAfter = (days) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const functionRequest = (name, tenant, args = {}, callId = `call_${name}`) => ({
    name,
    call: {
        call_id: callId,
        from_number: caller,
        to_number: tenant.inboundNumber,
        metadata: { tenantId: String(tenant.id) }
    },
    args,
    callId,
    fromNumber: caller,
    toNumber: tenant.inboundNumber,
    metadata: { tenantId: String(tenant.id) }
});

test.before(async () => {
    await sequelize.sync({ force: true });
    tenantA = await User.create({
        username: 'tools-tenant-a',
        email: 'tools-a@example.test',
        password: 'test-only',
        businessName: 'Tenant A Travel',
        inboundNumber: '+447700900002',
        ownerPhone: '+447700900010',
        timezone: 'Europe/London',
        plan: 'Core',
        retellAgentId: 'agent_tenant_a',
        receptionistName: 'Ava',
        receptionistCustomGreeting: 'Welcome to Tenant A Travel',
        receptionistStatus: 'live'
    });
    tenantB = await User.create({
        username: 'tools-tenant-b',
        email: 'tools-b@example.test',
        password: 'test-only',
        businessName: 'Tenant B Private Travel',
        inboundNumber: '+447700900003',
        ownerPhone: '+447700900011',
        timezone: 'Europe/London',
        plan: 'Core',
        retellAgentId: 'agent_tenant_b',
        receptionistStatus: 'live'
    });

    await KnowledgeBaseEntry.bulkCreate([
        { userId: tenantA.id, title: 'Opening hours', content: 'Tenant A answer: open from nine until five.' },
        { userId: tenantB.id, title: 'Opening hours', content: 'Tenant B secret: private opening schedule.' }
    ]);

    tenantBAppointment = await Appointment.create({
        userId: tenantB.id,
        inboundNumber: tenantB.inboundNumber,
        caller: 'Tenant B Customer',
        appointmentDate: dateAfter(10),
        appointmentTime: '10:00',
        type: 'Consultation',
        status: 'Confirmed'
    });
    await AppointmentContact.create({
        appointmentId: tenantBAppointment.id,
        name: 'Tenant B Customer',
        phone: caller,
        email: 'customer-b@example.test'
    });
});

test.after(async () => {
    await sequelize.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('inbound number selects only its matching tenant agent and variables', async () => {
    const result = await handleInboundCall({
        event: 'call_inbound',
        fromNumber: caller,
        toNumber: tenantA.inboundNumber
    }, { preflightKey: 'inbound_tenant_a' });

    assert.equal(result.call_inbound.override_agent_id, 'agent_tenant_a');
    assert.equal(result.call_inbound.dynamic_variables.business_name, 'Tenant A Travel');
    assert.equal(result.call_inbound.metadata.tenantId, String(tenantA.id));
});

test('unknown inbound number is rejected without a default tenant fallback', async () => {
    const result = await handleInboundCall({
        event: 'call_inbound',
        fromNumber: caller,
        toNumber: '+447700900004'
    }, { preflightKey: 'inbound_unknown' });

    assert.deepEqual(result, { call_inbound: { reject: true } });
});

test('business information search cannot return another tenant knowledge', async () => {
    const result = await executeRetellTool(functionRequest(
        'get_business_information',
        tenantA,
        { query: 'opening hours' }
    ));

    assert.equal(result.ok, true);
    assert.match(result.message, /tenant a answer/i);
    assert.doesNotMatch(result.message, /tenant b secret/i);
});

test('a cross-tenant appointment id cannot be cancelled', async () => {
    const result = await executeRetellTool(functionRequest(
        'cancel_appointment',
        tenantA,
        { appointment_id: String(tenantBAppointment.id), reason: 'Attack attempt' }
    ));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'APPOINTMENT_NOT_FOUND');
    await tenantBAppointment.reload();
    assert.equal(tenantBAppointment.status, 'Confirmed');
});

test('booking retries are idempotent and upcoming lookup stays tenant-scoped', async () => {
    const request = functionRequest('book_appointment', tenantA, {
        customer_name: 'Test Caller',
        customer_phone: caller,
        customer_email: 'caller@example.test',
        date: dateAfter(12),
        time: '14:00',
        service_type: 'Travel planning'
    }, 'call_booking_retry');

    const first = await executeRetellTool(request);
    const retry = await executeRetellTool(request);
    const upcoming = await executeRetellTool(functionRequest(
        'find_upcoming_appointments',
        tenantA,
        {},
        'call_upcoming'
    ));

    assert.equal(first.ok, true);
    assert.equal(retry.data.appointment.id, first.data.appointment.id);
    assert.equal(await Appointment.count({ where: { userId: tenantA.id } }), 1);
    assert.equal(upcoming.data.appointments.length, 1);
    assert.equal(upcoming.data.appointments[0].id, first.data.appointment.id);
});

test('availability, reschedule, and cancel tools reuse tenant appointment rules', async () => {
    const availability = await executeRetellTool(functionRequest(
        'check_appointment_availability',
        tenantA,
        { date: dateAfter(13) },
        'call_availability'
    ));
    const booking = await executeRetellTool(functionRequest('book_appointment', tenantA, {
        customer_name: 'Lifecycle Caller',
        customer_phone: caller,
        date: dateAfter(14),
        time: '11:00'
    }, 'call_lifecycle_booking'));
    const appointmentId = booking.data.appointment.id;
    const rescheduled = await executeRetellTool(functionRequest('reschedule_appointment', tenantA, {
        appointment_id: appointmentId,
        new_date: dateAfter(15),
        new_time: '12:00'
    }, 'call_lifecycle_reschedule'));
    const cancelled = await executeRetellTool(functionRequest('cancel_appointment', tenantA, {
        appointment_id: appointmentId,
        reason: 'Caller requested cancellation'
    }, 'call_lifecycle_cancel'));

    assert.equal(availability.ok, true);
    assert.ok(availability.data.availableSlots.length > 0);
    assert.equal(rescheduled.data.appointment.time, '12:00');
    assert.equal(cancelled.data.appointment.status, 'Cancelled');
});

test('metadata tenant mismatch is rejected even when the called number is valid', async () => {
    const request = functionRequest('get_business_information', tenantA, { query: 'hours' });
    request.metadata.tenantId = String(tenantB.id);
    request.call.metadata.tenantId = String(tenantB.id);

    const result = await executeRetellTool(request);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TENANT_MISMATCH');
});
