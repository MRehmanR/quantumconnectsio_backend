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

module.exports = {
    parseRetellSignature,
    verifyRetellRequest,
    normalizeInboundRequest,
    normalizeFunctionRequest,
    normalizeCallEvent
};
