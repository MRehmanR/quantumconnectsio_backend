const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Op } = require('sequelize');

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
const dashboardDataService = require('../src/services/dashboard-data.service');

let tenantA;
let tenantB;
let tenantBAppointment;
let anotherCallerAppointment;

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

    anotherCallerAppointment = await Appointment.create({
        userId: tenantA.id,
        inboundNumber: tenantA.inboundNumber,
        caller: 'Another Tenant A Customer',
        appointmentDate: dateAfter(11),
        appointmentTime: '09:30',
        type: 'Consultation',
        status: 'Confirmed'
    });
    await AppointmentContact.create({
        appointmentId: anotherCallerAppointment.id,
        name: 'Another Tenant A Customer',
        phone: '+447700900099',
        email: 'another-a@example.test'
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

test('scheduled receptionist hours are evaluated in the tenant timezone', () => {
    const scheduledTenant = {
        receptionistStatus: 'scheduled',
        receptionistScheduleMode: 'custom',
        timezone: 'America/New_York',
        receptionistWeeklySchedule: JSON.stringify([
            { day: 'monday', enabled: true, start: '09:00', end: '17:00' }
        ])
    };

    assert.equal(
        dashboardDataService.isReceptionistActiveForUser(scheduledTenant, new Date('2026-08-17T13:30:00.000Z')),
        true
    );
    assert.equal(
        dashboardDataService.isReceptionistActiveForUser(scheduledTenant, new Date('2026-08-17T22:00:00.000Z')),
        false
    );
});

test('appointment availability follows the requested weekday schedule and booking interval', async () => {
    const targetDate = dateAfter(30);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
    }).format(new Date(`${targetDate}T12:00:00.000Z`)).toLowerCase();
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: false, start: '10:00', end: '12:00' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '45 minutes', buffer: '15 minutes' });
    await tenantA.save();

    const unavailable = await dashboardDataService.getAppointmentAvailability({
        date: targetDate,
        tenantEmail: tenantA.email,
        dialedNumber: tenantA.inboundNumber
    });
    assert.equal(unavailable.fullyBooked, true);
    assert.deepEqual(unavailable.availableSlots, []);

    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: true, start: '10:00', end: '12:00' }
    ]);
    await tenantA.save();
    const available = await dashboardDataService.getAppointmentAvailability({
        date: targetDate,
        tenantEmail: tenantA.email,
        dialedNumber: tenantA.inboundNumber
    });
    assert.deepEqual(available.availableSlots, ['10:00', '11:00']);
    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
});

test('call booking rejects slots outside tenant booking hours', async () => {
    const targetDate = dateAfter(40);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
    }).format(new Date(`${targetDate}T12:00:00.000Z`)).toLowerCase();
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: true, start: '09:00', end: '11:00' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '30 minutes', buffer: '0 minutes' });
    await tenantA.save();

    const result = await executeRetellTool(functionRequest('book_appointment', tenantA, {
        customer_name: 'Outside Hours Caller',
        customer_phone: caller,
        date: targetDate,
        time: '12:00'
    }, 'call_outside_booking_hours'));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SLOT_UNAVAILABLE');
    assert.match(result.message, /available|hours|notice/i);
    assert.equal(await Appointment.count({
        where: {
            userId: tenantA.id,
            appointmentDate: targetDate,
            appointmentTime: '12:00',
            status: { [Op.in]: ['Pending', 'Confirmed'] }
        }
    }), 0);

    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
});

test('call booking rejects slots before the tenant minimum notice window', async () => {
    const targetDate = dateAfter(1);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
    }).format(new Date(`${targetDate}T12:00:00.000Z`)).toLowerCase();
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: true, start: '00:00', end: '23:59' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '30 minutes', buffer: '0 minutes', minNotice: '48 hours' });
    await tenantA.save();

    const result = await executeRetellTool(functionRequest('book_appointment', tenantA, {
        customer_name: 'Too Soon Caller',
        customer_phone: caller,
        date: targetDate,
        time: '23:00'
    }, 'call_min_notice_booking'));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SLOT_UNAVAILABLE');
    assert.match(result.message, /available|hours|notice/i);
    assert.equal(await Appointment.count({
        where: {
            userId: tenantA.id,
            appointmentDate: targetDate,
            appointmentTime: '23:00',
            status: { [Op.in]: ['Pending', 'Confirmed'] }
        }
    }), 0);

    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
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

test('a caller cannot reschedule or cancel another caller appointment in the same tenant', async () => {
    const reschedule = await executeRetellTool(functionRequest(
        'reschedule_appointment',
        tenantA,
        {
            appointment_id: String(anotherCallerAppointment.id),
            new_date: dateAfter(16),
            new_time: '13:00'
        },
        'call_ownership_reschedule'
    ));
    const cancel = await executeRetellTool(functionRequest(
        'cancel_appointment',
        tenantA,
        { appointment_id: String(anotherCallerAppointment.id), reason: 'Not my booking' },
        'call_ownership_cancel'
    ));

    assert.equal(reschedule.ok, false);
    assert.equal(reschedule.code, 'APPOINTMENT_NOT_FOUND');
    assert.equal(cancel.ok, false);
    assert.equal(cancel.code, 'APPOINTMENT_NOT_FOUND');
    await anotherCallerAppointment.reload();
    assert.equal(anotherCallerAppointment.appointmentTime, '09:30');
    assert.equal(anotherCallerAppointment.status, 'Confirmed');
});

