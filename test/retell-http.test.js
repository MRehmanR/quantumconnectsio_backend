const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-retell-http-'));
const apiKey = 'retell-http-test-key';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'http.sqlite');
process.env.DB_LOGGING = 'false';
process.env.RETELL_API_KEY = apiKey;
process.env.N8N_MANUAL_APPOINTMENT_WEBHOOK_URL = '';

const { sequelize } = require('../src/config/db');
const { User, CallLog, UsageCycle, AutomationEvent } = require('../src/models');
const automationRoutes = require('../src/routes/automation.routes');
const usageEnforcementService = require('../src/services/usage-enforcement.service');

let server;
let baseUrl;
let tenant;

const signatureFor = (rawBody, timestamp = Date.now()) => {
    const digest = crypto
        .createHmac('sha256', apiKey)
        .update(`${rawBody}${timestamp}`)
        .digest('hex');
    return `v=${timestamp},d=${digest}`;
};

const signedPost = async (pathname, body, signatureOverride) => {
    const rawBody = JSON.stringify(body);
    return fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-retell-signature': signatureOverride || signatureFor(rawBody)
        },
        body: rawBody
    });
};

test.before(async () => {
    await sequelize.sync({ force: true });
    tenant = await User.create({
        username: 'http-tenant',
        email: 'http-tenant@example.test',
        password: 'test-only',
        businessName: 'HTTP Tenant Travel',
        inboundNumber: '+447700900002',
        ownerPhone: '+447700900010',
        timezone: 'Europe/London',
        plan: 'Core',
        retellAgentId: 'agent_http_tenant',
        receptionistStatus: 'live'
    });

    const app = express();
    app.use(express.json({
        verify: (req, _res, buffer) => {
            req.rawBody = buffer.toString('utf8');
        }
    }));
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

test('Retell endpoints reject an invalid signature before changing state', async () => {
    const response = await signedPost('/api/automation/retell/inbound', {
        event: 'call_inbound',
        call_inbound: {
            call_id: 'call_invalid_signature',
            from_number: '+447700900001',
            to_number: tenant.inboundNumber
        }
    }, 'v=1,d=bad');

    assert.equal(response.status, 401);
    assert.equal(await UsageCycle.count({ where: { userId: tenant.id } }), 0);
});

test('signed inbound retries without a call id reserve usage only once', async () => {
    const inboundBody = {
        event: 'call_inbound',
        call_inbound: {
            from_number: '+447700900001',
            to_number: tenant.inboundNumber
        }
    };
    const rawBody = JSON.stringify(inboundBody);
    const timestamp = Date.now();
    const retrySignature = signatureFor(rawBody, timestamp);
    const response = await signedPost('/api/automation/retell/inbound', inboundBody, retrySignature);
    const retry = await signedPost('/api/automation/retell/inbound', inboundBody, retrySignature);
    const responseBody = await response.json();
    const retryBody = await retry.json();

    assert.equal(response.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(responseBody.call_inbound.override_agent_id, tenant.retellAgentId);
    assert.equal(retryBody.call_inbound.override_agent_id, tenant.retellAgentId);
    const usage = await UsageCycle.findOne({ where: { userId: tenant.id } });
    assert.equal(usage.concurrentCallsActive, 1);
    assert.equal((await tenant.reload()).callsUsed, 1);
});

test('duplicate call_ended events finalize usage once and upsert one call', async () => {
    const eventBody = {
        event: 'call_ended',
        call: {
            call_id: 'call_http_lifecycle',
            from_number: '+447700900001',
            to_number: tenant.inboundNumber,
            start_timestamp: Date.now() - 60_000,
            end_timestamp: Date.now(),
            transcript: 'The caller booked a consultation.',
            disconnection_reason: 'user_hangup'
        }
    };

    const first = await signedPost('/api/automation/retell/events', eventBody);
    const duplicate = await signedPost('/api/automation/retell/webhook', eventBody);

    assert.equal(first.status, 202);
    assert.equal(duplicate.status, 202);
    assert.equal(await CallLog.count({ where: { retellCallId: 'call_http_lifecycle' } }), 1);
    const usage = await UsageCycle.findOne({ where: { userId: tenant.id } });
    assert.equal(usage.concurrentCallsActive, 0);
    assert.equal((await tenant.reload()).callsUsed, 1);
});

test('a failed call finalization remains retryable and releases concurrency on retry', async () => {
    await signedPost('/api/automation/retell/inbound', {
        event: 'call_inbound',
        call_inbound: {
            from_number: '+447700900098',
            to_number: tenant.inboundNumber
        }
    });

    const originalFinalizeCall = usageEnforcementService.finalizeCall;
    let attempts = 0;
    let retryStartedResolve;
    const retryStarted = new Promise((resolve) => {
        retryStartedResolve = resolve;
    });
    usageEnforcementService.finalizeCall = async (...args) => {
        attempts += 1;
        if (attempts === 1) {
            throw new Error('transient finalization failure');
        }
        retryStartedResolve();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return originalFinalizeCall(...args);
    };

    const eventBody = {
        event: 'call_ended',
        call: {
            call_id: 'call_retry_finalization',
            from_number: '+447700900098',
            to_number: tenant.inboundNumber,
            start_timestamp: Date.now() - 30_000,
            end_timestamp: Date.now()
        }
    };

    try {
        const failed = await signedPost('/api/automation/retell/events', eventBody);
        const retriedRequest = signedPost('/api/automation/retell/events', eventBody);
        await retryStarted;
        const concurrentRetry = await signedPost('/api/automation/retell/events', eventBody);
        const retried = await retriedRequest;

        assert.equal(failed.status, 500);
        assert.equal(retried.status, 202);
        assert.equal(concurrentRetry.status, 202);
        assert.equal(attempts, 2);
        const event = await AutomationEvent.findOne({
            where: { idempotencyKey: 'retell:call_ended:call_retry_finalization' }
        });
        assert.equal(event.status, 'processed');
        const usage = await UsageCycle.findOne({ where: { userId: tenant.id } });
        assert.equal(usage.concurrentCallsActive, 0);
    } finally {
        usageEnforcementService.finalizeCall = originalFinalizeCall;
    }
});

test('usage release is idempotent by Retell call id even when invoked more than once', async () => {
    const cycle = await UsageCycle.findOne({ where: { userId: tenant.id } });
    cycle.concurrentCallsActive = 2;
    await cycle.save();

    const first = await usageEnforcementService.finalizeCall({
        tenantEmail: tenant.email,
        dialedNumber: tenant.inboundNumber,
        wasConnected: true,
        idempotencyKey: 'call_usage_release_once'
    });
    const duplicate = await usageEnforcementService.finalizeCall({
        tenantEmail: tenant.email,
        dialedNumber: tenant.inboundNumber,
        wasConnected: true,
        idempotencyKey: 'call_usage_release_once'
    });

    assert.equal(first.concurrentActive, 1);
    assert.equal(duplicate.concurrentActive, 1);
    assert.equal(duplicate.duplicated, true);
    cycle.concurrentCallsActive = 0;
    await cycle.save();
});

test('signed custom-function endpoint executes against the called tenant', async () => {
    const response = await signedPost('/api/automation/retell/functions', {
        name: 'check_appointment_availability',
        call: {
            call_id: 'call_http_tool',
            from_number: '+447700900001',
            to_number: tenant.inboundNumber,
            metadata: { tenantId: String(tenant.id) }
        },
        args: {
            date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
        }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.code, 'AVAILABILITY_FOUND');
});
