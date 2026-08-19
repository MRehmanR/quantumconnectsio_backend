const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    parseRetellSignature,
    verifyRetellRequest,
    normalizeInboundRequest,
    normalizeFunctionRequest,
    normalizeCallEvent
} = require('../src/services/retell-integration.service');

const apiKey = 'retell-test-key';
const nowMs = 1_800_000_000_000;
const rawBody = JSON.stringify({
    event: 'call_inbound',
    call_inbound: {
        from_number: '+447700900001',
        to_number: '+447700900002'
    }
});
const digest = crypto.createHmac('sha256', apiKey).update(`${rawBody}${nowMs}`).digest('hex');
const signature = `v=${nowMs},d=${digest}`;

test('rejects a changed raw body when verifying a fresh Retell signature', () => {
    assert.deepEqual(parseRetellSignature(signature), { timestamp: nowMs, digest });
    assert.equal(verifyRetellRequest({ rawBody, signature, apiKey, nowMs }), true);
    assert.equal(verifyRetellRequest({ rawBody: `${rawBody} `, signature, apiKey, nowMs }), false);
});

test('rejects stale and malformed Retell signatures', () => {
    assert.equal(verifyRetellRequest({ rawBody, signature, apiKey, nowMs: nowMs + 300_001 }), false);
    assert.equal(verifyRetellRequest({ rawBody, signature: 'bad', apiKey, nowMs }), false);
});

test('normalizes inbound call routing fields from the documented envelope', () => {
    assert.deepEqual(normalizeInboundRequest(JSON.parse(rawBody)), {
        event: 'call_inbound',
        fromNumber: '+447700900001',
        toNumber: '+447700900002',
        agentId: ''
    });
});

test('normalizes custom functions while retaining untrusted arguments separately', () => {
    const result = normalizeFunctionRequest({
        name: 'book_appointment',
        call: {
            call_id: 'call_1',
            from_number: '+447700900001',
            to_number: '+447700900002',
            metadata: { tenantId: '4' }
        },
        args: {
            tenantEmail: 'attacker@example.com',
            date: '2026-09-01',
            time: '10:00'
        }
    });

    assert.equal(result.callId, 'call_1');
    assert.equal(result.toNumber, '+447700900002');
    assert.equal(result.metadata.tenantId, '4');
    assert.equal(result.args.tenantEmail, 'attacker@example.com');
});

test('normalizes analyzed call timing and nested analysis fields', () => {
    const result = normalizeCallEvent({
        event: 'call_analyzed',
        call: {
            call_id: 'call_1',
            from_number: '+447700900001',
            to_number: '+447700900002',
            start_timestamp: 1000,
            end_timestamp: 61000,
            transcript: 'Hello',
            call_analysis: {
                user_sentiment: 'Positive',
                call_summary: 'Booked a trip.',
                call_successful: true
            }
        }
    });

    assert.equal(result.durationSeconds, 60);
    assert.equal(result.sentiment, 'Positive');
    assert.equal(result.summary, 'Booked a trip.');
    assert.equal(result.successful, true);
});
