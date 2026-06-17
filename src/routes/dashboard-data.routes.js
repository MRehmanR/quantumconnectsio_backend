const express = require('express');
const dashboardDataController = require('../controllers/dashboard-data.controller');
const adminMiddleware = require('../middleware/admin.middleware');
const numbersController = require('../controllers/numbers.controller');
const { authenticate, requireActiveSubscription, authenticateOrAutomationKey } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/dashboard', authenticate, dashboardDataController.getDashboardOverview);
router.get('/profile', authenticate, dashboardDataController.getProfile);
router.put('/profile', authenticate, dashboardDataController.updateProfile);
router.get('/calls', authenticate, dashboardDataController.getCalls);
router.get('/appointments', authenticate, dashboardDataController.getAppointments);
router.post('/summary/daily', authenticate, requireActiveSubscription, dashboardDataController.generateDailySummary);
router.get('/summary/daily/history', authenticate, dashboardDataController.getDailySummaryHistory);
router.get('/appointments/availability', authenticateOrAutomationKey, dashboardDataController.getAppointmentAvailability);
router.post('/appointments', authenticateOrAutomationKey, dashboardDataController.createAppointment);
router.patch('/appointments/:id/status', authenticateOrAutomationKey, dashboardDataController.updateAppointmentStatus);
router.patch('/appointments/:id/cancel', authenticateOrAutomationKey, dashboardDataController.cancelAppointment);
router.patch('/appointments/:id/reschedule', authenticateOrAutomationKey, dashboardDataController.rescheduleAppointment);
router.post('/appointments/:id/deposit-link', authenticateOrAutomationKey, dashboardDataController.createAppointmentDepositLink);
router.post('/appointments/:id/deposit-status/refresh', authenticateOrAutomationKey, dashboardDataController.refreshAppointmentDepositStatus);
router.get('/knowledge-base', authenticate, dashboardDataController.getKnowledgeBase);
router.post('/knowledge-base', authenticate, requireActiveSubscription, dashboardDataController.createKnowledgeBaseEntry);
router.delete('/knowledge-base/:id', authenticate, requireActiveSubscription, dashboardDataController.deleteKnowledgeBaseEntry);
router.get('/feature-toggles', authenticate, dashboardDataController.getFeatureToggles);
router.put('/feature-toggles', authenticate, requireActiveSubscription, dashboardDataController.updateFeatureToggles);
router.get('/ai-receptionist/config', authenticate, dashboardDataController.getAiReceptionistConfig);
router.get('/ai-receptionist/preview-voice', authenticate, requireActiveSubscription, dashboardDataController.previewAiReceptionistVoice);
router.put('/ai-receptionist/config', authenticate, requireActiveSubscription, dashboardDataController.updateAiReceptionistConfig);
router.get('/billing', authenticate, dashboardDataController.getBilling);
router.post('/billing/purchase', authenticate, dashboardDataController.purchasePlan);
router.post('/billing/stripe/webhook', dashboardDataController.handleStripeWebhook);
router.post('/billing/checkout/session', authenticate, dashboardDataController.createStripeCheckoutSession);
router.post('/billing/checkout/confirm', authenticate, dashboardDataController.confirmStripeCheckoutSession);
router.get('/billing/payment-method/update-url', authenticate, dashboardDataController.getPaymentMethodUpdateUrl);
router.get('/referrals', authenticate, dashboardDataController.getReferralOverview);

router.get('/admin/overview', authenticate, adminMiddleware, dashboardDataController.getAdminOverview);
router.get('/admin/users', authenticate, adminMiddleware, dashboardDataController.getAdminUsers);
router.get('/admin/subscriptions', authenticate, adminMiddleware, dashboardDataController.getAdminSubscriptions);
router.get('/admin/analytics', authenticate, adminMiddleware, dashboardDataController.getAdminAnalytics);
router.get('/admin/demo-numbers', authenticate, adminMiddleware, numbersController.listDemoNumbers);

module.exports = router;
