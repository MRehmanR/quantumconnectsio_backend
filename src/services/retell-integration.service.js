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

const buildInboundRetryKey = ({ signature, fromNumber, toNumber }) => {
    const parsed = parseRetellSignature(signature);
    if (!parsed) {
        return '';
    }

    const fingerprint = crypto
        .createHash('sha256')
        .update(`${parsed.timestamp}:${String(fromNumber || '').trim()}:${String(toNumber || '').trim()}`)
        .digest('hex');
    return `retell_inbound_${fingerprint}`;
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
    const customAnalysis = analysis.custom_analysis_data || {};
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
        extractedCallerName: String(customAnalysis.caller_name || customAnalysis.customer_name || ''),
        extractedCallerEmail: String(customAnalysis.caller_email || customAnalysis.customer_email || ''),
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

        const metadataTenantId = String(normalizedEvent?.metadata?.tenantId || '').trim();
        if (metadataTenantId && metadataTenantId !== String(tenant.id)) {
            throw new Error('Retell call tenant mismatch');
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
                transcript: String(normalizedEvent.transcript || ''),
                summary: String(normalizedEvent.summary || ''),
                callSuccessful: normalizedEvent.event === 'call_analyzed'
                    ? Boolean(normalizedEvent.successful)
                    : null,
                disconnectionReason: String(normalizedEvent.disconnectionReason || ''),
                endedAt: normalizedEvent.endedAt || null
            }, { transaction });
            created = true;
        } else {
            const updates = {};
            if (normalizedEvent.startedAt) updates.callTime = normalizedEvent.startedAt;
            if (Number(normalizedEvent.durationSeconds) > 0) {
                updates.durationSeconds = Number(normalizedEvent.durationSeconds);
            }
            if (normalizedEvent.transcript) updates.transcript = normalizedEvent.transcript;
            if (normalizedEvent.summary) updates.summary = normalizedEvent.summary;
            if (normalizedEvent.event === 'call_analyzed') updates.callSuccessful = Boolean(normalizedEvent.successful);
            if (normalizedEvent.disconnectionReason) updates.disconnectionReason = normalizedEvent.disconnectionReason;
            if (normalizedEvent.endedAt) updates.endedAt = normalizedEvent.endedAt;
            if (normalizedEvent.sentiment) updates.sentiment = sentiment;
            if (Object.keys(updates).length > 0) {
                await callLog.update(updates, { transaction });
            }
        }

        const [contact, contactCreated] = await CallContact.findOrCreate({
            where: { callLogId: callLog.id },
            defaults: {
                name: normalizedEvent.extractedCallerName || 'Unknown Caller',
                phone: callerNumber,
                email: normalizedEvent.extractedCallerEmail || ''
            },
            transaction
        });

        if (!contactCreated) {
            const contactUpdates = {};
            if (callerNumber && contact.phone !== callerNumber) contactUpdates.phone = callerNumber;
            if (normalizedEvent.extractedCallerName) contactUpdates.name = normalizedEvent.extractedCallerName;
            if (normalizedEvent.extractedCallerEmail) contactUpdates.email = normalizedEvent.extractedCallerEmail;
            if (Object.keys(contactUpdates).length > 0) {
                await contact.update(contactUpdates, { transaction });
            }
        }

        return {
            callLogId: callLog.id,
            created,
            finalized: normalizedEvent.event === 'call_ended'
        };
    });
};

const normalizeInboundNumber = (value) => {
    const raw = String(value || '').trim();
    if (/^\+[1-9]\d{7,14}$/.test(raw)) {
        return raw;
    }

    const { normalizePhone } = require('../utils/phone');
    const normalized = normalizePhone(raw, {});
    return normalized.ok ? normalized.e164 : '';
};

const resolveTenantByInboundNumber = async (toNumber) => {
    const { User } = require('../models');
    const inboundNumber = normalizeInboundNumber(toNumber);
    if (!inboundNumber) {
        return null;
    }

    return User.findOne({ where: { inboundNumber } });
};

