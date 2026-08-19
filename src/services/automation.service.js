const crypto = require('crypto');
const { Op } = require('sequelize');
const {
    AutomationEvent,
    WorkflowExecution,
    User,
    CallLog,
    CallContact,
    Appointment,
    AppointmentContact,
    WaitlistEntry,
    EscalationLog,
    OutboundCall,
    KbQueryLog,
    UsageCycle,
    AuditLog
} = require('../models');
const { sequelize } = require('../config/db');
const { AUTOMATION_SHARED_KEY, RETELL_API_KEY } = require('../config/env');
const usageEnforcementService = require('./usage-enforcement.service');
const { buildN8nJob, dispatchN8nJob } = require('./n8n-dispatch.service');

const normalizeIdempotencyKey = ({ idempotencyKey, eventType, occurredAt, payload }) => {
    if (idempotencyKey && String(idempotencyKey).trim()) {
        return String(idempotencyKey).trim();
    }

    const fingerprint = JSON.stringify({ eventType, occurredAt, payload });
    const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');
    return `hash_${hash}`;
};

const getPayloadCallId = (payload = {}) =>
    String(
        payload.callId ||
        payload.call_id ||
        payload.call?.call_id ||
        payload.call?.id ||
        payload.id ||
        payload.retellCallId ||
        ''
    ).trim();

const normalizeRetellEventType = (eventType) => {
    const raw = String(eventType || '').trim();
    const normalized = raw.replace(/_/g, '.').toLowerCase();
    const aliases = {
        'call.analyzed': 'call.completed',
        'call.completed': 'call.completed',
        'call.completed.webhook': 'call.completed'
    };

    return aliases[normalized] || raw || 'unknown';
};

const normalizeSemanticIdempotencyKey = ({ source, eventType, idempotencyKey, payload }) => {
    const normalizedSource = String(source || '').trim().toLowerCase();
    const callId = getPayloadCallId(payload);
    if (normalizedSource === 'retell' && callId) {
        return `retell_${eventType}_${callId}`;
    }

    return idempotencyKey;
};

