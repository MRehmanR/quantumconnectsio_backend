# QuantumConnects Project Handover

## 1. Project Summary

QuantumConnects is an AI receptionist SaaS for businesses. It includes:

- Public marketing website
- User signup/login and onboarding
- Customer dashboard
- Admin dashboard
- 7-day free trial with demo phone number and demo voice agent
- Paid plans through Stripe
- Twilio phone number provisioning
- Retell AI voice agent provisioning
- Knowledge base, appointment booking, call logs, billing, referrals, and automation workflows
- n8n workflow pack for inbound calls, appointment tools, knowledge lookup, escalation, reminders, and summaries

## 2. Main Folders

### Backend

Path:

```text
d:\My Projects\quantumconnectsio_backend
```

Purpose:

- Express API server
- Authentication
- Database models
- Stripe billing
- Twilio number management
- Retell agent provisioning
- Automation endpoints
- Admin APIs
- Demo number pool handling

### Frontend

Path:

```text
d:\My Projects\quantumconnects-frontend
```

Purpose:

- React website and dashboard
- Landing pages
- Signup/login/reset password
- Customer dashboard
- Admin dashboard
- Billing UI
- Onboarding UI

### Automation Workflows

Path:

```text
d:\My Projects\quantum_connects_final
```

Purpose:

- n8n workflow JSON files
- Retell AI configuration
- Workflow testing guides
- Professional backend-first workflow pack

## 3. AI Platform / Template Used

The frontend README identifies this as a Lovable project.

Frontend stack from the README and package files:

- Lovable AI project/template
- Vite
- React
- TypeScript
- shadcn-ui
- Tailwind CSS
- Radix UI components

Key evidence:

- `d:\My Projects\quantumconnects-frontend\README.md` says "Welcome to your Lovable project".
- `package.json` project name is `vite_react_shadcn_ts`.
- `lovable-tagger` exists in frontend dev dependencies.

## 4. Logins And Authentication

### Customer Login

Frontend page:

```text
d:\My Projects\quantumconnects-frontend\src\pages\auth\Login.tsx
```

Backend endpoint:

```text
POST /api/auth/login
```

Authentication method:

- Email and password
- Backend returns JWT token
- Frontend stores token in local storage as `qc_auth_token`
- Frontend stores role in local storage as `qc_user_role`

### Customer Signup

Frontend page:

```text
d:\My Projects\quantumconnects-frontend\src\pages\auth\Signup.tsx
```

Backend endpoints:

```text
POST /api/auth/register
POST /api/auth/signup
```

Signup behavior:

- Creates user account
- Normalizes email
- Auto-generates username when needed
- Assigns demo number if available
- Creates demo Retell voice agent when configured
- Starts trial account

### Forgot / Reset Password

Frontend pages:

```text
d:\My Projects\quantumconnects-frontend\src\pages\auth\ForgotPassword.tsx
d:\My Projects\quantumconnects-frontend\src\pages\auth\ResetPassword.tsx
```

Backend endpoints:

```text
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

Email sending uses SMTP variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
```

### Admin Login

Admin uses the same login endpoint:

```text
POST /api/auth/login
```

Default admin is created from backend environment variables:

```text
ADMIN_USERNAME
ADMIN_EMAIL
ADMIN_PASSWORD
```

Admin frontend pages:

```text
d:\My Projects\quantumconnects-frontend\src\pages\admin\Overview.tsx
d:\My Projects\quantumconnects-frontend\src\pages\admin\Users.tsx
d:\My Projects\quantumconnects-frontend\src\pages\admin\Subscriptions.tsx
d:\My Projects\quantumconnects-frontend\src\pages\admin\Analytics.tsx
```

## 5. Frontend Website Structure

Entry files:

```text
d:\My Projects\quantumconnects-frontend\src\main.tsx
d:\My Projects\quantumconnects-frontend\src\App.tsx
d:\My Projects\quantumconnects-frontend\src\index.css
```

API client:

```text
d:\My Projects\quantumconnects-frontend\src\lib\api.ts
```

Frontend API base URL:

```text
VITE_API_BASE_URL
```

If empty, requests are made relative to the same domain.

### Public Pages

Routes are defined in `src\App.tsx`.

```text
/                         Home
/features                 Features
/pricing                  Pricing
/about                    About
/contact                  Contact
/affiliates               Affiliates
/white-label              White Label
/industries               Industries listing
/industries/:slug         Individual industry page
/testimonials             Testimonials
/faq                      FAQ
/book-demo                Book demo
```

