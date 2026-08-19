# RetellAI Real-Call Testing Guide

This guide validates one business canary end to end before enabling the integration for every SaaS tenant. Use Hampton Travel only after confirming that it is the intended test account. Never paste real phone numbers, API keys, customer data, or database credentials into commits, screenshots, tickets, or shared chat.

## What this test covers

The production call path is:

```text
Caller
  -> Retell phone number
  -> POST /api/automation/retell/inbound
  -> tenant selected by the exact called number
  -> tenant Retell agent
  -> POST /api/automation/retell/functions
  -> knowledge, availability, booking, reschedule, or cancellation
  -> POST /api/automation/retell/events
  -> call, transcript, analysis, usage, and appointments reflected in the website
```

n8n is used for asynchronous jobs such as usage alerts, notifications, summaries, reviews, and waitlist handling. Workflow 11 is a regression/Postman workflow and must not be configured as the live Retell webhook.

Retell's current contract sends inbound calls without a call ID, waits up to 10 seconds for the inbound webhook, and can retry it up to three times. The backend handles those retries idempotently. Retell signs inbound, function, and event requests with `X-Retell-Signature`; the backend verifies the raw request body before reading or writing tenant data.

Official references:

- [Retell inbound webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Retell secure webhook verification](https://docs.retellai.com/features/secure-webhook)
- [Retell custom functions](https://docs.retellai.com/build/conversation-flow/custom-function)
- [Retell call event webhooks](https://docs.retellai.com/features/webhook-overview)
- [n8n execution inspection and retries](https://docs.n8n.io/workflows/executions/all-executions/)

## Safety rules

1. Test only one explicitly selected tenant first.
2. Use a dedicated test caller and synthetic customer details.
3. Choose a future date allowed by that tenant's weekly schedule, appointment duration, buffer, and minimum-notice rules.
4. Do not use real knowledge from another tenant for isolation testing. Add synthetic markers to dedicated test tenants instead.
5. Keep SMS, email, review, and waitlist workflows inactive until sandbox/test credentials and destinations are confirmed.
6. Record the existing Retell phone, agent, LLM tool, webhook, and inbound-agent configuration before applying the canary.
7. Do not enable every tenant until the Hampton canary and rollback test pass.

## Phase 1: preflight checks

### 1. Confirm the deployed versions

The backend should contain commit `656b75a` or a later commit. The frontend should contain commit `878863a` or a later commit.

Confirm the public backend responds:

```bash
export QC_CANARY_API_BASE_URL="https://api.your-domain.example"
curl -fsS "$QC_CANARY_API_BASE_URL/api/health"
```

Expected response:

```json
{"success":true,"message":"Backend is running"}
```

Do not continue if the URL is private, uses HTTP, redirects to a login page, or has an invalid TLS certificate.

### 2. Confirm backend configuration

Configure these in the deployed backend environment, not in source control:

```text
RETELL_API_KEY=<Retell webhook-designated API key>
PUBLIC_API_BASE_URL=https://api.your-domain.example
AUTOMATION_SHARED_KEY=<strong random value used only by backend and n8n>
FRONTEND_APP_URL=https://app.your-domain.example
```

The Retell API key used for verification must be the key Retell designates for webhook authentication. Restart or redeploy the backend after changing environment values.

Verify that an unsigned request is rejected before any state change:

```bash
curl -i \
  -X POST "$QC_CANARY_API_BASE_URL/api/automation/retell/inbound" \
  -H 'content-type: application/json' \
  -H 'x-retell-signature: invalid' \
  --data '{"event":"call_inbound","call_inbound":{"from_number":"+15555550101","to_number":"+15555550102"}}'
```

Expected result: HTTP `401` with `Invalid Retell signature`.

### 3. Confirm the Hampton tenant

In the admin dashboard or database administration tool, locate the intended Hampton Travel account and record its internal user ID privately as `<HAMPTON_USER_ID>`. Confirm all of the following:

- status is `Active`;
- the AI receptionist is `live` or scheduled for the test time;
- the tenant has one inbound E.164 number;
- the tenant has a Retell agent ID;
- its plan has remaining usage and concurrency;
- its timezone and weekly schedule are correct;
- its knowledge base contains a harmless fact with a known expected answer;
- no incomplete duplicate Hampton account is being selected.

Do not put the user ID, inbound number, or agent ID into this guide.

### 4. Run the automated checks

From the backend repository:

```bash
npm test
npm run automation:validate
```

Both commands must pass before provider configuration is changed.

## Phase 2: Retell canary configuration

### 1. Capture the rollback state

In Retell, privately record or export:

- phone-number inbound webhook URL;
- phone-number inbound agent selection;
- agent webhook URL and enabled events;
- agent response-engine/LLM ID;
- LLM prompt hash or a private prompt backup;
- existing general tools.

Do not store the exported provider state in Git unless all secrets and customer data are removed.

### 2. Run a Hampton-only dry run

Run this on a trusted machine whose environment points to the correct production database and Retell workspace:

```bash
PUBLIC_API_BASE_URL="$QC_CANARY_API_BASE_URL" \
  node src/scripts/reconcile-retell-integrations.js \
  --dry-run \
  --user-id <HAMPTON_USER_ID>
```

Expected:

- one masked Hampton result;
- `mode` is `dry-run`;
- `promptPreserved` is `true`;
- only webhook/event/tool fields appear in `changes`;
- no provider configuration is modified.

Stop if more than one user is shown, the account is not Hampton, the prompt cannot be backed up, or the public URL is incorrect.

### 3. Apply only the Hampton canary

```bash
PUBLIC_API_BASE_URL="$QC_CANARY_API_BASE_URL" \
  node src/scripts/reconcile-retell-integrations.js \
  --apply \
  --user-id <HAMPTON_USER_ID>
```

The command updates only:

- the number's inbound webhook;
- the agent event webhook and `call_started`, `call_ended`, `call_analyzed` events;
- the six managed custom tools.

It preserves the existing prompt and non-managed tools and verifies the prompt hash after applying.

### 4. Make rejection fail closed

For the canary phone number, Retell recommends leaving `Inbound Call Agent` unset when the inbound webhook decides whether to accept a call. The backend returns `override_agent_id` for an accepted active tenant. A successful response without an override then disconnects/rejects the call instead of falling back to a permanently bound agent.

For Hampton only:

1. record the currently bound inbound agent;
2. confirm the inbound webhook URL is correct;
3. unset the phone number's `Inbound Call Agent` in Retell;
4. leave the Hampton agent itself active—the backend will select it through `override_agent_id`.

This also ensures a backend timeout or failed webhook does not route a call to an unintended default agent. Restore the recorded inbound agent immediately if the canary fails.

## Phase 3: exact real-call script

Before calling, create a unique marker such as `Hampton Canary 2026-08-19 01`. Choose a future appointment date and time that is enabled in the Hampton dashboard and beyond its minimum notice.

Place an inbound call to the Hampton test number from the dedicated test caller.

### Conversation A: information and booking

Say the following naturally rather than reading field names:

1. “What are your opening hours?”
2. Ask one question whose answer exists only in Hampton's knowledge base.
3. “Do you have availability on `<FUTURE_DATE>` at `<FUTURE_TIME>`?”
4. “Please book that time. My name is `<UNIQUE_CANARY_NAME>`.”
5. Provide the dedicated test email only if requested.
6. Confirm the date, time, service, and name when the agent reads them back.
7. “What upcoming appointments do I have?”
8. End the call normally.

Expected behavior:

- the greeting and business identity belong to Hampton;
- no other tenant is mentioned;
- the known Hampton answer is accurate;
- requested-time availability is explicit;
- the booking is confirmed once;
- upcoming appointments include the new booking;
- the agent does not ask for another tenant's identifier;
- the call ends without an API or tool error being spoken to the caller.

### Conversation B: lifecycle mutations

Make a second call from the same caller number:

1. ask for upcoming appointments;
2. reschedule the canary appointment to another valid free slot;
3. ask for upcoming appointments again and confirm the new slot;
4. cancel the canary appointment;
5. confirm cancellation.

Expected behavior:

- only appointments belonging to the calling number and Hampton are returned;
- an occupied slot is rejected with alternatives;
- the reschedule appears once;
- the cancellation appears once;
- a different caller cannot mutate the appointment even if they know its ID.

## Phase 4: website and provider verification

### Calls dashboard

Open the Hampton account's **Calls & Recordings** page. Within roughly 10 seconds after the event arrives—and sometimes slightly later for Retell analysis—verify:

- exactly one row exists per Retell call;
- caller number and extracted caller details are correct;
- duration is reasonable;
- transcript is present;
- AI summary is present after `call_analyzed`;
- sentiment, outcome, and disconnection reason are present;
- manual refresh does not create duplicate rows;
- signing out and into another tenant never displays Hampton's cached data.

### Appointments dashboard

Verify the full lifecycle:

- booking appears under Hampton only;
- original date/time is correct;
- reschedule changes the same appointment rather than creating a second active booking;
- final status is `Cancelled` after Conversation B;
- no appointment appears in another tenant dashboard.

### Usage and retry behavior

Verify:

- one inbound call increments usage once, even if Retell retries the inbound webhook;
- active concurrency returns to its previous value after `call_ended`;
- repeated `call_ended` delivery does not decrement concurrency twice;
- failed finalization remains retryable;
- Retell inbound, function, and event requests complete without repeated `401`, `404`, or `500` responses.

### Retell dashboard

For each call, verify Retell shows:

- the expected Hampton agent;
- `call_started`, `call_ended`, and `call_analyzed` delivery;
- successful custom-function requests;
- correct called and caller numbers;
- transcript and analysis;
- no unexpected webhook retries or timeouts.

Do not copy full transcripts containing personal information into shared bug reports.

## Phase 5: tenant-isolation test

Use two dedicated test tenants, A and B. Add synthetic, non-sensitive markers:

```text
Tenant A marker: ORANGE-COMET-A
Tenant B marker: BLUE-HARBOR-B
```

Call Tenant A and ask for `BLUE-HARBOR-B`.

Pass condition: Tenant A returns no answer for that marker and never returns Tenant B content. Then call Tenant B and verify `BLUE-HARBOR-B` is available only there.

Also verify that Tenant A cannot cancel or reschedule Tenant B's appointment and that two simultaneous booking attempts cannot create two active appointments in the same tenant slot.

## Phase 6: n8n Cloud testing

The core Retell call test above does not require Workflow 11 or n8n in the live call path. Promote asynchronous workflows separately so a messaging-provider issue cannot hide a call-routing issue.

### 1. Import

Import these files from `automation/n8n/workflows/` into n8n Cloud:

```text
11-inbound-call-validation-and-conversation.json
12-usage-threshold-alerts.json
13-manual-appointment-status-notifications.json
14-daily-business-summary.json
15-google-review-automation.json
16-waitlist-response-handler.json
```

All imports intentionally default to inactive.

### 2. Configure n8n Cloud

Create the exact credential documented in `automation/n8n/CREDENTIALS.md`:

```text
Credential type: HTTP Header Auth
Display name: QC Automation Key
Header name: x-automation-key
Header value: same value as backend AUTOMATION_SHARED_KEY
```

Configure n8n variables:

```text
QC_BACKEND_BASE_URL=https://api.your-domain.example
N8N_BASE_URL=https://your-workspace.app.n8n.cloud
QC_DEFAULT_PHONE_COUNTRY_CODE=<optional>
QC_GOOGLE_REVIEW_URL=<optional>
QC_WAITLIST_BATCH_SIZE=3
```

Re-select the `QC Automation Key` credential on unresolved Webhook and HTTP Request nodes after import.

### 3. Activate in stages

1. Keep Workflow 11 inactive for production; use it only for regression/Postman testing.
2. Activate Workflow 12 and verify a controlled threshold event.
3. Connect sandbox/test Twilio and email credentials before activating Workflow 13.
4. Activate Workflow 14 and run one Hampton-only summary execution.
5. Activate Workflows 15 and 16 only after review and waitlist test destinations are confirmed.
6. Copy each published n8n webhook URL into the corresponding deployed backend variable:

```text
N8N_USAGE_THRESHOLD_WEBHOOK_URL
N8N_MANUAL_APPOINTMENT_WEBHOOK_URL
N8N_GOOGLE_REVIEW_WEBHOOK_URL
N8N_WAITLIST_WEBHOOK_URL
```

Restart/redeploy the backend after changing these values.

### 4. Run the Postman regression

Use dedicated test tenants and values; never commit populated environment files:

```bash
npm exec --yes newman -- run \
  automation/postman/QC-Automation-Workflow-Tests.postman_collection.json \
  -e automation/postman/QC-Automation-Workflow-Tests.postman_environment.json \
  --env-var "n8nBaseUrl=https://your-workspace.app.n8n.cloud" \
  --env-var "backendBaseUrl=$QC_CANARY_API_BASE_URL" \
  --env-var "automationKey=<LOAD_FROM_SECRET_MANAGER>" \
  --env-var "tenantEmail=<TENANT_A_TEST_EMAIL>" \
  --env-var "tenantInboundNumber=<TENANT_A_TEST_NUMBER>" \
  --env-var "tenantBEmail=<TENANT_B_TEST_EMAIL>" \
  --env-var "tenantBInboundNumber=<TENANT_B_TEST_NUMBER>" \
  --env-var "unknownTenantEmail=<UNREGISTERED_TEST_EMAIL>" \
  --env-var "unknownInboundNumber=<UNREGISTERED_TEST_NUMBER>" \
  --env-var "ownerForwardNumber=<TEST_FORWARD_NUMBER>" \
  --env-var "customerPhone=<TEST_CALLER_NUMBER>" \
  --env-var "customerName=<TEST_CUSTOMER_NAME>" \
  --env-var "customerEmail=<TEST_CUSTOMER_EMAIL>" \
  --env-var "seedCustomerName=<SECOND_TEST_CUSTOMER_NAME>" \
  --env-var "seedCustomerPhone=<SECOND_TEST_CALLER_NUMBER>" \
  --env-var "seedCustomerEmail=<SECOND_TEST_CUSTOMER_EMAIL>"
```

Prefer injecting `automationKey` through a protected CI secret rather than typing it into shell history. Review n8n's **Executions** tab and require successful, tenant-correct executions with no unexpected retries.

## Pass/fail checklist

| Check | Pass condition |
| --- | --- |
| Health | Public HTTPS `/api/health` returns 200 |
| Signature | Invalid Retell signature returns 401 with no state change |
| Routing | Called Hampton number selects only Hampton agent and variables |
| Knowledge | Hampton answers only from Hampton knowledge |
| Availability | Tenant timezone, weekday, hours, duration, buffer, and notice are respected |
| Booking | One durable appointment is created in Hampton dashboard |
| Ownership | Only the original caller can find, move, or cancel the appointment |
| Collision | Same tenant/date/time cannot have two active bookings |
| Call events | One call row is enriched by ended/analyzed events, not duplicated |
| Usage | One reservation and one release per call despite retries |
| Dashboard | Calls and bookings appear within the polling/analysis window |
| Cache isolation | Switching tenants never shows the previous tenant's data |
| n8n | Explicit tenant envelope and successful authenticated executions |
| Prompt safety | Prompt hash is unchanged after reconciliation |
| Rollback | Original phone/agent configuration can be restored immediately |

Any tenant leak, duplicate booking, duplicate usage charge, wrong agent, invalid signature acceptance, prompt change, or cross-caller mutation is an automatic failure. Stop the rollout and rollback.

## Rollback

If any canary step fails:

1. stop placing calls;
2. deactivate the newly activated n8n workflows;
3. remove the backend `N8N_*_WEBHOOK_URL` values or restore their previous values;
4. restore Hampton's recorded Retell phone inbound webhook;
5. restore Hampton's recorded inbound agent binding;
6. restore the agent webhook/events and LLM tools from the private backup if they changed unexpectedly;
7. confirm the prompt hash matches the pre-canary value;
8. restart/redeploy the backend if environment values changed;
9. call once more only to confirm the original routing has been restored;
10. preserve masked call IDs, timestamps, HTTP status codes, and n8n execution IDs for diagnosis.

Do not delete call or appointment evidence until the failure is understood. Avoid publishing caller numbers, transcripts, credentials, or full provider payloads.

## Evidence record

Record the following for the test without secrets or full phone numbers:

```text
Tester:
Date/time and timezone:
Backend commit:
Frontend commit:
Masked tenant ID:
Masked inbound number:
Masked caller number:
Retell call IDs:
n8n execution IDs:
Booking ID:
Information query result: PASS/FAIL
Booking result: PASS/FAIL
Reschedule result: PASS/FAIL
Cancellation result: PASS/FAIL
Dashboard reflection: PASS/FAIL
Tenant isolation: PASS/FAIL
Usage idempotency: PASS/FAIL
Rollback tested: PASS/FAIL
Notes:
```