const timingSafeCompare = (left, right) => {
    const leftBuffer = Buffer.from(left || '', 'utf8');
    const rightBuffer = Buffer.from(right || '', 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyRetellSignature = ({ rawBody, signature }) => {
    const { verifyRetellRequest } = require('./retell-integration.service');
    return verifyRetellRequest({
        rawBody,
        signature,
        apiKey: RETELL_API_KEY
    });
};

const verifyAutomationKey = (providedKey) => {
    if (!AUTOMATION_SHARED_KEY) {
        return false;
    }

    return timingSafeCompare(AUTOMATION_SHARED_KEY, providedKey || '');
};

const identifyInboundClient = async ({ tenantEmail, dialedNumber, callerNumber }) => {
    const business = await resolveTenantForRouting({ tenantEmail, dialedNumber, transaction: undefined });

    if (!business) {
        return {
            found: false,
            business: null,
            callerNumber: callerNumber || ''
        };
    }

    return {
        found: true,
        business: {
            id: business.id,
            email: business.email,
            businessName: business.businessName,
            inboundNumber: business.inboundNumber,
            ownerForwardNumber: business.ownerPhone || '',
            active: business.status === 'Active'
        },
        callerNumber: callerNumber || ''
    };
};

const getUsageSnapshot = async ({ businessId, tenantEmail }) => {
    let user = null;

    if (businessId) {
        user = await User.findByPk(Number(businessId));
    }

    if (!user && tenantEmail) {
        user = await User.findOne({ where: { email: tenantEmail } });
    }

    if (!user) {
        return {
            found: false,
            usagePercent: 100,
            hasMinutes: false,
            threshold70Reached: true,
            threshold100Reached: true,
            usage: null
        };
    }

    const limits = usageEnforcementService.getPlanLimits(user.plan);
    const cycle = await UsageCycle.findOne({ where: { userId: user.id } });

    const includedLimit = Number(limits.includedCalls || 0);
    const includedUsed = Number(cycle?.includedCallsUsed || 0);
    const addonBalance = Number(cycle?.addonCallsBalance || 0);
    const addonUsed = Number(cycle?.addonCallsUsed || 0);
    const totalAllowance = includedLimit + addonBalance;
    const totalUsed = includedUsed + addonUsed;
    const usagePercent = includedLimit > 0 ? Math.round((includedUsed / includedLimit) * 100) : 0;
    const remaining = Math.max(totalAllowance - totalUsed, 0);

    return {
        found: true,
        usagePercent,
        hasMinutes: remaining > 0,
        threshold70Reached: usagePercent >= 70,
        threshold100Reached: usagePercent >= 100,
        usage: {
            userId: user.id,
            plan: user.plan,
            includedLimit,
            includedUsed,
            addonBalance,
            addonUsed,
            totalAllowance,
            totalUsed,
            remaining,
            concurrentActive: Number(cycle?.concurrentCallsActive || 0),
            concurrentLimit: Number(limits.concurrentCalls || 0)
        }
    };
};

const parseDurationSeconds = (payload = {}) => {
    if (typeof payload.durationSeconds === 'number') {
        return Math.max(Math.floor(payload.durationSeconds), 0);
    }

    if (typeof payload.duration_ms === 'number') {
        return Math.max(Math.floor(payload.duration_ms / 1000), 0);
    }

    return 60;
};

const resolveTenantUser = async (tenantEmail, transaction) => {
    if (!tenantEmail) {
        return null;
    }

    return User.findOne({
        where: { email: tenantEmail },
        transaction
    });
};

const resolveTenantForRouting = async ({ tenantEmail, dialedNumber, transaction }) => {
    let user = null;
    if (dialedNumber) {
        user = await User.findOne({ where: { inboundNumber: dialedNumber }, transaction });
    }
    if (!user && tenantEmail) {
        user = await User.findOne({ where: { email: tenantEmail }, transaction });
    }
    return user;
};

const processCallCompleted = async ({ tenantEmail, payload, transaction }) => {
    const durationSeconds = parseDurationSeconds(payload);
    const callStatus = payload.escalated ? 'Escalated' : payload.status || 'Completed';
    const tenant = await resolveTenantForRouting({
        tenantEmail,
        dialedNumber: payload.dialedNumber || payload.to_number || payload.to,
        transaction
    });

    const call = await CallLog.create(
        {
            userId: tenant?.id || null,
            inboundNumber: tenant?.inboundNumber || payload.dialedNumber || payload.to_number || payload.to || '',
            callerNumber: payload.callerPhone || payload.from_number || 'Unknown',
            callTime: payload.occurredAt || payload.callTime || new Date().toISOString(),
            durationSeconds,
            sentiment: payload.sentiment || 'Neutral',
            status: ['Completed', 'Escalated', 'Missed'].includes(callStatus) ? callStatus : 'Completed',
            transcript: payload.transcript || ''
        },
        { transaction }
    );

    await CallContact.create(
        {
            callLogId: call.id,
            name: payload.callerName || payload.customerName || 'Unknown Caller',
            phone: payload.callerPhone || payload.from_number || call.callerNumber,
            email: payload.callerEmail || ''
        },
        { transaction }
    );

    if (tenant) {
        const usageRow = await UsageCycle.findOne({ where: { userId: tenant.id }, transaction });
        if (usageRow) {
            usageRow.concurrentCallsActive = Math.max(Number(usageRow.concurrentCallsActive || 0) - 1, 0);
            await usageRow.save({ transaction });
        }
    }
};

const processAppointmentBooked = async ({ payload, transaction }) => {
    const tenant = await resolveTenantForRouting({
        tenantEmail: payload.tenantEmail,
        dialedNumber: payload.dialedNumber || payload.to_number || payload.to,
        transaction
    });

    const appointment = await Appointment.create(
        {
            userId: tenant?.id || null,
            inboundNumber: tenant?.inboundNumber || payload.dialedNumber || payload.to_number || payload.to || '',
            caller: payload.customerName || payload.callerName || 'Unknown Customer',
            appointmentDate: payload.date,
            appointmentTime: payload.time,
            type: payload.serviceType || payload.type || 'Consultation',
            status: 'Confirmed'
        },
        { transaction }
    );

    await AppointmentContact.create(
        {
            appointmentId: appointment.id,
            name: payload.customerName || payload.callerName || 'Unknown Customer',
            phone: payload.customerPhone || payload.callerPhone || '',
            email: payload.customerEmail || payload.callerEmail || ''
        },
        { transaction }
    );
};

const processAppointmentCancelled = async ({ payload, transaction }) => {
    const byId = payload.appointmentId
        ? await Appointment.findByPk(payload.appointmentId, { transaction })
        : null;

    let appointment = byId;

    if (!appointment && payload.customerPhone && payload.date) {
        appointment = await Appointment.findOne({
            where: {
                appointmentDate: payload.date,
                appointmentTime: payload.time || { [Op.not]: null },
                status: {
                    [Op.in]: ['Pending', 'Confirmed']
                }
            },
            order: [['createdAt', 'DESC']],
            transaction
        });
    }

    if (appointment) {
        appointment.status = 'Cancelled';
        await appointment.save({ transaction });

        await AutomationEvent.create(
            {
                source: 'system',
                eventType: 'waitlist.process.requested',
                idempotencyKey: `waitlist_${appointment.id}_${new Date().toISOString().slice(0, 16)}`,
                tenantEmail: payload.tenantEmail || '',
                occurredAt: new Date(),
                payload: {
                    appointmentId: appointment.id,
                    appointmentDate: appointment.appointmentDate,
                    appointmentTime: appointment.appointmentTime,
                    type: appointment.type
                },
                status: 'processed',
                processedAt: new Date()
            },
            { transaction }
        );
    }
};

const processEscalationTriggered = async ({ tenantEmail, payload, transaction }) => {
    const user = await resolveTenantUser(tenantEmail, transaction);
    await EscalationLog.create(
        {
            userId: user?.id || null,
            callLogId: payload.callLogId || null,
            reason: payload.reason || 'unspecified',
            ownerPhone: payload.ownerPhone || user?.ownerPhone || '',
            outcome: payload.outcome || 'transferred',
            transferredAt: payload.transferredAt || new Date(),
            voicemailAudioUrl: payload.voicemailAudioUrl || '',
            voicemailTranscript: payload.voicemailTranscript || ''
        },
        { transaction }
    );
};

const processKbQuery = async ({ tenantEmail, payload, transaction }) => {
    const user = await resolveTenantUser(tenantEmail, transaction);
    await KbQueryLog.create(
        {
            userId: user?.id || null,
            queryText: payload.queryText || payload.query || '',
            answerText: payload.answerText || payload.answer || '',
            confidence: Number(payload.confidence || 0),
            escalated: Boolean(payload.escalated)
        },
        { transaction }
    );
};

const processOutboundOutcome = async ({ tenantEmail, payload, transaction }) => {
    const user = await resolveTenantUser(tenantEmail, transaction);
    await OutboundCall.create(
        {
            userId: user?.id || null,
            relatedAppointmentId: payload.relatedAppointmentId || null,
            callType: payload.callType || 'custom',
            toPhone: payload.toPhone || '',
            scheduledAt: payload.scheduledAt || null,
            completedAt: payload.completedAt || new Date(),
            outcome: payload.outcome || 'no_answer',
            metadata: payload.metadata || {}
        },
        { transaction }
    );
};

const eventHandlers = {
    'call.completed': processCallCompleted,
    'appointment.booked': processAppointmentBooked,
    'appointment.cancelled': processAppointmentCancelled,
    'escalation.triggered': processEscalationTriggered,
    'kb.query': processKbQuery,
    'outbound.call.outcome': processOutboundOutcome
};

const maybeEmitThresholdEvents = async ({ userId, tenantEmail, usage }) => {
    const cycle = await UsageCycle.findOne({ where: { userId } });
    if (!cycle) {
        return;
    }
    const tenant = await User.findByPk(userId);
    const dispatchThreshold = async (threshold) => {
        if (!tenant?.inboundNumber) {
            return;
        }
        const cycleDate = new Date(cycle.cycleStart).toISOString().slice(0, 10);
        const job = buildN8nJob({
            jobType: `usage.threshold.${threshold}`,
            jobId: `usage:${threshold}:${userId}:${cycleDate}`,
            tenant,
            payload: { usage, threshold }
        });
        await dispatchN8nJob(job);
    };

    if (usage.threshold70Reached && !cycle.alert70SentAt) {
        cycle.alert70SentAt = new Date();
        await cycle.save();
        await AutomationEvent.create({
            source: 'system',
            eventType: 'usage.threshold.70',
            idempotencyKey: `usage70_${userId}_${new Date(cycle.cycleStart).toISOString().slice(0, 10)}`,
            tenantEmail: tenantEmail || '',
            occurredAt: new Date(),
            payload: {
                userId,
                usage
            },
            status: 'processed',
            processedAt: new Date()
        });
        await dispatchThreshold(70);
    }

    if (usage.threshold100Reached && !cycle.alert100SentAt) {
        cycle.alert100SentAt = new Date();
        await cycle.save();
        await AutomationEvent.create({
            source: 'system',
            eventType: 'usage.threshold.100',
            idempotencyKey: `usage100_${userId}_${new Date(cycle.cycleStart).toISOString().slice(0, 10)}`,
            tenantEmail: tenantEmail || '',
            occurredAt: new Date(),
            payload: {
                userId,
                usage
            },
            status: 'processed',
            processedAt: new Date()
        });
        await dispatchThreshold(100);
    }
};

const ingestEvent = async ({ source, eventType, idempotencyKey, tenantEmail, occurredAt, payload }) => {
    const resolvedType = String(source || '').toLowerCase() === 'retell'
        ? normalizeRetellEventType(eventType)
        : (eventType || 'unknown');
    const semanticIdempotencyKey = normalizeSemanticIdempotencyKey({
        source,
        eventType: resolvedType,
        idempotencyKey,
        payload: payload || {}
    });
    const finalIdempotencyKey = normalizeIdempotencyKey({
        idempotencyKey: semanticIdempotencyKey,
        eventType: resolvedType,
        occurredAt,
        payload
    });

    const existing = await AutomationEvent.findOne({
        where: { idempotencyKey: finalIdempotencyKey }
    });

    if (existing) {
        return {
            duplicated: true,
            eventId: existing.id,
            status: existing.status
        };
    }

    return sequelize.transaction(async (transaction) => {
        const event = await AutomationEvent.create(
            {
                source,
                eventType: resolvedType,
                idempotencyKey: finalIdempotencyKey,
                tenantEmail: tenantEmail || '',
                occurredAt: occurredAt || new Date(),
                payload: payload || {},
                status: 'received'
            },
            { transaction }
        );

        try {
            const handler = eventHandlers[resolvedType];
            if (handler) {
                await handler({ tenantEmail, payload: payload || {}, transaction });
            }

            event.status = 'processed';
            event.processedAt = new Date();
            event.errorMessage = '';
            await event.save({ transaction });

            return {
                duplicated: false,
                eventId: event.id,
                status: event.status
            };
        } catch (error) {
            event.status = 'failed';
            event.processedAt = new Date();
            event.errorMessage = error.message || 'Event processing failed';
            await event.save({ transaction });
            throw error;
        }
    });
};

const upsertWorkflowExecution = async ({ workflowKey, executionId, status, tenantEmail, startedAt, finishedAt, metadata }) => {
    const existing = await WorkflowExecution.findOne({ where: { executionId } });

    if (!existing) {
        const created = await WorkflowExecution.create({
            workflowKey,
            executionId,
            status: status || 'running',
            tenantEmail: tenantEmail || '',
            startedAt: startedAt || new Date(),
            finishedAt: finishedAt || null,
            metadata: metadata || {}
        });

        return created;
    }

    existing.status = status || existing.status;
    existing.workflowKey = workflowKey || existing.workflowKey;
    existing.tenantEmail = tenantEmail || existing.tenantEmail;
    existing.startedAt = startedAt || existing.startedAt;
    existing.finishedAt = finishedAt || existing.finishedAt;
    existing.metadata = metadata || existing.metadata;

    await existing.save();
    return existing;
};

const getAutomationOverview = async () => {
    const [recentEvents, recentExecutions] = await Promise.all([
        AutomationEvent.findAll({
            order: [['createdAt', 'DESC']],
            limit: 25
        }),
        WorkflowExecution.findAll({
            order: [['updatedAt', 'DESC']],
            limit: 25
        })
    ]);

    return {
        events: recentEvents.map((event) => ({
            id: String(event.id),
            source: event.source,
            eventType: event.eventType,
            idempotencyKey: event.idempotencyKey,
            tenantEmail: event.tenantEmail,
            status: event.status,
            occurredAt: event.occurredAt,
            processedAt: event.processedAt,
            errorMessage: event.errorMessage
        })),
        executions: recentExecutions.map((execution) => ({
            id: String(execution.id),
            workflowKey: execution.workflowKey,
            executionId: execution.executionId,
            status: execution.status,
            tenantEmail: execution.tenantEmail,
            startedAt: execution.startedAt,
            finishedAt: execution.finishedAt,
            metadata: execution.metadata
        }))
    };
};

const preflightInboundCall = async ({ tenantEmail, dialedNumber, callerNumber, idempotencyKey }) => {
    const normalizedKey = String(idempotencyKey || '').trim();
    const eventKey = normalizedKey ? `call_preflight_${normalizedKey}` : '';

    if (eventKey) {
        const existing = await AutomationEvent.findOne({ where: { idempotencyKey: eventKey } });
        if (existing?.payload?.result) {
            return {
                ...existing.payload.result,
                duplicated: true
            };
        }
    }

    const result = await usageEnforcementService.preflightCall({
        tenantEmail,
        dialedNumber,
        callerNumber,
        idempotencyKey
    });

    if (result.accepted && result.userId && result.usage) {
        await maybeEmitThresholdEvents({ userId: result.userId, tenantEmail, usage: result.usage });
    }

    if (eventKey) {
        try {
            await AutomationEvent.create({
                source: 'system',
                eventType: 'call.preflight',
                idempotencyKey: eventKey,
                tenantEmail: tenantEmail || '',
                occurredAt: new Date(),
                payload: {
                    dialedNumber: dialedNumber || '',
                    callerNumber: callerNumber || '',
                    result
                },
                status: 'processed',
                processedAt: new Date()
            });
        } catch (error) {
            const duplicate = String(error?.name || '').includes('Unique') || String(error?.message || '').includes('unique');
            if (!duplicate) {
                throw error;
            }
        }
    }

    return result;
};

const listDailySummaryTenants = async () => {
    const users = await User.findAll({
        where: {
            role: 'user',
            status: 'Active'
        },
        attributes: ['id', 'email', 'inboundNumber', 'timezone'],
        order: [['id', 'ASC']]
    });

    return users
        .filter((user) => String(user.inboundNumber || '').trim())
        .map((user) => ({
            id: String(user.id),
            email: user.email,
            inboundNumber: user.inboundNumber,
            timezone: user.timezone || 'UTC'
        }));
};
const finalizeInboundCall = async ({ tenantEmail, dialedNumber, wasConnected }) => {
    return usageEnforcementService.finalizeCall({ tenantEmail, dialedNumber, wasConnected });
};

const triggerWaitlistBatch = async ({ tenantEmail, batchSize = 3 }) => {
    const user = await resolveTenantForRouting({ tenantEmail, transaction: undefined });
    const where = {
        status: 'pending'
    };
    if (user) {
        where.userId = user.id;
    }

    const entries = await WaitlistEntry.findAll({
        where,
        order: [
            ['priorityIndex', 'ASC'],
            ['createdAt', 'ASC']
        ],
        limit: Number(batchSize)
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    for (const entry of entries) {
        entry.status = 'notified';
        entry.notifiedAt = new Date();
        entry.expiresAt = expiresAt;
        await entry.save();

        await OutboundCall.create({
            userId: entry.userId,
            callType: 'waitlist',
            toPhone: entry.customerPhone,
            scheduledAt: new Date(),
            outcome: 'no_answer',
            metadata: {
                waitlistEntryId: entry.id,
                customerName: entry.customerName,
                customerEmail: entry.customerEmail
            }
        });
    }

    return {
        notifiedCount: entries.length,
        expiresAt,
        entries: entries.map((entry) => ({
            id: entry.id,
            customerName: entry.customerName,
            customerPhone: entry.customerPhone,
            customerEmail: entry.customerEmail,
            preferredDate: entry.preferredDate,
            preferredTimeWindow: entry.preferredTimeWindow
        }))
    };
};

const handleWaitlistResponse = async ({ waitlistEntryId, customerPhone, reply, tenantEmail, metadata = {} }) => {
    const normalizedReply = String(reply || '').trim().toLowerCase();
    const normalizedPhone = String(customerPhone || '').trim();

    if (!waitlistEntryId && !normalizedPhone) {
        throw new Error('waitlistEntryId or customerPhone is required');
    }

    const where = {};
    if (waitlistEntryId) {
        where.id = Number(waitlistEntryId);
    } else {
        where.customerPhone = normalizedPhone;
        where.status = { [Op.in]: ['notified', 'pending'] };
    }

    if (tenantEmail) {
        const tenant = await resolveTenantForRouting({ tenantEmail, transaction: undefined });
        if (tenant) {
            where.userId = tenant.id;
        }
    }

    const entry = await WaitlistEntry.findOne({
        where,
        order: [['createdAt', 'DESC']]
    });

    if (!entry) {
        throw new Error('Waitlist entry not found');
    }

    const accepted = ['yes', 'y', 'accept', 'book', 'ok', 'confirm'].includes(normalizedReply);
    const declined = ['no', 'n', 'decline', 'skip', 'later'].includes(normalizedReply);

    if (!accepted && !declined) {
        return {
            handled: false,
            status: entry.status,
            message: 'Unrecognized waitlist reply'
        };
    }

    entry.status = accepted ? 'accepted' : 'skipped';
    entry.metadata = {
        ...(entry.metadata || {}),
        response: normalizedReply,
        respondedAt: new Date().toISOString(),
        ...metadata
    };
    await entry.save();

    await OutboundCall.create({
        userId: entry.userId,
        callType: 'waitlist',
        toPhone: entry.customerPhone,
        scheduledAt: new Date(),
        completedAt: new Date(),
        outcome: accepted ? 'confirmed' : 'cancelled',
        metadata: {
            waitlistEntryId: entry.id,
            response: normalizedReply,
            source: 'waitlist.reply'
        }
    });

    return {
        handled: true,
        accepted,
        status: entry.status,
        waitlistEntryId: entry.id,
        customerPhone: entry.customerPhone,
        customerName: entry.customerName
    };
};

const generateDailySummary = async ({ tenantEmail, targetDate }) => {
    const date = targetDate ? new Date(targetDate) : new Date();
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const user = tenantEmail ? await User.findOne({ where: { email: tenantEmail } }) : null;

    const [totalCalls, bookings, cancellations, escalations, noShows, kbQueries] = await Promise.all([
        CallLog.count({ where: { callTime: { [Op.between]: [start, end] } } }),
        Appointment.count({ where: { createdAt: { [Op.between]: [start, end] }, status: { [Op.in]: ['Confirmed', 'Pending'] } } }),
        Appointment.count({ where: { updatedAt: { [Op.between]: [start, end] }, status: 'Cancelled' } }),
        EscalationLog.count({ where: { createdAt: { [Op.between]: [start, end] }, ...(user ? { userId: user.id } : {}) } }),
        Appointment.count({ where: { updatedAt: { [Op.between]: [start, end] }, status: 'NoShow' } }),
        KbQueryLog.count({ where: { createdAt: { [Op.between]: [start, end] }, ...(user ? { userId: user.id } : {}) } })
    ]);

    const payload = {
        date: start.toISOString().slice(0, 10),
        totalCalls,
        bookings,
        cancellations,
        escalations,
        noShows,
        kbQueries
    };

    await AutomationEvent.create({
        source: 'system',
        eventType: 'daily.summary.generated',
        idempotencyKey: `daily_summary_${tenantEmail || 'all'}_${payload.date}`,
        tenantEmail: tenantEmail || '',
        occurredAt: new Date(),
        payload,
        status: 'processed',
        processedAt: new Date()
    });

    return payload;
};

const runRetentionCleanup = async ({ retentionDays = 90 }) => {
    const cutoff = new Date(Date.now() - Number(retentionDays) * 24 * 60 * 60 * 1000);

    const oldCalls = await CallLog.findAll({
        where: {
            callTime: {
                [Op.lt]: cutoff
            }
        },
        attributes: ['id']
    });
    const oldCallIds = oldCalls.map((call) => call.id);

    const [deletedCallContacts, deletedCalls, deletedEvents, deletedExecutions, deletedKbLogs, deletedEscalations, deletedOutbound, deletedAudits] =
        await Promise.all([
            oldCallIds.length > 0 ? CallContact.destroy({ where: { callLogId: { [Op.in]: oldCallIds } } }) : 0,
            oldCallIds.length > 0 ? CallLog.destroy({ where: { id: { [Op.in]: oldCallIds } } }) : 0,
            AutomationEvent.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
            WorkflowExecution.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
            KbQueryLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
            EscalationLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
            OutboundCall.destroy({ where: { createdAt: { [Op.lt]: cutoff } } }),
            AuditLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } })
        ]);

    return {
        retentionDays: Number(retentionDays),
        cutoff,
        deleted: {
            callContacts: deletedCallContacts,
            calls: deletedCalls,
            events: deletedEvents,
            executions: deletedExecutions,
            kbLogs: deletedKbLogs,
            escalations: deletedEscalations,
            outboundCalls: deletedOutbound,
            auditLogs: deletedAudits
        }
    };
};

const runGdprDelete = async ({ userId }) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found');
    }

    await sequelize.transaction(async (transaction) => {
        await UsageCycle.destroy({ where: { userId }, transaction });
        await WaitlistEntry.destroy({ where: { userId }, transaction });
        await KbQueryLog.destroy({ where: { userId }, transaction });
        await EscalationLog.destroy({ where: { userId }, transaction });
        await OutboundCall.destroy({ where: { userId }, transaction });

        await AutomationEvent.update(
            { tenantEmail: '' },
            { where: { tenantEmail: user.email }, transaction }
        );

        await WorkflowExecution.update(
            { tenantEmail: '' },
            { where: { tenantEmail: user.email }, transaction }
        );

        await user.destroy({ transaction });
    });

    return {
        deletedUserId: userId,
        status: 'deleted'
    };
};

module.exports = {
    ingestEvent,
    upsertWorkflowExecution,
    getAutomationOverview,
    listDailySummaryTenants,
    preflightInboundCall,
    finalizeInboundCall,
    triggerWaitlistBatch,
    handleWaitlistResponse,
    generateDailySummary,
    runRetentionCleanup,
    runGdprDelete,
    verifyRetellSignature,
    verifyAutomationKey,
    identifyInboundClient,
    getUsageSnapshot
};
