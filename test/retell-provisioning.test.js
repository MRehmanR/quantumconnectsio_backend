const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-retell-provisioning-'));
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'provisioning.sqlite');
process.env.DB_LOGGING = 'false';
process.env.NODE_ENV = 'test';
process.env.RETELL_API_KEY = 'retell-provider-test-key';
process.env.PUBLIC_API_BASE_URL = 'https://api.example.test/';

const { sequelize } = require('../src/config/db');
const {
    buildRetellToolDefinitions,
    syncRetellIntegrationForUser
} = require('../src/services/provisioning.service');
const {
    parseReconciliationArgs,
    maskIdentifier
} = require('../src/scripts/reconcile-retell-integrations');

test.after(async () => {
    await sequelize.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('managed Retell tools use the signed wrapper endpoint and explicit schemas', () => {
    const tools = buildRetellToolDefinitions('https://api.example.test/');
    const names = tools.map((tool) => tool.name);

    assert.deepEqual(names, [
        'get_business_information',
        'find_upcoming_appointments',
        'check_appointment_availability',
        'book_appointment',
        'reschedule_appointment',
        'cancel_appointment'
    ]);

    for (const tool of tools) {
        assert.equal(tool.type, 'custom');
        assert.equal(tool.method, 'POST');
        assert.equal(tool.url, 'https://api.example.test/api/automation/retell/functions');
        assert.equal(tool.args_at_root, false);
        assert.equal(tool.parameters.type, 'object');
        assert.equal(typeof tool.parameters.properties, 'object');
        assert.equal(tool.speak_after_execution, true);
        assert.equal(tool.max_retry, 1);
        assert.deepEqual(tool.headers, {});
    }

    const booking = tools.find((tool) => tool.name === 'book_appointment');
    assert.deepEqual(booking.parameters.required, ['customer_name', 'date', 'time']);
    const reschedule = tools.find((tool) => tool.name === 'reschedule_appointment');
    assert.deepEqual(reschedule.parameters.required, ['appointment_id', 'new_date', 'new_time']);
});

test('provider sync patches only webhooks and merged tools without replacing the prompt', async () => {
    const requests = [];
    const request = async (input) => {
        requests.push(input);
        if (input.method === 'GET' && input.url.includes('/get-phone-number/')) {
            return { inbound_webhook_url: '' };
        }
        if (input.method === 'GET' && input.url.includes('/get-agent/')) {
            return {
                agent_id: 'agent_tenant_42',
                response_engine: { type: 'retell-llm', llm_id: 'llm_tenant_42' },
                webhook_url: ''
            };
        }
        if (input.method === 'GET' && input.url.includes('/get-retell-llm/')) {
            return {
                llm_id: 'llm_tenant_42',
                general_prompt: 'Existing business prompt that must remain unchanged.',
                general_tools: [
                    { type: 'end_call', name: 'end_call', description: 'End the call.' },
                    { type: 'custom', name: 'book_appointment', url: 'https://old.invalid' },
                    { type: 'custom', name: 'tenant_custom_tool', url: 'https://tenant.example.test/tool' }
                ]
            };
        }
        return { ok: true };
    };

    const result = await syncRetellIntegrationForUser({
        id: 42,
        email: 'tenant@example.test',
        inboundNumber: '+447700900002',
        retellAgentId: 'agent_tenant_42'
    }, { request });

    assert.equal(result.applied, true);
    const patches = requests.filter((entry) => entry.method === 'PATCH');
    assert.equal(patches.length, 3);

    const phonePatch = patches.find((entry) => entry.url.includes('/update-phone-number/'));
    assert.equal(phonePatch.body.inbound_webhook_url, 'https://api.example.test/api/automation/retell/inbound');

    const agentPatch = patches.find((entry) => entry.url.includes('/update-agent/'));
    assert.deepEqual(agentPatch.body, {
        webhook_url: 'https://api.example.test/api/automation/retell/events',
        webhook_events: ['call_started', 'call_ended', 'call_analyzed']
    });

    const llmPatch = patches.find((entry) => entry.url.includes('/update-retell-llm/'));
    assert.equal(Object.hasOwn(llmPatch.body, 'general_prompt'), false);
    assert.equal(llmPatch.body.general_tools.some((tool) => tool.name === 'end_call'), true);
    assert.equal(llmPatch.body.general_tools.some((tool) => tool.name === 'tenant_custom_tool'), true);
    assert.equal(llmPatch.body.general_tools.filter((tool) => tool.name === 'book_appointment').length, 1);
});

test('dry-run reconciliation performs no provider mutations', async () => {
    const requests = [];
    const request = async (input) => {
        requests.push(input);
        if (input.url.includes('/get-phone-number/')) {
            return { inbound_webhook_url: '' };
        }
        if (input.url.includes('/get-agent/')) {
            return {
                response_engine: { type: 'retell-llm', llm_id: 'llm_dry_run' }
            };
        }
        if (input.url.includes('/get-retell-llm/')) {
            return {
                general_prompt: 'Keep this prompt.',
                general_tools: [{ type: 'end_call', name: 'end_call' }]
            };
        }
        throw new Error('Dry run attempted a mutation');
    };

    const result = await syncRetellIntegrationForUser({
        id: 7,
        email: 'dry-run@example.test',
        inboundNumber: '+447700900007',
        retellAgentId: 'agent_dry_run'
    }, { request, dryRun: true });

    assert.equal(result.applied, false);
    assert.equal(requests.every((entry) => entry.method === 'GET'), true);
    assert.equal(requests.length, 3);
});

test('public Retell callback URLs must use HTTPS outside development', () => {
    assert.throws(
        () => buildRetellToolDefinitions('http://api.example.test'),
        /https/i
    );
});

test('reconciliation command defaults to dry-run and requires an explicit apply flag', () => {
    assert.deepEqual(parseReconciliationArgs([]), {
        apply: false,
        dryRun: true,
        userId: null
    });
    assert.deepEqual(parseReconciliationArgs(['--apply', '--user-id', '42']), {
        apply: true,
        dryRun: false,
        userId: 42
    });
    assert.throws(() => parseReconciliationArgs(['--user-id', 'invalid']), /user id/i);
    assert.equal(maskIdentifier('+447700900002'), '+44…002');
});
