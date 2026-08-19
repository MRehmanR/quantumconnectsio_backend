const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-n8n-dispatch-'));
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'n8n.sqlite');
process.env.DB_LOGGING = 'false';
process.env.AUTOMATION_SHARED_KEY = 'automation-test-key';
process.env.N8N_USAGE_THRESHOLD_WEBHOOK_URL = 'https://n8n.example.test/webhook/qc-v2-usage';
process.env.N8N_MANUAL_APPOINTMENT_WEBHOOK_URL = 'https://n8n.example.test/webhook/qc-v2-appointments';

const { sequelize } = require('../src/config/db');
const { User, Appointment, AutomationEvent, UsageCycle } = require('../src/models');
const {
    buildN8nJob,
    dispatchN8nJob
} = require('../src/services/n8n-dispatch.service');
const automationRoutes = require('../src/routes/automation.routes');
const dashboardDataService = require('../src/services/dashboard-data.service');
const automationService = require('../src/services/automation.service');

let server;
let baseUrl;
let tenant;

test.before(async () => {
    await sequelize.sync({ force: true });
    tenant = await User.create({
        username: 'n8n-active',
        email: 'n8n-active@example.test',
        password: 'test-only',
        businessName: 'Active Tenant',
        inboundNumber: '+447700900002',
        timezone: 'Europe/London',
        plan: 'Core',
        status: 'Active'
    });
    await User.create({
        username: 'n8n-suspended',
        email: 'n8n-suspended@example.test',
        password: 'test-only',
        inboundNumber: '+447700900003',
        status: 'Suspended'
    });
    await User.create({
        username: 'n8n-no-number',
        email: 'n8n-no-number@example.test',
        password: 'test-only',
        inboundNumber: null,
        status: 'Active'
    });

    const app = express();
    app.use(express.json());
    app.use('/api/automation', automationRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
    await sequelize.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('n8n jobs always carry an explicit tenant envelope', () => {
    const occurredAt = '2026-08-19T12:00:00.000Z';
    assert.deepEqual(buildN8nJob({
        jobType: 'appointment.booked',
        jobId: 'job_1',
        tenant,
        occurredAt,
        payload: { appointmentId: '7' }
    }), {
        jobType: 'appointment.booked',
        jobId: 'job_1',
        tenant: {
            id: String(tenant.id),
            email: tenant.email,
            inboundNumber: tenant.inboundNumber,
            timezone: tenant.timezone
        },
        occurredAt,
        payload: { appointmentId: '7' }
    });

    assert.throws(() => buildN8nJob({
        jobType: 'appointment.booked',
        jobId: 'job_missing_tenant',
        tenant: { id: tenant.id },
        payload: {}
    }), /inbound number/i);
});

test('n8n provider failures are recorded and returned without throwing', async () => {
    const job = buildN8nJob({
        jobType: 'appointment.booked',
        jobId: 'job_provider_failure',
        tenant,
        payload: { appointmentId: '8' }
    });
    const result = await dispatchN8nJob(job, {
        fetchImpl: async () => ({
            ok: false,
            status: 503,
            text: async () => 'Temporarily unavailable'
        })
    });

    assert.deepEqual(result, {
        attempted: true,
        ok: false,
        status: 503,
        message: 'Temporarily unavailable'
    });
    const failedEvent = await AutomationEvent.findOne({
        where: { idempotencyKey: 'n8n_dispatch_failed:job_provider_failure' }
    });
    assert.equal(failedEvent.status, 'failed');
    assert.equal(failedEvent.tenantEmail, tenant.email);
});

test('appointment writes commit before a canonical n8n notification failure is returned', async () => {
    const originalFetch = global.fetch;
    let deliveredJob = null;
    global.fetch = async (_url, options) => {
        deliveredJob = JSON.parse(options.body);
        return {
            ok: false,
            status: 503,
            text: async () => 'n8n unavailable'
        };
    };

    try {
        const futureDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
        const appointment = await dashboardDataService.createAppointment({
            customerName: 'n8n Test Caller',
            customerPhone: '+447700900001',
            customerEmail: 'caller@example.test',
            date: futureDate,
            time: '15:00',
            type: 'Travel planning',
            status: 'Confirmed',
            tenantEmail: tenant.email,
            dialedNumber: tenant.inboundNumber,
            ownerPhone: tenant.ownerPhone
        });

        assert.equal(await Appointment.count({ where: { id: Number(appointment.id) } }), 1);
        assert.equal(appointment.notification.ok, false);
        assert.equal(deliveredJob.jobType, 'appointment.booked');
        assert.equal(deliveredJob.tenant.id, String(tenant.id));
        assert.equal(deliveredJob.tenant.inboundNumber, tenant.inboundNumber);
        assert.equal(deliveredJob.payload.appointmentId, String(appointment.id));
    } finally {
        global.fetch = originalFetch;
    }
});

test('usage thresholds dispatch a tenant-explicit n8n job after usage is committed', async () => {
    const originalFetch = global.fetch;
    let deliveredJob = null;
    global.fetch = async (_url, options) => {
        deliveredJob = JSON.parse(options.body);
        return { ok: true, status: 202, text: async () => 'accepted' };
    };

    try {
        const cycleStart = new Date();
        const cycleEnd = new Date(cycleStart);
        cycleEnd.setUTCMonth(cycleEnd.getUTCMonth() + 1);
        await UsageCycle.create({
            userId: tenant.id,
            cycleStart,
            cycleEnd,
            includedCallsUsed: 139,
            addonCallsBalance: 0,
            addonCallsUsed: 0,
            concurrentCallsActive: 0
        });

        const result = await automationService.preflightInboundCall({
            tenantEmail: tenant.email,
            dialedNumber: tenant.inboundNumber,
            callerNumber: '+447700900001',
            idempotencyKey: 'usage_threshold_dispatch'
        });

        assert.equal(result.accepted, true);
        assert.equal(deliveredJob.jobType, 'usage.threshold.70');
        assert.equal(deliveredJob.tenant.id, String(tenant.id));
        assert.equal(deliveredJob.payload.usage.used, 140);
    } finally {
        global.fetch = originalFetch;
    }
});

test('daily summary tenant endpoint requires automation auth and returns active numbered tenants only', async () => {
    const unauthorized = await fetch(`${baseUrl}/api/automation/tenants/daily-summary`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/automation/tenants/daily-summary`, {
        headers: { 'x-automation-key': 'automation-test-key' }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, [{
        id: String(tenant.id),
        email: tenant.email,
        inboundNumber: tenant.inboundNumber,
        timezone: tenant.timezone
    }]);
});
