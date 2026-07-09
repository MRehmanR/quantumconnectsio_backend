const dashboardDataService = require('../services/dashboard-data.service');

const ok = (res, data) => res.status(200).json({ success: true, data });

exports.getDashboardOverview = async (req, res) => {
    try {
        const data = await dashboardDataService.getDashboardOverview({
            actor: req.user,
            range: req.query?.range,
            startDate: req.query?.startDate,
            endDate: req.query?.endDate
        });
        return ok(res, data);
    } catch (error) {
        if (error.code === 'INVALID_DATE_RANGE') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch dashboard overview' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const data = await dashboardDataService.getProfile({ actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch profile' });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const data = await dashboardDataService.updateProfile({
            actor: req.user,
            payload: req.body || {}
        });
        return ok(res, data);
    } catch (error) {
        if (error.code === 'INVALID_PROFILE_PAYLOAD') {
            return res.status(400).json({ success: false, message: error.message });
        }
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
            return res.status(409).json({ success: false, message: error.message });
        }
        if (error.code === 'INVALID_PHONE_FORMAT') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to update profile' });
    }
};

exports.getCalls = async (req, res) => {
    try {
        const data = await dashboardDataService.getCalls({
            search: req.query.search,
            filter: req.query.filter,
            actor: req.user
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch call logs' });
    }
};

exports.getAppointments = async (req, res) => {
    try {
        const data = await dashboardDataService.getAppointments({
            actor: req.user
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch appointments' });
    }
};

exports.generateDailySummary = async (req, res) => {
    try {
        const data = await dashboardDataService.generateManualDailySummary({
            actor: req.user,
            targetDate: req.body?.targetDate
        });
        return ok(res, data);
    } catch (error) {
        if (error.code === 'INVALID_TARGET_DATE' || error.code === 'FUTURE_DATE_NOT_ALLOWED') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to generate daily summary' });
    }
};

exports.getDailySummaryHistory = async (req, res) => {
    try {
        const data = await dashboardDataService.getDailySummaryHistory({
            actor: req.user,
            date: req.query?.date,
            startDate: req.query?.startDate,
            endDate: req.query?.endDate,
            limit: req.query?.limit
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch daily summary history' });
    }
};

exports.getKnowledgeBase = async (req, res) => {
    try {
        const data = await dashboardDataService.getKnowledgeBaseEntries({ actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch knowledge base entries' });
    }
};

exports.createKnowledgeBaseEntry = async (req, res) => {
    try {
        const { title, content, category, attachmentName, attachmentDataUrl } = req.body;
        if (!title || !content || !category) {
            return res.status(400).json({ success: false, message: 'title, content and category are required' });
        }

        if (attachmentName || attachmentDataUrl) {
            return res.status(400).json({ success: false, message: 'File uploads are not supported. Please add text only.' });
        }

        const data = await dashboardDataService.createKnowledgeBaseEntry({
            title,
            content,
            category,
            attachmentName,
            attachmentDataUrl,
            actor: req.user
        });
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to create knowledge base entry' });
    }
};

exports.createAppointment = async (req, res) => {
    try {
        const { customerName, customerPhone, customerEmail, date, time, type } = req.body;
        if (!customerName || !date || !time) {
            return res.status(400).json({
                success: false,
                message: 'customerName, date and time are required'
            });
        }

        const data = await dashboardDataService.createAppointment({
            customerName,
            customerPhone,
            customerEmail,
            date,
            time,
            type,
            tenantEmail: req.body.tenantEmail,
            dialedNumber: req.body.dialedNumber,
            ownerPhone: req.body.ownerPhone || req.body.ownerForwardNumber,
            actor: req.user
        });

        return res.status(201).json({ success: true, data });
    } catch (error) {
        if (error.code === 'INVALID_TIME_FORMAT' || error.code === 'INVALID_DATE_FORMAT') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'PAST_DATE_NOT_ALLOWED') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'SLOT_UNAVAILABLE') {
            return res.status(409).json({
                success: false,
                message: 'This time slot is not available. Please choose another slot.',
                data: {
                    alternatives: error.alternatives || []
                }
            });
        }

        if (error.code === 'INVALID_PHONE_FORMAT') {
            return res.status(400).json({ success: false, message: error.message });
        }

        return res.status(500).json({ success: false, message: 'Failed to create appointment' });
    }
};

exports.createDemoBooking = async (req, res) => {
    try {
        const {
            customerName,
            customerPhone,
            customerEmail,
            businessName,
            businessDetails,
            purchasePurpose,
            industry,
            callVolume,
            challenge,
            jobValue,
            currentSystem,
            timeline,
            timezone,
            geoLocation,
            time
        } = req.body || {};

        const data = await dashboardDataService.createDemoBooking({
            customerName,
            customerPhone,
            customerEmail,
            businessName,
            businessDetails,
            purchasePurpose,
            industry,
            callVolume,
            challenge,
            jobValue,
            currentSystem,
            timeline,
            timezone,
            geoLocation,
            time
        });

        return res.status(201).json({
            success: true,
            message: 'Demo appointment booked successfully',
            data
        });
    } catch (error) {
        if (error.code === 'INVALID_DEMO_BOOKING_PAYLOAD' || error.code === 'INVALID_TIME_FORMAT') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 'SLOT_UNAVAILABLE') {
            return res.status(409).json({
                success: false,
                message: 'This demo time slot is not available. Please choose another slot.',
                data: {
                    alternatives: error.alternatives || []
                }
            });
        }

        return res.status(500).json({ success: false, message: error.message || 'Failed to book demo appointment' });
    }
};

exports.getAppointmentAvailability = async (req, res) => {
    try {
        const data = await dashboardDataService.getAppointmentAvailability({
            date: req.query.date,
            tenantEmail: req.query.tenantEmail,
            dialedNumber: req.query.dialedNumber,
            ownerPhone: req.query.ownerPhone,
            actor: req.user
        });

        return ok(res, data);
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND' || error.code === 'INVALID_DATE_FORMAT' || error.code === 'PAST_DATE_NOT_ALLOWED') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: 'Failed to fetch appointment availability' });
    }
};

exports.updateAppointmentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: 'status is required' });
        }

        const data = await dashboardDataService.updateAppointmentStatus({
            appointmentId: req.params.id,
            status,
            tenantEmail: req.body?.tenantEmail,
            dialedNumber: req.body?.dialedNumber,
            ownerPhone: req.body?.ownerPhone || req.body?.ownerForwardNumber,
            actor: req.user
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND' || error.code === 'INVALID_APPOINTMENT_STATUS') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: 'Failed to update appointment status' });
    }
};

exports.cancelAppointment = async (req, res) => {
    try {
        const data = await dashboardDataService.cancelAppointment({
            appointmentId: req.params.id,
            reason: req.body?.reason,
            tenantEmail: req.body?.tenantEmail,
            dialedNumber: req.body?.dialedNumber,
            ownerPhone: req.body?.ownerPhone || req.body?.ownerForwardNumber,
            actor: req.user
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: 'Failed to cancel appointment' });
    }
};

exports.rescheduleAppointment = async (req, res) => {
    try {
        const { date, time } = req.body;
        if (!date || !time) {
            return res.status(400).json({ success: false, message: 'date and time are required' });
        }

        const data = await dashboardDataService.rescheduleAppointment({
            appointmentId: req.params.id,
            date,
            time,
            tenantEmail: req.body?.tenantEmail,
            dialedNumber: req.body?.dialedNumber,
            ownerPhone: req.body?.ownerPhone || req.body?.ownerForwardNumber,
            actor: req.user
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND' || error.code === 'INVALID_TIME_FORMAT' || error.code === 'INVALID_DATE_FORMAT' || error.code === 'PAST_DATE_NOT_ALLOWED') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: 'Failed to reschedule appointment' });
    }
};

exports.createAppointmentDepositLink = async (req, res) => {
    try {
        const data = await dashboardDataService.createAppointmentDepositCheckoutSession({
            appointmentId: req.params.id,
            amount: req.body?.amount,
            totalAmount: req.body?.totalAmount,
            percentage: req.body?.percentage,
            currency: req.body?.currency,
            tenantEmail: req.body?.tenantEmail,
            dialedNumber: req.body?.dialedNumber,
            ownerPhone: req.body?.ownerPhone || req.body?.ownerForwardNumber,
            actor: req.user,
            origin: req.headers.origin
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND' || error.code === 'INVALID_DEPOSIT_AMOUNT') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(400).json({ success: false, message: error.message || 'Failed to create appointment deposit link' });
    }
};

exports.refreshAppointmentDepositStatus = async (req, res) => {
    try {
        const data = await dashboardDataService.refreshAppointmentDepositStatus({
            appointmentId: req.params.id,
            tenantEmail: req.body?.tenantEmail || req.query?.tenantEmail,
            dialedNumber: req.body?.dialedNumber || req.query?.dialedNumber,
            ownerPhone: req.body?.ownerPhone || req.body?.ownerForwardNumber || req.query?.ownerPhone,
            actor: req.user
        });

        if (!data) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'TENANT_NOT_FOUND') {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(400).json({ success: false, message: error.message || 'Failed to refresh appointment deposit status' });
    }
};

exports.getFeatureToggles = async (req, res) => {
    try {
        const data = await dashboardDataService.getFeatureToggles({ actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch feature toggles' });
    }
};

exports.updateFeatureToggles = async (req, res) => {
    try {
        const data = await dashboardDataService.updateFeatureToggles({
            actor: req.user,
            nextConfig: req.body || {}
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to update feature toggles' });
    }
};

exports.getAiReceptionistConfig = async (req, res) => {
    try {
        const data = await dashboardDataService.getAiReceptionistConfig({ actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch AI receptionist config' });
    }
};

exports.previewAiReceptionistVoice = async (req, res) => {
    try {
        const voice = String(req.query.voice || '').trim();
        if (!voice) {
            return res.status(400).json({ success: false, message: 'voice query param is required' });
        }

        const { RETELL_API_KEY } = require('../config/env');
        if (!RETELL_API_KEY) {
            return res.status(501).json({ success: false, message: 'Voice preview requires RETELL integration enabled on the backend. Configure RETELL_API_KEY in .env.' });
        }

        // If RETELL is configured we would proxy a TTS preview here.
        // Implementation depends on Retell's TTS API. For now, return not implemented.
        return res.status(501).json({ success: false, message: 'Voice preview is not implemented on the server yet.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to generate voice preview' });
    }
};

exports.updateAiReceptionistConfig = async (req, res) => {
    try {
        const data = await dashboardDataService.updateAiReceptionistConfig({
            actor: req.user,
            payload: req.body || {}
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to update AI receptionist config' });
    }
};

exports.deleteKnowledgeBaseEntry = async (req, res) => {
    try {
        const deleted = await dashboardDataService.deleteKnowledgeBaseEntry(req.params.id, { actor: req.user });
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Knowledge base entry not found' });
        }

        return res.status(200).json({ success: true, message: 'Knowledge base entry deleted' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to delete knowledge base entry' });
    }
};

exports.getBilling = async (req, res) => {
    try {
        const data = await dashboardDataService.getBillingInfo({ email: req.query.email, actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch billing info' });
    }
};

exports.purchasePlan = async (req, res) => {
    try {
        const { email, planName } = req.body;
        if (!planName) {
            return res.status(400).json({ success: false, message: 'planName is required' });
        }

        const data = await dashboardDataService.purchasePlan({
            email,
            planName,
            actor: req.user,
            provisioningOptions: {
                phoneNumber: req.body?.phoneNumber,
                country: req.body?.country,
                areaCode: req.body?.areaCode,
                customPrompt: req.body?.customPrompt,
                businessDetails: req.body?.businessDetails,
                purchasePurpose: req.body?.purchasePurpose,
                websiteUrl: req.body?.websiteUrl,
                voiceId: req.body?.voiceId
            }
        });
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to purchase plan' });
    }
};

exports.handleStripeWebhook = async (req, res) => {
    try {
        const signatureHeader = req.headers['stripe-signature'];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
        const data = await dashboardDataService.processStripeWebhook({
            rawBody: req.rawBody || '',
            signature
        });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error.code === 'STRIPE_WEBHOOK_SIGNATURE_REQUIRED' || error.code === 'STRIPE_WEBHOOK_SIGNATURE_INVALID') {
            return res.status(400).json({ success: false, message: error.message });
        }
        if (error.code === 'STRIPE_NOT_CONFIGURED' || error.code === 'STRIPE_WEBHOOK_NOT_CONFIGURED') {
            return res.status(503).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to process Stripe webhook' });
    }
};

exports.createStripeCheckoutSession = async (req, res) => {
    try {
        const { email, planName } = req.body;
        if (!planName) {
            return res.status(400).json({ success: false, message: 'planName is required' });
        }

        const data = await dashboardDataService.createStripeCheckoutSession({
            email,
            planName,
            actor: req.user,
            origin: req.headers.origin,
            provisioningOptions: {
                phoneNumber: req.body?.phoneNumber,
                country: req.body?.country,
                areaCode: req.body?.areaCode,
                customPrompt: req.body?.customPrompt,
                businessDetails: req.body?.businessDetails,
                purchasePurpose: req.body?.purchasePurpose,
                websiteUrl: req.body?.websiteUrl,
                voiceId: req.body?.voiceId
            }
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to create Stripe checkout session' });
    }
};

exports.confirmStripeCheckoutSession = async (req, res) => {
    try {
        const { email, sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'sessionId is required' });
        }

        const data = await dashboardDataService.confirmStripeCheckoutSession({
            email,
            sessionId,
            actor: req.user
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to confirm Stripe checkout session' });
    }
};

exports.getPaymentMethodUpdateUrl = async (req, res) => {
    try {
        const data = await dashboardDataService.getPaymentMethodUpdateUrl({
            email: req.query.email,
            actor: req.user,
            origin: req.headers.origin
        });
        return ok(res, data);
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to get payment method update url' });
    }
};

exports.getReferralOverview = async (req, res) => {
    try {
        const data = await dashboardDataService.getReferralOverview({ email: req.query.email, actor: req.user });
        return ok(res, data);
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to fetch referral overview' });
    }
};

exports.getAdminOverview = async (req, res) => {
    try {
        const data = await dashboardDataService.getAdminOverview();
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch admin overview' });
    }
};

exports.getAdminUsers = async (req, res) => {
    try {
        const data = await dashboardDataService.getAdminUsers();
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch admin users' });
    }
};

exports.getAdminSubscriptions = async (req, res) => {
    try {
        const data = await dashboardDataService.getAdminSubscriptions();
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch admin subscriptions' });
    }
};

exports.getAdminAnalytics = async (req, res) => {
    try {
        const data = await dashboardDataService.getAdminAnalytics();
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch admin analytics' });
    }
};
