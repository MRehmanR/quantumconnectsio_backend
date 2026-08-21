# n8n Local Postman Testing Guide

Use this guide to test the n8n workflow contract before making a real Twilio + Retell phone call.

This test path is:

```text
Postman
  -> local n8n workflow 11
  -> backend protected automation endpoints
  -> tenant database, appointments, knowledge base, and dashboard data
```

The live phone-call path is still:

```text
Twilio number -> Twilio SIP trunk -> Retell -> backend signed Retell endpoints
```

Do not configure Retell production webhooks to point at local n8n. Workflow 11 is for local regression and Postman testing.

## 1. Start the backend

From the backend repo:

```bash
cd /Users/abdulrehman/Documents/quantumconnectsio_backend
AUTOMATION_SHARED_KEY="replace-with-a-local-test-key" npm run dev
```

Use the same backend database that contains your test businesses. At minimum you need two active test tenants:

- tenant A: active business, inbound number, booking schedule, knowledge base entry
- tenant B: active business, different inbound number, different knowledge base entry

For booking tests, tenant A must allow the Postman test times:

- booking: 10:00, date is generated as today + 2 days
- seed booking: 11:00, date is generated as today + 3 days
- reschedule: 14:30, date is generated as today + 4 days

Recommended local tenant A rules:

```json
{
  "duration": "30 minutes",
  "buffer": "0 minutes",
  "minNotice": "2 hours"
}
```

Set the weekly schedule to allow 09:00-17:00 on every test day, or update the Postman collection times to match the tenant's real schedule.

## 2. Start local n8n

A clean local n8n profile for Postman testing has been prepared at:

```text
.local-n8n-postman-test
```

To recreate it from scratch without touching another n8n installation:

```bash
cd /Users/abdulrehman/Documents/quantumconnectsio_backend
mkdir -p .local-n8n-postman-test
N8N_USER_FOLDER="$PWD/.local-n8n-postman-test" N8N_RUNNERS_ENABLED=true npm exec --yes n8n@1.98.2 -- import:workflow --separate --input=automation/n8n/workflows
```

Start n8n:

```bash
cd /Users/abdulrehman/Documents/quantumconnectsio_backend
N8N_USER_FOLDER="$PWD/.local-n8n-postman-test" N8N_RUNNERS_ENABLED=true N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true npm exec --yes n8n@1.98.2 -- start
```

Open:

```text
http://localhost:5678
```

## 3. Configure n8n

In n8n, create this credential:

```text
Credential type: Header Auth
Credential name: QC Automation Key
Header name: x-automation-key
Header value: same value as backend AUTOMATION_SHARED_KEY
```

Configure these n8n variables:

```text
QC_BACKEND_BASE_URL=http://localhost:3000
N8N_BASE_URL=http://localhost:5678
QC_DEFAULT_PHONE_COUNTRY_CODE=GB
```

If your backend runs on another port or public tunnel, use that URL for `QC_BACKEND_BASE_URL`. Do not include a trailing slash.

Open workflow `QC - Inbound Call Regression Orchestrator` and confirm all webhook/backend HTTP nodes use the `QC Automation Key` credential.

Activate only this workflow for the first Postman run:

```text
QC - Inbound Call Regression Orchestrator
```

Workflows 12-16 can stay inactive for the first test.

## 4. Import Postman files

Import these two files into Postman:

```text
automation/postman/QC-Automation-Workflow-Tests.postman_collection.json
automation/postman/QC-Automation-Workflow-Tests.postman_environment.json
```

Select environment:

```text
QC Multi-Tenant Integration Local (No Secrets)
```

Fill these environment values:

```text
n8nBaseUrl=http://localhost:5678
backendBaseUrl=http://localhost:3000
automationKey=<same value as AUTOMATION_SHARED_KEY>
tenantEmail=<tenant A email>
tenantInboundNumber=<tenant A inbound number in E.164 format>
tenantBEmail=<tenant B email>
tenantBInboundNumber=<tenant B inbound number in E.164 format>
customerPhone=<test caller phone in E.164 format>
seedCustomerPhone=<same test caller phone in E.164 format>
```

Keep these blank until the collection fills them:

```text
appointmentId=
```

## 5. First Postman run

Run the collection in order. Do not run requests in parallel.

Expected request results:

| Request | Expected result |
| --- | --- |
| `0 - Backend Auth Smoke` | backend accepts automation key |
| `1 - Inbound Booking (Happy Path)` | n8n books a future appointment |
| `2 - Seed Appointment For Reschedule/Cancel` | backend creates a seed appointment |
| `3 - Inbound Reschedule` | n8n reschedules the seed appointment |
| `4 - Inbound Cancel` | n8n cancels the appointment |
| `5 - Inbound General Query` | n8n returns tenant A knowledge only |
| `6 - Inbound Slot Unavailable` | n8n rejects unavailable slot |
| `7 - Tenant B General Query (Isolation)` | tenant B answer does not leak tenant A data |
| `8 - Inbound Fallback (Unknown Tenant)` | unknown number does not book anything |

After request 1, open the website dashboard for tenant A and confirm the appointment exists.

After request 3, confirm the appointment moved to the new date/time.

After request 4, confirm the appointment status is `Cancelled`.

## 6. Troubleshooting

If Postman returns `401`:

- `automationKey` in Postman does not match `AUTOMATION_SHARED_KEY`;
- n8n `QC Automation Key` credential header value does not match `AUTOMATION_SHARED_KEY`;
- the workflow webhook node is not using the `QC Automation Key` credential.

If Postman returns `404` from n8n:

- workflow 11 is not active;
- `n8nBaseUrl` is wrong;
- the request path should be `/webhook/qc-v2-inbound-call`.

If booking fails with `Requested slot is unavailable`:

- tenant schedule does not include the requested date/time;
- tenant `minNotice` is longer than the generated future date;
- an appointment already exists at that date/time;
- change the collection time or update tenant booking rules for the test.

If n8n cannot call the backend:

- confirm `QC_BACKEND_BASE_URL` is set in n8n variables;
- confirm backend is running;
- use `http://127.0.0.1:3000` instead of `http://localhost:3000` if your machine resolves localhost differently.

## 7. When Postman passes

After the Postman collection passes:

1. Activate the required n8n Cloud workflows.
2. Configure production backend `N8N_*_WEBHOOK_URL` values.
3. Run one real call through the Twilio number and Retell agent.
4. Confirm call logs, transcript, appointment, and usage appear in the website dashboard.
