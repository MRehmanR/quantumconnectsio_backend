import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const automationDirectory = path.resolve(scriptDirectory, '..');
const workflowDirectory = path.join(automationDirectory, 'n8n', 'workflows');
const postmanDirectory = path.join(automationDirectory, 'postman');

const jsonFiles = [
    ...fs.readdirSync(workflowDirectory).filter((name) => name.endsWith('.json')).map((name) => path.join(workflowDirectory, name)),
    ...fs.readdirSync(postmanDirectory).filter((name) => name.endsWith('.json')).map((name) => path.join(postmanDirectory, name))
];

const forbidden = [
    { pattern: /unvaccinated-tragicomically-lera\.ngrok-free\.dev/i, message: 'expired ngrok URL' },
    { pattern: /admin@example\.com/i, message: 'default tenant email' },
    { pattern: /\+15559990000/, message: 'hard-coded sample caller number' },
    { pattern: /QC_DAILY_SUMMARY_TENANTS/, message: 'static daily tenant list' },
    { pattern: /http:\/\/localhost:3000/, message: 'hard-coded backend URL' },
    { pattern: /2026-04-\d{2}/, message: 'expired fixed test date' }
];
const failures = [];
const expectedWorkflowFiles = [
    '11-inbound-call-validation-and-conversation.json',
    '12-usage-threshold-alerts.json',
    '13-manual-appointment-status-notifications.json',
    '14-daily-business-summary.json',
    '15-google-review-automation.json',
    '16-waitlist-response-handler.json'
];

const findNode = (workflow, name) => (workflow.nodes || []).find((node) => node.name === name);

for (const expected of expectedWorkflowFiles) {
    if (!fs.existsSync(path.join(workflowDirectory, expected))) {
        failures.push(`n8n/workflows/${expected}: expected workflow is missing`);
    }
}