const rejectInboundCall = () => ({ call_inbound: { reject: true } });

const handleInboundCall = async (normalizedInbound, { preflightKey } = {}) => {
    const tenant = await resolveTenantByInboundNumber(normalizedInbound?.toNumber);
    const dashboardDataService = require('./dashboard-data.service');
    if (
        !tenant ||
        tenant.status !== 'Active' ||
        !String(tenant.retellAgentId || '').trim() ||
        !dashboardDataService.isReceptionistActiveForUser(tenant)
    ) {
        return rejectInboundCall();
    }

    const { preflightInboundCall, finalizeInboundCall } = require('./automation.service');
    const result = await preflightInboundCall({
        tenantEmail: tenant.email,
        dialedNumber: tenant.inboundNumber,
        callerNumber: normalizedInbound.fromNumber,
        idempotencyKey: preflightKey
    });

    if (!result.accepted) {
        if (result.userId) {
            await finalizeInboundCall({
                tenantEmail: tenant.email,
                dialedNumber: tenant.inboundNumber,
                wasConnected: false
            });
        }
        return rejectInboundCall();
    }

    return {
        call_inbound: {
            override_agent_id: String(tenant.retellAgentId),
            dynamic_variables: {
                tenant_id: String(tenant.id),
                business_name: String(tenant.businessName || ''),
                caller_number: String(normalizedInbound.fromNumber || ''),
                owner_number: String(tenant.ownerPhone || ''),
                business_timezone: String(tenant.timezone || 'UTC'),
                receptionist_name: String(tenant.receptionistName || 'Aria'),
                custom_greeting: String(tenant.receptionistCustomGreeting || '')
            },
            metadata: {
                tenantId: String(tenant.id),
                inboundNumber: String(tenant.inboundNumber),
                preflightKey: String(preflightKey || '')
            }
        }
    };
};