Important files:

```text
src\pages\landing\Home.tsx
src\pages\landing\Features.tsx
src\pages\landing\Pricing.tsx
src\pages\landing\IndustriesListing.tsx
src\pages\landing\Industries.tsx
src\pages\landing\IndustryPage.tsx
src\lib\industries.ts
src\components\landing\*.tsx
```

### Auth Pages

```text
/login
/signup
/forgot-password
/reset-password
```

Files:

```text
src\pages\auth\Login.tsx
src\pages\auth\Signup.tsx
src\pages\auth\ForgotPassword.tsx
src\pages\auth\ResetPassword.tsx
src\pages\auth\OnboardingSetup.tsx
src\pages\auth\OnboardingBuyNumber.tsx
```

### Customer Dashboard

Protected by user role.

```text
/dashboard
/dashboard/calls
/dashboard/appointments
/dashboard/knowledge-base
/dashboard/billing
/dashboard/settings
/onboarding/setup
/onboarding/phone-number
```

Files:

```text
src\pages\dashboard\Overview.tsx
src\pages\dashboard\CallLogs.tsx
src\pages\dashboard\Appointments.tsx
src\pages\dashboard\KnowledgeBase.tsx
src\pages\dashboard\Billing.tsx
src\pages\dashboard\Settings.tsx
src\components\dashboard\DashboardShell.tsx
src\components\dashboard\CustomerSidebar.tsx
```

### Admin Dashboard

Protected by admin role.

```text
/admin
/admin/users
/admin/subscriptions
/admin/analytics
```

Files:

```text
src\pages\admin\Overview.tsx
src\pages\admin\Users.tsx
src\pages\admin\Subscriptions.tsx
src\pages\admin\Analytics.tsx
src\components\dashboard\AdminShell.tsx
src\components\dashboard\AdminSidebar.tsx
```

## 6. Backend Structure

Backend entry files:

```text
src\server.js
src\app.js
```

Config:

```text
src\config\env.js
src\config\db.js
```

Routes:

```text
src\routes\auth.routes.js
src\routes\dashboard-data.routes.js
src\routes\automation.routes.js
src\routes\numbers.routes.js
src\routes\user.routes.js
```

Controllers:

```text
src\controllers\auth.controller.js
src\controllers\dashboard-data.controller.js
src\controllers\automation.controller.js
src\controllers\numbers.controller.js
src\controllers\user.controller.js
```

Services:

```text
src\services\auth.service.js
src\services\dashboard-data.service.js
src\services\provisioning.service.js
src\services\demo-number.service.js
src\services\automation.service.js
src\services\usage-enforcement.service.js
src\services\user.service.js
```

Middleware:

```text
src\middleware\auth.middleware.js
src\middleware\admin.middleware.js
src\middleware\audit.middleware.js
```

Jobs:

```text
src\jobs\reclaim-demo-numbers.js
```

Database:

```text
src\database\init.js
src\database\seed.js
src\database\migrations
src\database\app.sqlite
```

## 7. Database Models

Models are exported from:

```text
src\models\index.js
```

Main models:

- `User`
- `CallLog`
- `CallContact`
- `Appointment`
- `AppointmentContact`
- `KnowledgeBaseEntry`
- `KnowledgeBaseAttachment`
- `FeatureToggleConfig`
- `ReferralBonusAward`
- `SubscriptionPlan`
- `Invoice`
- `AutomationEvent`
- `WorkflowExecution`
- `UsageCycle`
- `WaitlistEntry`
- `EscalationLog`
- `OutboundCall`
- `KbQueryLog`
- `AuditLog`
- `DailySummary`
- `DemoNumber`

## 8. Backend API Routes

### Health

```text
GET /api/health
```

### Auth

```text
POST /api/auth/login
POST /api/auth/register
POST /api/auth/signup
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/available-numbers
POST /api/auth/import-website-knowledge
POST /api/auth/assign-demo
GET  /api/auth/active-demo
POST /api/auth/provision-number
POST /api/auth/provision-retell-agent
POST /api/auth/generate-retell-prompt
```

### User Dashboard