for (const file of jsonFiles) {
    const relativeFile = path.relative(automationDirectory, file);
    const raw = fs.readFileSync(file, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        failures.push(`${relativeFile}: invalid JSON (${error.message})`);
        continue;
    }

    for (const check of forbidden) {
        if (check.pattern.test(raw)) {
            failures.push(`${relativeFile}: contains ${check.message}`);
        }
    }

    if (file.startsWith(workflowDirectory)) {
        if (!String(parsed.name || '').trim()) {
            failures.push(`${relativeFile}: workflow name is required for n8n import`);
        }
        if (parsed.active !== false) {
            failures.push(`${relativeFile}: imported workflows must default to inactive`);
        }
        for (const node of parsed.nodes || []) {
            const url = String(node?.parameters?.url || '');
            const webhookPath = node?.type === 'n8n-nodes-base.webhook'
                ? String(node?.parameters?.path || '')
                : '';
            if (webhookPath && !webhookPath.startsWith('qc-v2-')) {
                failures.push(`${relativeFile}: webhook ${node.name} must use a qc-v2- path`);
            }
            if (webhookPath && (
                node?.parameters?.authentication !== 'headerAuth' ||
                node?.credentials?.httpHeaderAuth?.name !== 'QC Automation Key'
            )) {
                failures.push(`${relativeFile}: webhook ${node.name} must enforce the QC Automation Key credential`);
            }

            const callsBackend = /\/api\/(automation|appointments)/.test(url);
            if (callsBackend && !url.includes('$vars.QC_BACKEND_BASE_URL')) {
                failures.push(`${relativeFile}: backend node ${node.name} must use $vars.QC_BACKEND_BASE_URL`);
            }
            if (callsBackend && url.includes('||')) {
                failures.push(`${relativeFile}: backend node ${node.name} contains a fallback base URL`);
            }
            if (callsBackend && node?.credentials?.httpHeaderAuth?.name !== 'QC Automation Key') {
                failures.push(`${relativeFile}: backend node ${node.name} must use the QC Automation Key credential`);
            }
            if (/\/api\/appointments(?:\/|['"]|\?)/.test(url)) {
                failures.push(`${relativeFile}: backend node ${node.name} bypasses the protected automation appointment routes`);
            }
        }

        const fileName = path.basename(file);
        if (fileName.startsWith('11-')) {
            const requiredRoutes = new Map([
                ['Get Appointment Availability', '/api/automation/appointments/check-availability'],
                ['Create Appointment (Website Table)', '/api/automation/appointments/book'],
                ['Reschedule Appointment (Website Table)', '/api/automation/appointments/reschedule'],
                ['Cancel Appointment (Website Table)', '/api/automation/appointments/cancel'],
                ['Query Tenant Knowledge Base', '/api/automation/kb/query']
            ]);
            for (const [nodeName, route] of requiredRoutes) {
                if (!String(findNode(parsed, nodeName)?.parameters?.url || '').includes(route)) {
                    failures.push(`${relativeFile}: ${nodeName} must call ${route}`);
                }
            }
            const normalizeCode = String(findNode(parsed, 'Normalize Inbound Request')?.parameters?.jsCode || '');
            for (const field of ['requestedSlot', 'newSlot', 'appointmentId', 'query']) {
                if (!normalizeCode.includes(field)) {
                    failures.push(`${relativeFile}: inbound normalizer must preserve ${field}`);
                }
            }
        }

        if (fileName.startsWith('12-')) {
            const names = (parsed.nodes || []).map((node) => node.name).join('\n');
            if (!names.includes('Usage >= 70') || names.includes('Usage >= 80') || names.includes('Usage 80')) {
                failures.push(`${relativeFile}: usage thresholds must be 70% and 100%`);
            }
            const normalizeCode = String(findNode(parsed, 'Normalize Usage Alert Input')?.parameters?.jsCode || '');
            if (!normalizeCode.includes('job.tenant') || !normalizeCode.includes('job.payload')) {
                failures.push(`${relativeFile}: usage workflow must read the canonical tenant job envelope`);
            }
        }

        if (fileName.startsWith('13-') && findNode(parsed, 'IF Automation Key Present?')) {
            failures.push(`${relativeFile}: manual key-presence checks are not valid authentication`);
        }

        if (fileName.startsWith('14-')) {
            const listUrl = String(findNode(parsed, 'List Active Tenants')?.parameters?.url || '');
            if (!listUrl.includes('/api/automation/tenants/daily-summary')) {
                failures.push(`${relativeFile}: daily summary must discover active tenants from the backend`);
            }
            if (/QC_(?:DAILY_)?SUMMARY_TENANTS/.test(raw)) {
                failures.push(`${relativeFile}: daily summary cannot use a static tenant list`);
            }
        }
    }
}

const collectionPath = path.join(postmanDirectory, 'QC-Automation-Workflow-Tests.postman_collection.json');
const environmentPath = path.join(postmanDirectory, 'QC-Automation-Workflow-Tests.postman_environment.json');
if (fs.existsSync(collectionPath) && fs.existsSync(environmentPath)) {
    const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
    const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
    const variableKeys = new Set((collection.variable || []).map((variable) => variable.key));
    for (const key of ['tenantEmail', 'tenantInboundNumber', 'tenantBEmail', 'tenantBInboundNumber']) {
        if (!variableKeys.has(key)) {
            failures.push(`postman collection: missing ${key} multi-tenant variable`);
        }
    }
    const preRequest = JSON.stringify(collection.event || []);
    for (const dateVariable of ['bookingDate', 'seedDate', 'rescheduleDate']) {
        if (!preRequest.includes(dateVariable)) {
            failures.push(`postman collection: missing dynamic ${dateVariable}`);
        }
    }
    for (const item of collection.item || []) {
        const headers = item?.request?.header || [];
        const hasAutomationKey = headers.some((header) =>
            String(header.key).toLowerCase() === 'x-automation-key' && header.value === '{{automationKey}}'
        );
        if (!hasAutomationKey) {
            failures.push(`postman collection: ${item.name} must send x-automation-key`);
        }
    }
    for (const variable of environment.values || []) {
        if (['automationKey', 'tenantEmail', 'tenantInboundNumber', 'tenantBEmail', 'tenantBInboundNumber'].includes(variable.key) && variable.value) {
            failures.push(`postman environment: ${variable.key} must not contain a committed value`);
        }
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Validated ${jsonFiles.length} n8n/Postman JSON assets.`);
}
