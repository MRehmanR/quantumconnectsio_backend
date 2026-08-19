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
const { User, CallLog, UsageCycle } = require('../src/models');
const automationRoutes = require('../src/routes/automation.routes');

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

test('signed inbound endpoint returns tenant-specific Retell routing', async () => {
    const response = await signedPost('/api/automation/retell/inbound', {
        event: 'call_inbound',
        call_inbound: {
            call_id: 'call_http_lifecycle',
            from_number: '+447700900001',
            to_number: tenant.inboundNumber
        }
    });
    const responseBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(responseBody.call_inbound.override_agent_id, tenant.retellAgentId);
    const usage = await UsageCycle.findOne({ where: { userId: tenant.id } });
    assert.equal(usage.concurrentCallsActive, 1);
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
    assert.equal(tenant.callsUsed + 1, (await tenant.reload()).callsUsed);
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