```text
GET   /api/dashboard
GET   /api/profile
PUT   /api/profile
GET   /api/calls
GET   /api/appointments
POST  /api/appointments
GET   /api/appointments/availability
PATCH /api/appointments/:id/status
PATCH /api/appointments/:id/cancel
PATCH /api/appointments/:id/reschedule
POST  /api/appointments/:id/deposit-link
POST  /api/appointments/:id/deposit-status/refresh
GET   /api/knowledge-base
POST  /api/knowledge-base
DELETE /api/knowledge-base/:id
GET   /api/feature-toggles
PUT   /api/feature-toggles
GET   /api/ai-receptionist/config
GET   /api/ai-receptionist/preview-voice
PUT   /api/ai-receptionist/config
GET   /api/billing
POST  /api/billing/purchase
POST  /api/billing/stripe/webhook
POST  /api/billing/checkout/session
POST  /api/billing/checkout/confirm
GET   /api/billing/payment-method/update-url
GET   /api/referrals
POST  /api/summary/daily
GET   /api/summary/daily/history
```

### Admin

```text
GET /api/admin/overview
GET /api/admin/users
GET /api/admin/subscriptions
GET /api/admin/analytics
GET /api/admin/demo-numbers
```

### Numbers

```text
POST /api/numbers/assign-demo
POST /api/numbers/promote
GET  /api/numbers/active-demo
```

### Automation

```text
POST   /api/automation/retell/webhook
POST   /api/automation/events
POST   /api/automation/workflow-executions
POST   /api/automation/call-preflight
POST   /api/automation/call-finalize
POST   /api/automation/inbound/identify-client
POST   /api/automation/usage/check
POST   /api/automation/appointments/check-availability
POST   /api/automation/appointments/book
POST   /api/automation/appointments/reschedule
POST   /api/automation/appointments/cancel
POST   /api/automation/notifications/dispatch
POST   /api/automation/kb/query
POST   /api/automation/waitlist/trigger-batch
POST   /api/automation/waitlist/respond
POST   /api/automation/summaries/daily
POST   /api/automation/compliance/cleanup
POST   /api/automation/provisioning/retry/:userId
GET    /api/automation/overview
DELETE /api/automation/compliance/gdpr/user/:userId
```

## 9. External APIs And Where They Are Used

### Stripe

Used for:

- Plan checkout
- Subscription-style checkout sessions
- Deposit payment links
- Stripe webhooks
- Billing portal / payment method update
- Invoice records

Files:

```text
src\services\dashboard-data.service.js
src\routes\dashboard-data.routes.js
src\controllers\dashboard-data.controller.js
```

Environment variables:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CURRENCY
BILLING_PORTAL_URL
FRONTEND_APP_URL
```

### Twilio

Used for:

- Buying new phone numbers
- Listing available phone numbers
- Checking owned Twilio numbers
- Reusing idle owned numbers for demos
- Checking recent inbound call activity
- Discovering SIP trunk details

Files:

```text
src\services\provisioning.service.js
src\services\demo-number.service.js
```

Environment variables:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_NUMBER_COUNTRY
TWILIO_AREA_CODE
TWILIO_DEMO_SYNC_ENABLED
TWILIO_DEMO_SYNC_COUNTRIES
TWILIO_DEMO_MIN_IDLE_DAYS
TWILIO_DEMO_IMPORT_LIMIT
DEMO_NUMBERS
DEMO_NUMBER_TTL_HOURS
DEMO_NUMBER_RECLAIM_INTERVAL_MIN
```

### Retell AI

Used for:

- Creating voice agents
- Creating/updating Retell LLM / response engine
- Binding phone numbers to agents
- Importing SIP trunk numbers when needed
- Receiving call webhooks
- Verifying Retell webhook signatures

Files:

```text
src\services\provisioning.service.js
src\services\dashboard-data.service.js
src\services\automation.service.js
src\controllers\automation.controller.js
```

Environment variables:

```text
RETELL_API_KEY
RETELL_API_BASE_URL
RETELL_CREATE_AGENT_PATH
RETELL_UPDATE_AGENT_PATH
RETELL_AGENT_TEMPLATE_ID
RETELL_VOICE_ID
RETELL_RESPONSE_ENGINE_TYPE
RETELL_LLM_ID
RETELL_CONVERSATION_FLOW_ID
RETELL_WEBHOOK_URL
RETELL_WEBHOOK_SECRET
RETELL_SIP_TERMINATION_URI
RETELL_SIP_TRUNK_AUTH_USERNAME
RETELL_SIP_TRUNK_AUTH_PASSWORD
```

