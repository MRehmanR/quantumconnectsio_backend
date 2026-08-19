const crypto = require('node:crypto');

const parseRetellSignature = (signature) => {
    const match = String(signature || '').match(/^v=(\d+),d=([a-f0-9]+)$/i);
    return match
        ? { timestamp: Number(match[1]), digest: match[2].toLowerCase() }
        : null;
};

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');

    return (
        leftBuffer.length > 0 &&
        leftBuffer.length === rightBuffer.length &&
        crypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
};

const verifyRetellRequest = ({ rawBody, signature, apiKey, nowMs = Date.now() }) => {
    const parsed = parseRetellSignature(signature);

    if (
        !parsed ||
        !rawBody ||
        !apiKey ||
        Math.abs(nowMs - parsed.timestamp) > 300_000
    ) {
        return false;
    }

    const expected = crypto
        .createHmac('sha256', apiKey)
        .update(`${rawBody}${parsed.timestamp}`)
        .digest('hex');

    return safeEqual(expected, parsed.digest);
};

const normalizeInboundRequest = (body = {}) => {
    const inbound = body.call_inbound || {};

    return {
        event: String(body.event || ''),
        fromNumber: String(inbound.from_number || ''),
        toNumber: String(inbound.to_number || ''),
        agentId: String(inbound.agent_id || '')
    };
};

const normalizeFunctionRequest = (body = {}) => {
    const call = body.call || {};

    return {
        name: String(body.name || ''),
        call,
        args: body.args || {},
        callId: String(call.call_id || ''),
        fromNumber: String(call.from_number || ''),
        toNumber: String(call.to_number || ''),
        metadata: call.metadata || {}
    };
};

const normalizeCallEvent = (body = {}) => {
    const call = body.call || {};
    const analysis = call.call_analysis || {};
    const start = Number(call.start_timestamp || 0);
    const end = Number(call.end_timestamp || 0);

    return {
        event: String(body.event || ''),
        callId: String(call.call_id || ''),
        fromNumber: String(call.from_number || ''),
        toNumber: String(call.to_number || ''),
        startedAt: start ? new Date(start).toISOString() : null,
        endedAt: end ? new Date(end).toISOString() : null,
        durationSeconds: start && end
            ? Math.max(Math.floor((end - start) / 1000), 0)
            : 0,
        transcript: String(call.transcript || ''),
        sentiment: String(analysis.user_sentiment || 'Neutral'),
        summary: String(analysis.call_summary || ''),
        successful: Boolean(analysis.call_successful),
        disconnectionReason: String(call.disconnection_reason || ''),
        metadata: call.metadata || {},
        rawCall: call
    };
};

const persistCallEvent = async (normalizedEvent) => {
    const { User, CallLog, CallContact } = require('../models');
    const { sequelize } = require('../config/db');
    const { normalizePhone } = require('../utils/phone');

    const callId = String(normalizedEvent?.callId || '').trim();
    if (!callId) {
        throw new Error('Retell call id is required');
    }

    const rawInbound = String(normalizedEvent?.toNumber || '').trim();
    const normalizedInbound = /^\+[1-9]\d{7,14}$/.test(rawInbound)
        ? { ok: true, e164: rawInbound }
        : normalizePhone(rawInbound, {});
    if (!normalizedInbound.ok || !normalizedInbound.e164) {
        throw new Error('Retell tenant not found for inbound number');
    }

    return sequelize.transaction(async (transaction) => {
        const tenant = await User.findOne({
            where: { inboundNumber: normalizedInbound.e164 },
            transaction
        });

        if (!tenant) {
            throw new Error('Retell tenant not found for inbound number');
        }

        let callLog = await CallLog.findOne({
            where: { retellCallId: callId },
            transaction
        });
        let created = false;

        if (callLog && Number(callLog.userId) !== Number(tenant.id)) {
            throw new Error('Retell call tenant mismatch');
        }

        const sentiment = ['Positive', 'Neutral', 'Negative'].includes(normalizedEvent.sentiment)
            ? normalizedEvent.sentiment
            : 'Neutral';
        const caller = normalizePhone(normalizedEvent.fromNumber, {
            referenceE164: tenant.inboundNumber
        });
        const callerNumber = caller.ok && caller.e164
            ? caller.e164
            : String(normalizedEvent.fromNumber || 'Unknown');

        if (!callLog) {
            callLog = await CallLog.create({
                userId: tenant.id,
                retellCallId: callId,
                inboundNumber: tenant.inboundNumber,
                callerNumber,
                callTime: normalizedEvent.startedAt || new Date(),
                durationSeconds: Number(normalizedEvent.durationSeconds || 0),
                sentiment,
                status: 'Completed',
                transcript: String(normalizedEvent.transcript || '')
            }, { transaction });
            created = true;
        } else {
            const updates = {};
            if (normalizedEvent.startedAt) updates.callTime = normalizedEvent.startedAt;
            if (Number(normalizedEvent.durationSeconds) > 0) {
                updates.durationSeconds = Number(normalizedEvent.durationSeconds);
            }
            if (normalizedEvent.transcript) updates.transcript = normalizedEvent.transcript;
            if (normalizedEvent.sentiment) updates.sentiment = sentiment;
            if (Object.keys(updates).length > 0) {
                await callLog.update(updates, { transaction });
            }
        }

        const [contact, contactCreated] = await CallContact.findOrCreate({
            where: { callLogId: callLog.id },
            defaults: {
                name: 'Unknown Caller',
                phone: callerNumber,
                email: ''
            },
            transaction
        });

        if (!contactCreated && callerNumber && contact.phone !== callerNumber) {
            await contact.update({ phone: callerNumber }, { transaction });
        }

        return {
            callLogId: callLog.id,
            created,
            finalized: normalizedEvent.event === 'call_ended'
        };
    });
};

module.exports = {
    parseRetellSignature,
    verifyRetellRequest,
    normalizeInboundRequest,
    normalizeFunctionRequest,
    normalizeCallEvent,
    persistCallEvent
};