test('rescheduling cannot overwrite an occupied tenant slot', async () => {
    const source = await Appointment.create({
        userId: tenantA.id,
        inboundNumber: tenantA.inboundNumber,
        caller: 'Test Caller',
        appointmentDate: dateAfter(20),
        appointmentTime: '10:00',
        type: 'Consultation',
        status: 'Confirmed'
    });
    await AppointmentContact.create({
        appointmentId: source.id,
        name: 'Test Caller',
        phone: caller,
        email: 'caller@example.test'
    });
    await Appointment.create({
        userId: tenantA.id,
        inboundNumber: tenantA.inboundNumber,
        caller: 'Slot Owner',
        appointmentDate: dateAfter(21),
        appointmentTime: '15:00',
        type: 'Consultation',
        status: 'Confirmed'
    });

    const result = await executeRetellTool(functionRequest(
        'reschedule_appointment',
        tenantA,
        {
            appointment_id: String(source.id),
            new_date: dateAfter(21),
            new_time: '15:00'
        },
        'call_reschedule_conflict'
    ));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SLOT_UNAVAILABLE');
    await source.reload();
    assert.equal(source.appointmentTime, '10:00');
});

test('call rescheduling rejects slots outside tenant booking hours', async () => {
    const targetDate = dateAfter(41);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
    }).format(new Date(`${targetDate}T12:00:00.000Z`)).toLowerCase();
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: true, start: '09:00', end: '11:00' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '30 minutes', buffer: '0 minutes' });
    await tenantA.save();

    const source = await Appointment.create({
        userId: tenantA.id,
        inboundNumber: tenantA.inboundNumber,
        caller: 'Reschedule Caller',
        appointmentDate: dateAfter(42),
        appointmentTime: '10:00',
        type: 'Consultation',
        status: 'Confirmed'
    });
    await AppointmentContact.create({
        appointmentId: source.id,
        name: 'Reschedule Caller',
        phone: caller,
        email: 'reschedule@example.test'
    });

    const result = await executeRetellTool(functionRequest('reschedule_appointment', tenantA, {
        appointment_id: String(source.id),
        new_date: targetDate,
        new_time: '12:00'
    }, 'call_reschedule_outside_booking_hours'));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SLOT_UNAVAILABLE');
    await source.reload();
    assert.equal(source.appointmentDate, dateAfter(42));
    assert.equal(source.appointmentTime, '10:00');

    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
});

test('concurrent booking attempts cannot create two active appointments for one tenant slot', async () => {
    const targetDate = dateAfter(35);
    const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: 'UTC'
    }).format(new Date(`${targetDate}T12:00:00.000Z`)).toLowerCase();
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: weekday, enabled: true, start: '09:00', end: '17:00' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '30 minutes', buffer: '0 minutes' });
    await tenantA.save();

    const attempts = await Promise.allSettled([
        dashboardDataService.createAppointment({
            customerName: 'Concurrent Caller One',
            customerPhone: '+447700900061',
            date: targetDate,
            time: '16:00',
            type: 'Consultation',
            status: 'Confirmed',
            tenantEmail: tenantA.email,
            dialedNumber: tenantA.inboundNumber
        }),
        dashboardDataService.createAppointment({
            customerName: 'Concurrent Caller Two',
            customerPhone: '+447700900062',
            date: targetDate,
            time: '16:00',
            type: 'Consultation',
            status: 'Confirmed',
            tenantEmail: tenantA.email,
            dialedNumber: tenantA.inboundNumber
        })
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    assert.equal(await Appointment.count({
        where: {
            userId: tenantA.id,
            appointmentDate: targetDate,
            appointmentTime: '16:00',
            status: { [Op.in]: ['Pending', 'Confirmed'] }
        }
    }), 1);

    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
});

test('booking retries are idempotent and upcoming lookup stays tenant-scoped', async () => {
    const countBeforeBooking = await Appointment.count({ where: { userId: tenantA.id } });
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
    assert.equal(await Appointment.count({ where: { userId: tenantA.id } }), countBeforeBooking + 1);
    assert.ok(upcoming.data.appointments.some((appointment) => appointment.id === first.data.appointment.id));
});

test('availability, reschedule, and cancel tools reuse tenant appointment rules', async () => {
    tenantA.receptionistWeeklySchedule = JSON.stringify([
        { day: 'sunday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'monday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'tuesday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'wednesday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'thursday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'friday', enabled: true, start: '09:00', end: '17:00' },
        { day: 'saturday', enabled: true, start: '09:00', end: '17:00' }
    ]);
    tenantA.receptionistBookingRules = JSON.stringify({ duration: '30 minutes', buffer: '0 minutes', minNotice: '0 minutes' });
    await tenantA.save();

    const availability = await executeRetellTool(functionRequest(
        'check_appointment_availability',
        tenantA,
        { date: dateAfter(13), requested_time: '10:30' },
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
    assert.equal(availability.data.requestedAvailable, true);
    assert.equal(rescheduled.data.appointment.time, '12:00');
    assert.equal(cancelled.data.appointment.status, 'Cancelled');

    tenantA.receptionistWeeklySchedule = '[]';
    tenantA.receptionistBookingRules = '{}';
    await tenantA.save();
});

test('metadata tenant mismatch is rejected even when the called number is valid', async () => {
    const request = functionRequest('get_business_information', tenantA, { query: 'hours' });
    request.metadata.tenantId = String(tenantB.id);
    request.call.metadata.tenantId = String(tenantB.id);

    const result = await executeRetellTool(request);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TENANT_MISMATCH');
});
