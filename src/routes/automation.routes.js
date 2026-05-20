const express = require('express');
const automationController = require('../controllers/automation.controller');
const { authenticate } = require('../middleware/auth.middleware');
const adminMiddleware = require('../middleware/admin.middleware');

const router = express.Router();

router.post('/retell/webhook', automationController.ingestRetellWebhook);
router.post('/events', automationController.ingestAutomationEvent);
router.post('/workflow-executions', automationController.upsertWorkflowExecution);
router.post('/call-preflight', automationController.preflightInboundCall);
router.post('/call-finalize', automationController.finalizeInboundCall);
router.post('/inbound/identify-client', automationController.identifyInboundClient);
router.post('/usage/check', automationController.checkUsageLegacy);
router.post('/appointments/check-availability', automationController.checkAppointmentAvailabilityLegacy);
router.post('/appointments/book', automationController.bookAppointmentLegacy);
router.post('/appointments/reschedule', automationController.rescheduleAppointmentLegacy);
router.post('/appointments/cancel', automationController.cancelAppointmentLegacy);
router.post('/notifications/dispatch', automationController.dispatchNotificationLegacy);
router.post('/kb/query', automationController.queryKnowledgeBaseLegacy);
router.post('/waitlist/trigger-batch', automationController.triggerWaitlistBatch);
router.post('/waitlist/respond', automationController.handleWaitlistResponse);
router.post('/summaries/daily', automationController.generateDailySummary);
router.post('/compliance/cleanup', automationController.runRetentionCleanup);
router.post('/provisioning/retry/:userId', automationController.retryProvisioning);
router.get('/overview', authenticate, adminMiddleware, automationController.getAutomationOverview);
router.delete('/compliance/gdpr/user/:userId', authenticate, adminMiddleware, automationController.runGdprDelete);

module.exports = router;
