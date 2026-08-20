# QuantumConnects n8n Automation

These workflows are multi-tenant automation workers. The backend remains the source of truth for tenant resolution, usage enforcement, appointments, call history, and dashboard data.

## Traffic design

- Live Retell inbound routing: `Retell -> /api/automation/retell/inbound`
- Live Retell tools: `Retell -> /api/automation/retell/functions`
- Live call events: `Retell -> /api/automation/retell/events`
- Async business jobs: `Backend -> n8n webhook -> protected backend automation API`
- Workflow 11: regression/fallback orchestrator only; it is not the production Retell webhook target.

Every production Retell request is signature-verified by the backend before tenant data is read or written. n8n jobs carry an explicit tenant envelope and never select a default business.

## Paid-plan phone provisioning

Phone provisioning is owned by the backend because all tenants use the Quantum Connects Twilio account. After a successful paid plan, the backend buys or reuses the tenant's Twilio number, ensures the shared Twilio Elastic SIP trunk, attaches the purchased number SID to that trunk, creates/imports the Retell agent/number, and syncs the live Retell webhooks.

n8n Cloud should be used for the asynchronous workflows below and for regression visibility. Do not configure a production Twilio number to call n8n directly, and do not store Twilio or Retell API keys in workflow JSON.

## Workflows

| File | Responsibility |
| --- | --- |
| `11-inbound-call-validation-and-conversation.json` | Local/Postman regression path for booking, rescheduling, cancellation, fallback, and knowledge queries |
| `12-usage-threshold-alerts.json` | 70% and 100% usage alert processing |
| `13-manual-appointment-status-notifications.json` | Appointment SMS/email notifications |
| `14-daily-business-summary.json` | Discovers active tenants from the backend and sends one summary per tenant |
| `15-google-review-automation.json` | Rating and review follow-up |
| `16-waitlist-response-handler.json` | Waitlist response processing |

## Local import

Use an isolated n8n data directory so this test does not affect another local n8n installation:

```bash
N8N_USER_FOLDER="$PWD/.local-n8n-retell-test" npm exec --yes n8n@1.98.2 -- import:workflow --separate --input=automation/n8n/workflows
N8N_USER_FOLDER="$PWD/.local-n8n-retell-test" npm exec --yes n8n@1.98.2 -- start
```

Create the credentials in [CREDENTIALS.md](CREDENTIALS.md), configure the variables below, then activate the workflows in n8n.

## Required n8n variables

- `QC_BACKEND_BASE_URL`: backend origin, without a trailing slash
- `N8N_BASE_URL`: n8n origin, without a trailing slash (workflow 11 only)
- `QC_DEFAULT_PHONE_COUNTRY_CODE`: optional notification formatting default
- `QC_GOOGLE_REVIEW_URL`: optional default review URL
- `QC_WAITLIST_BATCH_SIZE`: optional; defaults to 3

Do not put API keys or tenant identifiers in n8n variables or workflow JSON. Secrets belong in credentials; tenant context arrives in each signed or shared-key-protected request.

## Validation and cloud promotion

```bash
npm run automation:validate
```

After local regression tests pass:

1. Import the six JSON files into n8n Cloud.
2. Re-select the cloud credentials if n8n reports an unresolved credential ID.
3. Configure cloud variables with the public backend and n8n origins.
4. Activate workflows 12–16. Activate workflow 11 only if the fallback regression endpoint is intentionally required.
5. Configure backend `N8N_*_WEBHOOK_URL` values with the production webhook URLs.
6. Run the Postman collection with two test tenants before enabling the Hampton Travel canary.

Retell cannot call localhost or a private address. Use an HTTPS tunnel for the final local canary, then use the permanent public backend URL in production.

For the full provider canary, exact caller script, dashboard verification, pass/fail criteria, and rollback procedure, follow [the real-call testing guide](../../docs/REAL_CALL_TESTING_GUIDE.md).
