const dashboardDataService = require('../services/dashboard-data.service');

const ok = (res, data) => res.status(200).json({ success: true, data });

exports.getDashboardOverview = async (req, res) => {
    try {
        const data = await dashboardDataService.getDashboardOverview({
            actor: req.user
        });
        return ok(res, data);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch dashboard overview' });
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
        if (error.code === 'INVALID_TIME_FORMAT') {
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
        if (error.code === 'TENANT_NOT_FOUND') {
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
        if (error.code === 'TENANT_NOT_FOUND') {
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

        const data = await dashboardDataService.purchasePlan({ email, planName, actor: req.user });
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Failed to purchase plan' });
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
            origin: req.headers.origin
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
