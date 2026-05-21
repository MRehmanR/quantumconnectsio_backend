const defaultFeatureToggles = {
    callHandling: {
        appointmentBooking: { enabled: true },
        depositCollection: { enabled: true, amount: 25, amountType: 'fixed', paymentWindowHours: 24 },
        waitlistManagement: { enabled: true },
        urgentCallRouting: {
            enabled: true,
            triggerKeywords: ['urgent', 'emergency', 'asap'],
            transferNumber: '+1 (555) 100-2000'
        },
        outOfHoursHandling: {
            enabled: true,
            openingHours: 'Mon-Fri 9AM-6PM, Sat 10AM-4PM'
        },
        callRecording: { enabled: true },
        callTranscriptsEmailed: { enabled: true },
        callerIdCapture: { enabled: true }
    },
    customerCommunication: {
        googleReviewAutomation: { enabled: true },
        smsFollowUpAfterBooking: { enabled: true },
        appointmentReminderCalls: { enabled: true, hoursBefore: 24 },
        cancellationHandling: { enabled: true },
        reschedulingHandling: { enabled: true },
        callbackRequestOption: { enabled: true }
    },
    businessConfiguration: {
        customVoice: { enabled: false, mode: 'standard' },
        multiLanguageSupport: { enabled: false, languages: ['English'] },
        personalisedGreetingScript: {
            enabled: true,
            openingLine: 'Thanks for calling. How can I help you today?'
        },
        staffNameMentions: { enabled: false, staffNames: [] }
    },
    payments: {
        depositCollection: { enabled: true, configuredPerService: true },
        paymentConfirmationSms: { enabled: true },
        refundHandlingScript: { enabled: true }
    },
    reportingAndAlerts: {
        weeklyCallSummaryEmail: { enabled: true },
        usageAlert70Percent: { enabled: true, locked: true },
        realTimeMissedCallAlerts: { enabled: true },
        monthlyPerformanceReport: { enabled: true }
    }
};

module.exports = {
    defaultFeatureToggles
};
