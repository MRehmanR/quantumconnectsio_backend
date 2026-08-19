const automationService = require('../services/automation.service');
const provisioningService = require('../services/provisioning.service');
const dashboardDataService = require('../services/dashboard-data.service');
const retellIntegrationService = require('../services/retell-integration.service');
const { RETELL_API_KEY } = require('../config/env');

const readSignature = (req) => req.headers['x-retell-signature'] || req.headers['x-webhook-signature'] || '';

const requireAutomationKey = (req, res) => {
    const providedKey = req.headers['x-automation-key'];
    const authorized = automationService.verifyAutomationKey(providedKey);

    if (!authorized) {
        res.status(401).json({ success: false, message: 'Invalid automation key' });
        return false;
    }

    return true;
};

const getDialedNumber = (body = {}) =>
    body.dialedNumber || body.to_number || body.to || body.To || body.payload?.to_number || body.payload?.to || body.payload?.To;

const getCallerNumber = (body = {}) =>
    body.callerNumber || body.callerPhone || body.from_number || body.from || body.From || body.payload?.from_number || body.payload?.from || body.payload?.From;

const requireRetellSignature = (req, res) => {
    const valid = retellIntegrationService.verifyRetellRequest({
        rawBody: req.rawBody,
        signature: readSignature(req),
        apiKey: RETELL_API_KEY
    });

    if (!valid) {
        res.status(401).json({ success: false, message: 'Invalid Retell signature' });
        return false;
    }

    return true;
};

exports.handleRetellInbound = async (req, res) => {
    try {
        if (!requireRetellSignature(req, res)) {
            return;
        }

        const normalized = retellIntegrationService.normalizeInboundRequest(req.body);
        const result = await retellIntegrationService.handleInboundCall(normalized, {
            preflightKey: req.body?.call_inbound?.call_id || req.body?.event_id || ''
        });

        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to route inbound call' });
    }
};

exports.handleRetellFunction = async (req, res) => {
    try {
        if (!requireRetellSignature(req, res)) {
            return;
        }

        const normalized = retellIntegrationService.normalizeFunctionRequest(req.body);
        const result = await retellIntegrationService.executeRetellTool(normalized);

        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to execute Retell function' });
    }
};

exports.handleRetellEvent = async (req, res) => {
    try {
        if (!requireRetellSignature(req, res)) {
            return;
        }

        const normalized = retellIntegrationService.normalizeCallEvent(req.body);
        const data = await retellIntegrationService.processRetellCallEvent(normalized);

        return res.status(202).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to process Retell event' });
    }
};

exports.ingestRetellWebhook = exports.handleRetellEvent;
exports.identifyInboundClient = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const data = await automationService.identifyInboundClient({
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body),
            callerNumber: getCallerNumber(req.body)
        });

        return res.status(200).json({ success: true, data, business: data.business || null });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to identify inbound client' });
    }
};

exports.checkUsageLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const data = await automationService.getUsageSnapshot({
            businessId: req.body.businessId,
            tenantEmail: req.body.tenantEmail
        });

        return res.status(200).json({ success: true, data, usagePercent: data.usagePercent, hasMinutes: data.hasMinutes });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to check usage snapshot' });
    }
};

exports.checkAppointmentAvailabilityLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const requestedSlot = req.body.requestedSlot || {};
        const date = requestedSlot.date || (typeof requestedSlot === 'string' ? requestedSlot.slice(0, 10) : req.body.date);
        const requestedTime = requestedSlot.time || (typeof requestedSlot === 'string' ? requestedSlot.slice(11, 16) : req.body.time);

        const availability = await dashboardDataService.getAppointmentAvailability({
            date,
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body)
        });
        const availableSlots = Array.isArray(availability.availableSlots) ? availability.availableSlots : [];

        return res.status(200).json({
            success: true,
            data: {
                available: Boolean(requestedTime && availableSlots.includes(requestedTime)),
                alternativeSlots: availableSlots.slice(0, 5),
                date
            }
        });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to check appointment availability' });
    }
};

exports.bookAppointmentLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const requestedSlot = req.body.requestedSlot || {};
        const customer = req.body.customer || {};
        const data = await dashboardDataService.createAppointment({
            customerName: customer.name || req.body.customerName || 'Unknown Caller',
            customerPhone: customer.phone || req.body.customerPhone || '',
            customerEmail: customer.email || req.body.customerEmail || '',
            date: requestedSlot.date || (typeof requestedSlot === 'string' ? requestedSlot.slice(0, 10) : req.body.date),
            time: requestedSlot.time || (typeof requestedSlot === 'string' ? requestedSlot.slice(11, 16) : req.body.time),
            type: req.body.service || req.body.type || 'Consultation',
            status: 'Confirmed',
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body)
        });

        return res.status(201).json({ success: true, data, booking: data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'INVALID_TIME_FORMAT') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'SLOT_UNAVAILABLE') {
            return res.status(409).json({ success: false, message: 'Requested slot is unavailable', data: { alternatives: error.alternatives || [] } });
        }

        return res.status(500).json({ success: false, message: error.message || 'Failed to book appointment' });
    }
};

exports.rescheduleAppointmentLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const newSlot = req.body.newSlot || {};
        const data = await dashboardDataService.rescheduleAppointment({
            appointmentId: req.body.appointmentId,
            date: newSlot.date || (typeof newSlot === 'string' ? newSlot.slice(0, 10) : req.body.date),
            time: newSlot.time || (typeof newSlot === 'string' ? newSlot.slice(11, 16) : req.body.time),
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body)
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data, booking: data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to reschedule appointment' });
    }
};

