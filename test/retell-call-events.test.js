const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-retell-events-'));
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'events.sqlite');
process.env.DB_LOGGING = 'false';

const { sequelize } = require('../src/config/db');
const { User, CallLog, CallContact } = require('../src/models');
const {
    normalizeCallEvent,
    persistCallEvent
} = require('../src/services/retell-integration.service');

let tenantA;
let tenantB;

const eventFor = (event, tenant, overrides = {}) => ({
    event,
    call: {
        call_id: overrides.callId || 'call_a',
        from_number: '+447700900001',
        to_number: tenant.inboundNumber,
        start_timestamp: 1_800_000_000_000,
        end_timestamp: 1_800_000_060_000,
        transcript: overrides.transcript || '',
        disconnection_reason: 'user_hangup',
        call_analysis: {
            user_sentiment: overrides.sentiment || 'Positive',
            call_summary: overrides.summary || '',
            call_successful: true,
            custom_analysis_data: overrides.customAnalysis || {}
        }
    }
});

test.before(async () => {
    await sequelize.sync({ force: true });
    tenantA = await User.create({
        username: 'tenant-a',
        email: 'tenant-a@example.test',
        password: 'test-only',
        businessName: 'Tenant A',
        inboundNumber: '+447700900002'
    });
    tenantB = await User.create({
        username: 'tenant-b',
        email: 'tenant-b@example.test',
        password: 'test-only',
        businessName: 'Tenant B',
        inboundNumber: '+447700900003'
    });
});

test.after(async () => {
    await sequelize.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('call_analyzed enriches the existing call instead of creating a duplicate', async () => {
    await persistCallEvent(normalizeCallEvent(eventFor('call_ended', tenantA)));
    await persistCallEvent(normalizeCallEvent(eventFor('call_analyzed', tenantA, {
        transcript: 'Final transcript',
        summary: 'The request was completed.',
        customAnalysis: {
            caller_name: 'Extracted Caller',
            caller_email: 'caller@example.test'
        }
    })));

    assert.equal(await CallLog.count({ where: { retellCallId: 'call_a' } }), 1);
    const row = await CallLog.findOne({ where: { retellCallId: 'call_a' } });
    assert.equal(row.userId, tenantA.id);
    assert.equal(row.transcript, 'Final transcript');
    assert.equal(row.durationSeconds, 60);
    assert.equal(row.summary, 'The request was completed.');
    assert.equal(row.callSuccessful, true);
    assert.equal(row.disconnectionReason, 'user_hangup');
    assert.equal(new Date(row.endedAt).toISOString(), new Date(1_800_000_060_000).toISOString());
    assert.equal(await CallContact.count({ where: { callLogId: row.id } }), 1);
    const contact = await CallContact.findOne({ where: { callLogId: row.id } });
    assert.equal(contact.name, 'Extracted Caller');
    assert.equal(contact.email, 'caller@example.test');
});

test('a Retell call id cannot be reassigned to another tenant', async () => {
    await persistCallEvent(normalizeCallEvent(eventFor('call_ended', tenantA, {
        callId: 'call_tenant_guard'
    })));

    await assert.rejects(
        persistCallEvent(normalizeCallEvent(eventFor('call_analyzed', tenantB, {
            callId: 'call_tenant_guard',
            transcript: 'Wrong tenant transcript'
        }))),
        /tenant mismatch/i
    );
});

test('an unknown inbound number cannot create an unowned call row', async () => {
    const unknownTenant = { inboundNumber: '+447700900004' };

    await assert.rejects(
        persistCallEvent(normalizeCallEvent(eventFor('call_ended', unknownTenant, {
            callId: 'call_unknown'
        }))),
        /tenant not found/i
    );
    assert.equal(await CallLog.count({ where: { retellCallId: 'call_unknown' } }), 0);
});
