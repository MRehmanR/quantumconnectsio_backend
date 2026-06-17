const User = require('./user.model');
const CallLog = require('./call-log.model');
const CallContact = require('./call-contact.model');
const Appointment = require('./appointment.model');
const AppointmentContact = require('./appointment-contact.model');
const KnowledgeBaseEntry = require('./knowledge-base-entry.model');
const KnowledgeBaseAttachment = require('./knowledge-base-attachment.model');
const FeatureToggleConfig = require('./feature-toggle-config.model');
const ReferralBonusAward = require('./referral-bonus-award.model');
const SubscriptionPlan = require('./subscription-plan.model');
const Invoice = require('./invoice.model');
const AutomationEvent = require('./automation-event.model');
const WorkflowExecution = require('./workflow-execution.model');
const UsageCycle = require('./usage-cycle.model');
const WaitlistEntry = require('./waitlist-entry.model');
const EscalationLog = require('./escalation-log.model');
const OutboundCall = require('./outbound-call.model');
const KbQueryLog = require('./kb-query-log.model');
const AuditLog = require('./audit-log.model');
const DailySummary = require('./daily-summary.model');
const DemoNumber = require('./demo-number.model');

module.exports = {
    User,
    CallLog,
    CallContact,
    Appointment,
    AppointmentContact,
    KnowledgeBaseEntry,
    KnowledgeBaseAttachment,
    FeatureToggleConfig,
    ReferralBonusAward,
    SubscriptionPlan,
    Invoice,
    AutomationEvent,
    WorkflowExecution,
    UsageCycle,
    WaitlistEntry,
    EscalationLog,
    OutboundCall,
    KbQueryLog,
    AuditLog,
    DailySummary,
    DemoNumber
};