### OpenAI

Used for:

- Generating Retell receptionist prompts
- Business-specific AI receptionist script generation

File:

```text
src\services\provisioning.service.js
```

Environment variables:

```text
OPENAI_API_KEY
OPENAI_MODEL
```

### SMTP / Email

Used for:

- Password reset emails
- Email utility sending

Files:

```text
src\utils\email.js
src\services\auth.service.js
```

Environment variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
RESET_PASSWORD_TOKEN_TTL_MIN
```

### n8n

Used for:

- Voice call automation workflows
- Appointment tools
- Knowledge-base lookup
- Escalations
- Reminders
- Daily operations

Backend automation key:

```text
AUTOMATION_SHARED_KEY
```

n8n variables:

```text
QC_BACKEND_URL
QC_AUTOMATION_KEY
```

## 10. Demo Number And Paid Number Flow

### Free Trial

When a user signs up:

1. Backend creates a user.
2. Backend tries to assign a demo number.
3. Backend creates or assigns demo Retell voice agent if configured.
4. User receives a 7-day trial.

Demo number priority:

1. Use configured free demo numbers from `DEMO_NUMBERS`.
2. If none are free, check existing owned Twilio numbers.
3. Only reuse owned Twilio numbers if not assigned to any user and idle for configured days.
4. If none are reusable, buy a new Twilio number.

Important files:

```text
src\services\auth.service.js
src\services\demo-number.service.js
src\services\provisioning.service.js
src\jobs\reclaim-demo-numbers.js
```

### Paid Plan

When a user buys a plan:

1. Stripe checkout session is created.
2. Stripe confirms payment through confirm endpoint or webhook.
3. Backend updates plan and invoice records.
4. If user has demo number, number can be promoted or replaced depending on flow.
5. Paid number and Retell agent remain assigned to the user.
6. If plan expires and user renews later, same number and same agent can be reused.

Important file:

```text
src\services\dashboard-data.service.js
```

## 11. Subscription Plans

Default plans are in:

```text
src\services\dashboard-data.service.js
```

Plans:

- Trial: price 0, 50 calls/minutes, concurrent limit 2
- Rise: price 99, 150 calls/minutes, concurrent limit 5
- Elevate: price 249, 500 calls/minutes, concurrent limit 20
- Apex: price 499, 1100 calls/minutes, concurrent limit 50

Usage enforcement:

```text
src\services\usage-enforcement.service.js
src\middleware\auth.middleware.js
```

## 12. n8n Workflows

Workflow directory:

```text
d:\My Projects\quantum_connects_final\workflows
```

### Professional Workflows For Production

Use these first:

```text
professional-1-inbound-call-handler.json
professional-2-call-completion.json
professional-3-appointment-tools.json
professional-4-knowledge-and-escalation.json
professional-5-scheduled-ops.json
```

Import order:

1. Professional 1 - Inbound Call Handler
2. Professional 2 - Call Completion
3. Professional 3 - Appointment Tools
4. Professional 4 - Knowledge And Escalation
5. Professional 5 - Scheduled Operations

These use a backend-first approach:

- n8n receives provider events.
- n8n normalizes payload.
- n8n calls backend API.
- Backend owns tenant lookup, idempotency, usage, appointments, and dashboard consistency.

Recommended provider idempotency values:

- Twilio: `CallSid`
- Retell: `call_id`

### Legacy / Reference Workflows

These exist as older direct database workflow files:

```text
0-client-onboarding-FULLY-AUTO.json
0-client-onboarding.json
1-inbound-call-handler.json
2-call-completion.json
3-kb-search.json
4-check-availability.json
5-book-appointment.json
6-cancel-appointment.json
7-send-sms.json
8-outbound-processor.json
9-reminder-scheduler.json
10-noshow-scheduler.json
11-daily-summary.json
12-escalation-handler.json
```

For production, use the `professional-*` workflows. Keep legacy files only as reference unless intentionally maintaining them.

### Workflow Purpose List

- Client onboarding: create/setup new business automation.
- Inbound call handler: receives call start/preflight and identifies client.
- Call completion: finalizes call logs and usage after call ends.
- Knowledge base search: returns business-specific answers to voice agent.
- Check availability: checks appointment slots.
- Book appointment: books appointment and updates backend dashboard.
- Cancel appointment: cancels existing appointment.
- Send SMS: sends confirmations/follow-ups.
- Outbound processor: handles outbound call tasks.
- Reminder scheduler: sends appointment reminders.
- No-show scheduler: flags no-shows.
- Daily summary: produces summary records.
- Escalation handler: routes urgent calls/escalations.

## 13. Retell AI Configuration

Retell config directory:

```text
d:\My Projects\quantum_connects_final\retell-ai-config
```

Main file:

```text
agent-configuration.json
```

Retell webhook should point to backend or n8n depending on active architecture.

Backend Retell webhook:

```text
POST /api/automation/retell/webhook
```

Professional n8n webhook examples from workflow env:

```text
/webhook/qc/inbound-call
/webhook/qc/call-complete
/webhook/qc/check-availability
/webhook/qc/book-appointment
/webhook/qc/kb-query
/webhook/qc/escalate
```

## 14. Environment Variables

Backend example file:

```text
d:\My Projects\quantumconnectsio_backend\.env.example
```

Frontend required variable:

```text
VITE_API_BASE_URL
```

Important backend groups:

Database:

```text
DB_DIALECT
DATABASE_URL
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
DB_SSL
DB_SSLMODE
DB_STORAGE
DB_LOGGING
DB_SYNC_ALTER
```

Authentication/admin:

```text
JWT_SECRET
JWT_EXPIRATION
ADMIN_USERNAME
ADMIN_EMAIL
ADMIN_PASSWORD
```

Automation:

```text
AUTOMATION_SHARED_KEY
N8N_MANUAL_APPOINTMENT_WEBHOOK_URL
```

Twilio:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_NUMBER_COUNTRY
TWILIO_AREA_CODE
DEMO_NUMBERS
TWILIO_DEMO_SYNC_ENABLED
TWILIO_DEMO_SYNC_COUNTRIES
TWILIO_DEMO_MIN_IDLE_DAYS
TWILIO_DEMO_IMPORT_LIMIT
DEMO_NUMBER_TTL_HOURS
DEMO_NUMBER_RECLAIM_INTERVAL_MIN
```

