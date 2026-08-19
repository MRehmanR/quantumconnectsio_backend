const {
    AUTOMATION_SHARED_KEY,
    N8N_USAGE_THRESHOLD_WEBHOOK_URL,
    N8N_MANUAL_APPOINTMENT_WEBHOOK_URL,
    N8N_GOOGLE_REVIEW_WEBHOOK_URL,
    N8N_WAITLIST_WEBHOOK_URL
} = require('../config/env');

const buildN8nJob = ({ jobType, jobId, tenant, payload, occurredAt }) => {
    const normalizedJobType = String(jobType || '').trim();
    const normalizedJobId = String(jobId || '').trim();
    const tenantId = String(tenant?.id || '').trim();
    const inboundNumber = String(tenant?.inboundNumber || '').trim();

    if (!normalizedJobType) {
        throw new Error('n8n job type is required.');
    }
    if (!normalizedJobId) {
        throw new Error('n8n job id is required.');
    }
    if (!tenantId) {
        throw new Error('n8n tenant id is required.');
    }
    if (!inboundNumber) {
        throw new Error('n8n tenant inbound number is required.');
    }

    return {
        jobType: normalizedJobType,
        jobId: normalizedJobId,
        tenant: {
            id: tenantId,
            email: String(tenant?.email || ''),
            inboundNumber,
            timezone: String(tenant?.timezone || 'UTC')
        },
        occurredAt: occurredAt || new Date().toISOString(),
        payload: payload && typeof payload === 'object' ? payload : {}
    };
};

const webhookUrlForJob = (jobType) => {
    const normalized = String(jobType || '');
    if (normalized.startsWith('usage.threshold.')) {
        return N8N_USAGE_THRESHOLD_WEBHOOK_URL;
    }
    if (normalized.startsWith('appointment.')) {
        return N8N_MANUAL_APPOINTMENT_WEBHOOK_URL;
    }
    if (normalized.startsWith('review.')) {
        return N8N_GOOGLE_REVIEW_WEBHOOK_URL;
    }
    if (normalized.startsWith('waitlist.')) {
        return N8N_WAITLIST_WEBHOOK_URL;
    }
    return '';
};

const recordDispatchFailure = async (job, message, status) => {
    const { AutomationEvent } = require('../models');
    try {
        await AutomationEvent.create({
            source: 'system',
            eventType: 'n8n.dispatch.failed',
            idempotencyKey: `n8n_dispatch_failed:${job.jobId}`,
            tenantEmail: job.tenant.email,
            occurredAt: new Date(),
            payload: {
                jobType: job.jobType,
                jobId: job.jobId,
                tenantId: job.tenant.id,
                status,
                message: String(message || '').slice(0, 240)
            },
            status: 'failed',
            processedAt: new Date(),
            errorMessage: String(message || '').slice(0, 240)
        });
    } catch (error) {
        const duplicate = String(error?.name || '').includes('Unique') || /unique/i.test(String(error?.message || ''));
        if (!duplicate) {
            console.error('Failed to record n8n dispatch failure:', error?.message || error);
        }
    }
};

const dispatchN8nJob = async (job, options = {}) => {
    const url = String(options.url || webhookUrlForJob(job?.jobType) || '').trim();
    if (!url) {
        return {
            attempted: false,
            ok: false,
            status: 0,
            message: 'Webhook URL is not configured'
        };
    }

    const fetchImpl = options.fetchImpl || fetch;
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-automation-key': String(AUTOMATION_SHARED_KEY || '')
            },
            body: JSON.stringify(job)
        });
        const responseText = await response.text().catch(() => '');
        if (!response.ok) {
            const message = responseText || `HTTP ${response.status}`;
            await recordDispatchFailure(job, message, response.status);
            return { attempted: true, ok: false, status: response.status, message };
        }

        return {
            attempted: true,
            ok: true,
            status: response.status,
            message: responseText || 'Webhook accepted'
        };
    } catch (error) {
        const message = String(error?.message || 'n8n webhook request failed');
        await recordDispatchFailure(job, message, 0);
        return { attempted: true, ok: false, status: 0, message };
    }
};

module.exports = {
    buildN8nJob,
    dispatchN8nJob
};