exports.cancelAppointmentLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const data = await dashboardDataService.cancelAppointment({
            appointmentId: req.body.appointmentId,
            reason: req.body.reason || 'caller_requested',
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body)
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data, booking: data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to cancel appointment' });
    }
};

exports.dispatchNotificationLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const notificationType = req.body.type || 'notification.dispatch';
        const mappedType = notificationType === 'usage.threshold.alert'
            ? (Number(req.body.payload?.usagePercent || 0) >= 100 ? 'usage.threshold.100' : 'usage.threshold.70')
            : notificationType;

        const payload = {
            ...req.body,
            channels: req.body.channels || ['sms', 'email']
        };

        const data = await automationService.ingestEvent({
            source: 'n8n',
            eventType: mappedType,
            idempotencyKey: req.body.idempotencyKey || `${mappedType}_${Date.now()}`,
            tenantEmail: req.body.tenantEmail,
            occurredAt: new Date(),
            payload
        });

        return res.status(202).json({ success: true, data, queued: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to dispatch notification' });
    }
};

exports.queryKnowledgeBaseLegacy = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const query = String(req.body.query || '').trim().toLowerCase();
        const entries = await dashboardDataService.getKnowledgeBaseEntries();
        const match = entries.find((entry) => {
            const title = String(entry.title || '').toLowerCase();
            const content = String(entry.content || '').toLowerCase();
            return title.includes(query) || content.includes(query);
        }) || entries[0] || null;

        await automationService.ingestEvent({
            source: 'n8n',
            eventType: 'kb.query',
            idempotencyKey: req.body.idempotencyKey || `kb_${Date.now()}`,
            tenantEmail: req.body.tenantEmail,
            occurredAt: new Date(),
            payload: {
                query: req.body.query || '',
                answer: match ? match.content : '',
                confidence: match ? 0.7 : 0,
                escalated: !match
            }
        });

        return res.status(200).json({
            success: true,
            data: {
                answer: match ? match.content : 'No knowledge base answer found.',
                confidence: match ? 0.7 : 0,
                escalated: !match
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to query knowledge base' });
    }
};

exports.ingestAutomationEvent = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);

        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.ingestEvent({
            source: req.body.source || 'n8n',
            eventType: req.body.eventType,
            idempotencyKey: req.body.idempotencyKey,
            tenantEmail: req.body.tenantEmail,
            occurredAt: req.body.occurredAt,
            payload: req.body.payload || {}
        });

        return res.status(202).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to ingest automation event' });
    }
};

exports.upsertWorkflowExecution = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);

        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const execution = await automationService.upsertWorkflowExecution({
            workflowKey: req.body.workflowKey,
            executionId: req.body.executionId,
            status: req.body.status,
            tenantEmail: req.body.tenantEmail,
            startedAt: req.body.startedAt,
            finishedAt: req.body.finishedAt,
            metadata: req.body.metadata
        });

        return res.status(200).json({ success: true, data: execution });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to upsert workflow execution' });
    }
};

exports.getAutomationOverview = async (req, res) => {
    try {
        const data = await automationService.getAutomationOverview();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch automation overview' });
    }
};

exports.listDailySummaryTenants = async (req, res) => {
    try {
        if (!requireAutomationKey(req, res)) {
            return;
        }

        const data = await automationService.listDailySummaryTenants();
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to list daily summary tenants' });
    }
};
exports.preflightInboundCall = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.preflightInboundCall({
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body),
            callerNumber: getCallerNumber(req.body),
            idempotencyKey: req.body.idempotencyKey
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to run call preflight' });
    }
};

exports.finalizeInboundCall = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.finalizeInboundCall({
            tenantEmail: req.body.tenantEmail,
            dialedNumber: getDialedNumber(req.body),
            wasConnected: req.body.wasConnected
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to finalize inbound call' });
    }
};

exports.triggerWaitlistBatch = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.triggerWaitlistBatch({
            tenantEmail: req.body.tenantEmail,
            batchSize: req.body.batchSize
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to trigger waitlist batch' });
    }
};

exports.handleWaitlistResponse = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.handleWaitlistResponse({
            waitlistEntryId: req.body.waitlistEntryId,
            customerPhone: req.body.customerPhone,
            reply: req.body.reply,
            tenantEmail: req.body.tenantEmail,
            metadata: req.body.metadata || {}
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to handle waitlist response' });
    }
};

exports.generateDailySummary = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.generateDailySummary({
            tenantEmail: req.body.tenantEmail,
            targetDate: req.body.targetDate
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to generate daily summary' });
    }
};

exports.runRetentionCleanup = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await automationService.runRetentionCleanup({
            retentionDays: req.body.retentionDays || 90
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to run retention cleanup' });
    }
};

exports.runGdprDelete = async (req, res) => {
    try {
        const data = await automationService.runGdprDelete({
            userId: Number(req.params.userId)
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to run GDPR delete' });
    }
};

exports.retryProvisioning = async (req, res) => {
    try {
        const providedKey = req.headers['x-automation-key'];
        const authorized = automationService.verifyAutomationKey(providedKey);
        if (!authorized) {
            return res.status(401).json({ success: false, message: 'Invalid automation key' });
        }

        const data = await provisioningService.provisionForUser(Number(req.params.userId));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to retry provisioning' });
    }
};