Retell:

```text
RETELL_API_KEY
RETELL_API_BASE_URL
RETELL_CREATE_AGENT_PATH
RETELL_UPDATE_AGENT_PATH
RETELL_AGENT_TEMPLATE_ID
RETELL_VOICE_ID
RETELL_RESPONSE_ENGINE_TYPE
RETELL_LLM_ID
RETELL_CONVERSATION_FLOW_ID
RETELL_WEBHOOK_URL
RETELL_WEBHOOK_SECRET
RETELL_SIP_TERMINATION_URI
RETELL_SIP_TRUNK_AUTH_USERNAME
RETELL_SIP_TRUNK_AUTH_PASSWORD
```

OpenAI:

```text
OPENAI_API_KEY
OPENAI_MODEL
```

Stripe:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CURRENCY
BILLING_PORTAL_URL
FRONTEND_APP_URL
```

Email:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
RESET_PASSWORD_TOKEN_TTL_MIN
```

## 15. Local Commands

### Backend

```bash
cd "d:\My Projects\quantumconnectsio_backend"
npm install
npm run dev
npm start
npm run migrate
npm run seed
```

### Frontend

```bash
cd "d:\My Projects\quantumconnects-frontend"
npm install
npm run dev
npm run build
npm run test
```

## 16. Deployment Notes

Backend:

- Deploy Node/Express app.
- Set all required `.env` variables.
- Ensure database is reachable.
- Point frontend `VITE_API_BASE_URL` to backend API domain if hosted separately.
- Configure Stripe webhook to:

```text
POST /api/billing/stripe/webhook
```

- Configure Retell webhook to backend or n8n based on final workflow architecture.
- Configure n8n environment:

```text
QC_BACKEND_URL
QC_AUTOMATION_KEY
```

Frontend:

- Build with `npm run build`.
- Deploy static `dist` output.
- Configure custom domain in hosting provider or Lovable if using Lovable publish.

## 17. Important Safety Notes

- Do not send `.env` secret values to clients in plain text.
- Rotate any exposed API keys before production.
- Never reuse a paid user's Twilio number for another user.
- Demo numbers can be reclaimed only when trial assignment expires and the number is not promoted.
- Professional workflows are preferred for production because backend idempotency prevents duplicate call triggers and duplicate bookings.