const stableJson = (value) => {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const toolResult = ({ ok, code, message, data = {} }) => ({
    ok,
    code,
    message,
    data
});

const executeRetellToolOperation = async ({ name, tenant, args, fromNumber }) => {
    const dashboardDataService = require('./dashboard-data.service');
    const tenantContext = {
        tenantEmail: tenant.email,
        dialedNumber: tenant.inboundNumber,
        ownerPhone: tenant.ownerPhone || ''
    };

    if (name === 'get_business_information') {
        const match = await dashboardDataService.queryKnowledgeForTenant({
            tenant,
            query: args.query
        });
        return match
            ? toolResult({
                ok: true,
                code: 'INFORMATION_FOUND',
                message: match.answer,
                data: { sourceTitle: match.sourceTitle }
            })
            : toolResult({
                ok: false,
                code: 'INFORMATION_NOT_FOUND',
                message: 'I could not find that information for this business.'
            });
    }

    if (name === 'find_upcoming_appointments') {
        const appointments = await dashboardDataService.findUpcomingAppointmentsForTenant({
            tenant,
            customerPhone: fromNumber
        });
        return toolResult({
            ok: true,
            code: 'UPCOMING_APPOINTMENTS_FOUND',
            message: appointments.length > 0
                ? `Found ${appointments.length} upcoming appointment${appointments.length === 1 ? '' : 's'}.`
                : 'No upcoming appointments were found for this caller.',
            data: {
                appointments: appointments.map((appointment) => ({
                    id: String(appointment.id),
                    date: appointment.appointmentDate,
                    time: appointment.appointmentTime,
                    type: appointment.type,
                    status: appointment.status
                }))
            }
        });
    }

    if (name === 'check_appointment_availability') {
        const availability = await dashboardDataService.getAppointmentAvailability({
            date: args.date,
            ...tenantContext
        });
        const requestedTime = String(args.requested_time || '').trim();
        const requestedAvailable = requestedTime
            ? availability.availableSlots.includes(requestedTime)
            : null;
        const responseData = {
            ...availability,
            requestedTime,
            requestedAvailable,
            alternativeSlots: requestedAvailable === false
                ? availability.availableSlots.slice(0, 5)
                : []
        };
        return toolResult({
            ok: true,
            code: 'AVAILABILITY_FOUND',
            message: requestedAvailable === true
                ? `${requestedTime} is available on that date.`
                : requestedAvailable === false
                    ? `${requestedTime} is not available on that date.`
                    : availability.fullyBooked
                ? 'There are no available times on that date.'
                : `There are ${availability.availableSlots.length} available times on that date.`,
            data: responseData
        });
    }

    if (name === 'book_appointment') {
        const appointment = await dashboardDataService.createAppointment({
            customerName: args.customer_name,
            customerPhone: args.customer_phone || fromNumber,
            customerEmail: args.customer_email || '',
            date: args.date,
            time: args.time,
            type: args.service_type || 'Consultation',
            status: 'Confirmed',
            ...tenantContext
        });
        return toolResult({
            ok: true,
            code: appointment.duplicate ? 'APPOINTMENT_ALREADY_BOOKED' : 'APPOINTMENT_BOOKED',
            message: appointment.duplicate
                ? 'That appointment was already booked for this caller.'
                : 'The appointment has been booked.',
            data: { appointment }
        });
    }

    if (name === 'reschedule_appointment') {
        const appointment = await dashboardDataService.rescheduleAppointment({
            appointmentId: args.appointment_id,
            date: args.new_date,
            time: args.new_time,
            customerPhone: fromNumber,
            ...tenantContext
        });
        return appointment
            ? toolResult({
                ok: true,
                code: 'APPOINTMENT_RESCHEDULED',
                message: 'The appointment has been rescheduled.',
                data: { appointment }
            })
            : toolResult({
                ok: false,
                code: 'APPOINTMENT_NOT_FOUND',
                message: 'That appointment was not found for this business.'
            });
    }

    if (name === 'cancel_appointment') {
        const appointment = await dashboardDataService.cancelAppointment({
            appointmentId: args.appointment_id,
            reason: args.reason || '',
            customerPhone: fromNumber,
            ...tenantContext
        });
        return appointment
            ? toolResult({
                ok: true,
                code: 'APPOINTMENT_CANCELLED',
                message: 'The appointment has been cancelled.',
                data: { appointment }
            })
            : toolResult({
                ok: false,
                code: 'APPOINTMENT_NOT_FOUND',
                message: 'That appointment was not found for this business.'
            });
    }

    return toolResult({
        ok: false,
        code: 'UNKNOWN_TOOL',
        message: 'This call action is not supported.'
    });
};

const executeRetellTool = async (normalizedFunction) => {
    const { AutomationEvent } = require('../models');
    const name = String(normalizedFunction?.name || '').trim();
    const args = normalizedFunction?.args || {};
    const tenant = await resolveTenantByInboundNumber(normalizedFunction?.toNumber);

    if (!tenant) {
        return toolResult({
            ok: false,
            code: 'TENANT_NOT_FOUND',
            message: 'The called business could not be identified.'
        });
    }

    const metadataTenantId = String(normalizedFunction?.metadata?.tenantId || '').trim();
    if (metadataTenantId && metadataTenantId !== String(tenant.id)) {
        return toolResult({
            ok: false,
            code: 'TENANT_MISMATCH',
            message: 'The call context does not match the called business.'
        });
    }

    const argsHash = crypto.createHash('sha256').update(stableJson(args)).digest('hex');
    const idempotencyKey = `retell_tool:${String(normalizedFunction?.callId || 'unknown')}:${name}:${argsHash}`;
    const existing = await AutomationEvent.findOne({ where: { idempotencyKey } });
    if (existing?.payload?.result) {
        return existing.payload.result;
    }

    let result;
    try {
        result = await executeRetellToolOperation({
            name,
            tenant,
            args,
            fromNumber: normalizedFunction?.fromNumber
        });
    } catch (error) {
        result = toolResult({
            ok: false,
            code: String(error?.code || 'TOOL_EXECUTION_FAILED'),
            message: String(error?.message || 'The call action could not be completed.'),
            data: error?.alternatives ? { alternatives: error.alternatives } : {}
        });
    }

    try {
        await AutomationEvent.create({
            source: 'retell',
            eventType: `tool.${name || 'unknown'}`,
            idempotencyKey,
            tenantEmail: tenant.email,
            occurredAt: new Date(),
            payload: {
                callId: String(normalizedFunction?.callId || ''),
                result
            },
            status: result.ok ? 'processed' : 'failed',
            processedAt: new Date(),
            errorMessage: result.ok ? '' : result.message
        });
    } catch (error) {
        const duplicate = String(error?.name || '').includes('Unique') || /unique/i.test(String(error?.message || ''));
        if (!duplicate) {
            throw error;
        }
        const winner = await AutomationEvent.findOne({ where: { idempotencyKey } });
        if (winner?.payload?.result) {
            return winner.payload.result;
        }
    }

    return result;
};

const processRetellCallEvent = async (normalizedEvent) => {
    const supportedEvents = new Set(['call_started', 'call_ended', 'call_analyzed']);
    if (!supportedEvents.has(normalizedEvent?.event)) {
        return { ignored: true, duplicated: false };
    }

    const persisted = await persistCallEvent(normalizedEvent);
    if (normalizedEvent.event !== 'call_ended') {
        return { ...persisted, duplicated: false };
    }

    const { AutomationEvent } = require('../models');
    const idempotencyKey = `retell:call_ended:${normalizedEvent.callId}`;
    const [event, created] = await AutomationEvent.findOrCreate({
        where: { idempotencyKey },
        defaults: {
            source: 'retell',
            eventType: 'call.ended.finalized',
            tenantEmail: '',
            occurredAt: normalizedEvent.endedAt || new Date(),
            payload: { callId: normalizedEvent.callId },
            status: 'received'
        }
    });

    if (!created) {
        const { sequelize } = require('../config/db');
        const claimed = await sequelize.transaction(async (transaction) => {
            const current = await AutomationEvent.findByPk(event.id, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (current.status === 'processed') {
                return false;
            }
            if (current.status === 'received') {
                const claimAgeMs = Date.now() - new Date(current.updatedAt || current.createdAt).getTime();
                if (claimAgeMs < 30_000) {
                    return false;
                }
            }
            current.status = 'received';
            current.errorMessage = '';
            current.updatedAt = new Date();
            await current.save({ transaction });
            return true;
        });
        if (!claimed) {
            return {
                ...persisted,
                duplicated: true,
                finalizationPending: event.status !== 'processed'
            };
        }
    }

    const tenant = await resolveTenantByInboundNumber(normalizedEvent.toNumber);
    const { finalizeInboundCall } = require('./automation.service');
    try {
        const finalization = await finalizeInboundCall({
            tenantEmail: tenant.email,
            dialedNumber: tenant.inboundNumber,
            wasConnected: Number(normalizedEvent.durationSeconds || 0) > 0
        });

        await event.update({
            tenantEmail: tenant.email,
            payload: {
                callId: normalizedEvent.callId,
                result: finalization
            },
            status: 'processed',
            processedAt: new Date(),
            errorMessage: ''
        });

        return { ...persisted, duplicated: false, finalization };
    } catch (error) {
        await event.update({
            tenantEmail: tenant.email,
            status: 'failed',
            processedAt: null,
            errorMessage: String(error?.message || 'Call finalization failed').slice(0, 240)
        });
        throw error;
    }
};

module.exports = {
    parseRetellSignature,
    verifyRetellRequest,
    normalizeInboundRequest,
    buildInboundRetryKey,
    normalizeFunctionRequest,
    normalizeCallEvent,
    persistCallEvent,
    handleInboundCall,
    executeRetellTool,
    processRetellCallEvent
};
