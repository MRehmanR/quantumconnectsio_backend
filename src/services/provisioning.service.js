const https = require('https');
const { URL } = require('url');
const { Op } = require('sequelize');
const { User, KnowledgeBaseEntry } = require('../models');
const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_NUMBER_COUNTRY,
    TWILIO_AREA_CODE,
    RETELL_API_KEY,
    RETELL_API_BASE_URL,
    RETELL_CREATE_AGENT_PATH,
    RETELL_AGENT_TEMPLATE_ID,
    RETELL_VOICE_ID,
    RETELL_RESPONSE_ENGINE_TYPE,
    RETELL_LLM_ID,
    RETELL_CONVERSATION_FLOW_ID,
    RETELL_WEBHOOK_URL,
    PUBLIC_API_BASE_URL,
    RETELL_SIP_TERMINATION_URI,
    RETELL_SIP_TRUNK_AUTH_USERNAME,
    RETELL_SIP_TRUNK_AUTH_PASSWORD,
    OPENAI_API_KEY,
    OPENAI_MODEL
} = require('../config/env');
const { normalizeCountryCode } = require('../utils/country');

const requestJson = ({ method, url, headers = {}, body }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body ? JSON.stringify(body) : null;

        const req = https.request(
            {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                headers: {
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    let parsedBody = null;
                    try {
                        parsedBody = data ? JSON.parse(data) : null;
                    } catch (_error) {
                        parsedBody = data || null;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody);
                    } else {
                        reject(
                            new Error(
                                `HTTP ${res.statusCode} ${res.statusMessage || ''} ${
                                    typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody || {})
                                }`
                            )
                        );
                    }
                });
            }
        );

        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });

const requestText = ({ method = 'GET', url, headers = {} }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request(
            {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Encoding': 'identity',
                    ...headers
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''}`));
                    }
                });
            }
        );

        req.on('error', reject);
        req.end();
    });

const MANAGED_RETELL_TOOL_NAMES = [
    'get_business_information',
    'find_upcoming_appointments',
    'check_appointment_availability',
    'book_appointment',
    'reschedule_appointment',
    'cancel_appointment'
];

const normalizePublicApiBaseUrl = (value) => {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) {
        throw new Error('PUBLIC_API_BASE_URL is required for Retell integration synchronization.');
    }

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error('PUBLIC_API_BASE_URL must be a valid absolute URL.');
    }

    if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'development') {
        throw new Error('PUBLIC_API_BASE_URL must use HTTPS outside local development.');
    }

    return normalized;
};

const buildRetellToolDefinitions = (publicApiBaseUrl = PUBLIC_API_BASE_URL) => {
    const baseUrl = normalizePublicApiBaseUrl(publicApiBaseUrl);
    const url = `${baseUrl}/api/automation/retell/functions`;
    const stringProperty = (description) => ({ type: 'string', description });
    const createTool = ({ name, description, properties, required = [] }) => ({
        type: 'custom',
        name,
        description,
        url,
        method: 'POST',
        headers: {},
        parameters: {
            type: 'object',
            properties,
            required
        },
        speak_during_execution: true,
        speak_after_execution: true,
        execution_message_type: 'prompt',
        execution_message_description: 'Briefly tell the caller you are checking that information.',
        timeout_ms: 10_000,
        max_retry: 1,
        args_at_root: false,
        parameter_type: 'json'
    });

    return [
        createTool({
            name: 'get_business_information',
            description: 'Search this business account knowledge base. Use for services, policies, hours, locations, prices, and other business questions.',
            properties: {
                query: stringProperty('The caller question or the specific business information to find.')
            },
            required: ['query']
        }),
        createTool({
            name: 'find_upcoming_appointments',
            description: 'Find upcoming appointments for the current caller at this business before rescheduling or cancelling.',
            properties: {}
        }),
        createTool({
            name: 'check_appointment_availability',
            description: 'Get currently available appointment times for a date at this business.',
            properties: {
                date: stringProperty('Appointment date in YYYY-MM-DD format.')
            },
            required: ['date']
        }),
        createTool({
            name: 'book_appointment',
            description: 'Book a confirmed appointment after the caller has chosen an available date and time and confirmed their details.',
            properties: {
                customer_name: stringProperty('Full customer name.'),
                customer_phone: stringProperty('Customer phone number. Omit to use the current caller number.'),
                customer_email: stringProperty('Customer email address when provided.'),
                date: stringProperty('Appointment date in YYYY-MM-DD format.'),
                time: stringProperty('Appointment time in 24-hour HH:mm format.'),
                service_type: stringProperty('Service or appointment type requested by the caller.')
            },
            required: ['customer_name', 'date', 'time']
        }),
        createTool({
            name: 'reschedule_appointment',
            description: 'Move an appointment belonging to the current caller and this business to a newly confirmed date and time.',
            properties: {
                appointment_id: stringProperty('Appointment identifier returned by find_upcoming_appointments.'),
                new_date: stringProperty('New appointment date in YYYY-MM-DD format.'),
                new_time: stringProperty('New appointment time in 24-hour HH:mm format.')
            },
            required: ['appointment_id', 'new_date', 'new_time']
        }),
        createTool({
            name: 'cancel_appointment',
            description: 'Cancel an appointment belonging to the current caller and this business after the caller confirms cancellation.',
            properties: {
                appointment_id: stringProperty('Appointment identifier returned by find_upcoming_appointments.'),
                reason: stringProperty('Short cancellation reason when the caller provides one.')
            },
            required: ['appointment_id']
        })
    ];
};

const syncRetellIntegrationForUser = async (user, options = {}) => {
    if (!user?.id || !user?.inboundNumber || !user?.retellAgentId) {
        throw new Error('A provisioned user, inbound number, and Retell agent id are required.');
    }
    if (!RETELL_API_KEY) {
        throw new Error('RETELL_API_KEY is required for Retell integration synchronization.');
    }

    const request = options.request || requestJson;
    const dryRun = Boolean(options.dryRun);
    const publicBaseUrl = normalizePublicApiBaseUrl(options.publicApiBaseUrl || PUBLIC_API_BASE_URL);
    const retellBaseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const authorization = { Authorization: `Bearer ${RETELL_API_KEY}` };
    const agentId = String(user.retellAgentId).trim();
    const phoneNumber = String(user.inboundNumber).trim();
    const agent = await request({
        method: 'GET',
        url: `${retellBaseUrl}/get-agent/${encodeURIComponent(agentId)}`,
        headers: authorization
    });
    const responseEngine = agent?.response_engine || {};
    if (responseEngine.type !== 'retell-llm' || !responseEngine.llm_id) {
        throw new Error('Retell integration tools currently require a retell-llm response engine.');
    }

    const llmId = String(responseEngine.llm_id);
    const llm = await request({
        method: 'GET',
        url: `${retellBaseUrl}/get-retell-llm/${encodeURIComponent(llmId)}`,
        headers: authorization
    });
    const managedNames = new Set(MANAGED_RETELL_TOOL_NAMES);
    const existingTools = Array.isArray(llm?.general_tools) ? llm.general_tools : [];
    const preservedTools = existingTools.filter((tool) => !managedNames.has(String(tool?.name || '')));
    const mergedTools = [
        ...preservedTools,
        ...buildRetellToolDefinitions(publicBaseUrl)
    ];
    const changes = [
        'phone.inbound_webhook_url',
        'agent.webhook_url',
        'agent.webhook_events',
        'llm.general_tools'
    ];

    if (dryRun) {
        return {
            userId: String(user.id),
            applied: false,
            dryRun: true,
            promptPreserved: true,
            changes
        };
    }

    await request({
        method: 'PATCH',
        url: `${retellBaseUrl}/update-phone-number/${encodeURIComponent(phoneNumber)}`,
        headers: authorization,
        body: {
            inbound_webhook_url: `${publicBaseUrl}/api/automation/retell/inbound`
        }
    });
    await request({
        method: 'PATCH',
        url: `${retellBaseUrl}/update-agent/${encodeURIComponent(agentId)}`,
        headers: authorization,
        body: {
            webhook_url: `${publicBaseUrl}/api/automation/retell/events`,
            webhook_events: ['call_started', 'call_ended', 'call_analyzed']
        }
    });
    await request({
        method: 'PATCH',
        url: `${retellBaseUrl}/update-retell-llm/${encodeURIComponent(llmId)}`,
        headers: authorization,
        body: { general_tools: mergedTools }
    });

    return {
        userId: String(user.id),
        applied: true,
        dryRun: false,
        promptPreserved: true,
        changes
    };
};

const syncRetellIntegrationWhenConfigured = async (user) => {
    if (!String(PUBLIC_API_BASE_URL || '').trim()) {
        return { skipped: true, reason: 'public_api_base_url_not_configured' };
    }
    return syncRetellIntegrationForUser(user);
};

const PROVISIONING_ERROR_MAX_LEN = 240;
const normalizeProvisioningError = (value, fallback = '') => {
    const text = String(value || fallback || '').trim();
    if (!text) {
        return '';
    }
    return text.slice(0, PROVISIONING_ERROR_MAX_LEN);
};
const normalizePromptText = (value) => String(value || '').trim().slice(0, 4000);
const normalizeWebsiteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
    }
    return `https://${raw}`;
};
const htmlToText = (html) =>
    String(html || '')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

const buildBusinessPrompt = ({ businessName, ownerName, ownerPhone, customPrompt }) => {
    const normalizedBusinessName = String(businessName || 'This business').trim();
    const normalizedOwnerName = String(ownerName || '').trim();
    const normalizedOwnerPhone = String(ownerPhone || '').trim();
    const normalizedCustomPrompt = normalizePromptText(customPrompt);

    const lines = [
        `You are the AI receptionist for ${normalizedBusinessName}.`,
        'Use the business name naturally in greetings and conversation.',
        'Never introduce yourself as Quantum Connects; represent only the business.',
        'Collect caller details clearly and confirm appointment/payment details before ending the call.'
    ];

    if (normalizedOwnerName) {
        lines.push(`Business owner/contact: ${normalizedOwnerName}.`);
    }
    if (normalizedOwnerPhone) {
        lines.push(`Escalation phone: ${normalizedOwnerPhone}.`);
    }
    if (normalizedCustomPrompt) {
        lines.push('Business-specific instructions:');
        lines.push(normalizedCustomPrompt);
    }

    return lines.join('\n');
};

const generatePromptWithOpenAI = async ({ businessName, ownerName, ownerPhone, userInstructions }) => {
    if (!OPENAI_API_KEY) {
        throw new Error('OpenAI is not configured. Set OPENAI_API_KEY in backend .env.');
    }

    const model = String(OPENAI_MODEL || 'gpt-4.1-mini').trim();
    const payload = {
        model,
        messages: [
            {
                role: 'system',
                content:
                    'You create concise, production-ready voice agent prompts for business call handling. ' +
                    'Return plain text only without markdown.'
            },
            {
                role: 'user',
                content: [
                    `Business Name: ${String(businessName || '').trim() || 'Business'}`,
                    `Owner Name: ${String(ownerName || '').trim() || 'N/A'}`,
                    `Owner Phone: ${String(ownerPhone || '').trim() || 'N/A'}`,
                    `Custom Instructions: ${String(userInstructions || '').trim() || 'N/A'}`,
                    '',
                    'Write a complete voice receptionist prompt that includes:',
                    '1) Role and identity for this exact business',
                    '2) Tone and speaking style',
                    '3) Information collection order (name, phone, purpose, preferred time)',
                    '4) Appointment/deposit handling rules',
                    '5) Escalation rules for urgent calls',
                    '6) Clear constraint: never mention Quantum Connects',
                    '',
                    'Keep it practical and under 350 words.'
                ].join('\n')
            }
        ],
        temperature: 0.4
    };

    const result = await requestJson({
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: payload
    });

    const text = String(result?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
        throw new Error('OpenAI did not return prompt text. Please try again.');
    }
    return {
        prompt: normalizePromptText(text),
        model
    };
};

const createRetellLlm = async ({ baseUrl, generalPrompt }) => {
    const created = await requestJson({
        method: 'POST',
        url: `${baseUrl}/create-retell-llm`,
        headers: {
            Authorization: `Bearer ${RETELL_API_KEY}`
        },
        body: {
            model: 'gpt-4.1',
            general_prompt: generalPrompt
        }
    });

    return String(created?.llm_id || '').trim();
};

const importWebsiteKnowledgeBase = async ({ user, websiteUrl }) => {
    const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
    if (!normalizedUrl || !user?.id) {
        return {
            imported: false,
            skipped: true
        };
    }

    const html = await requestText({ url: normalizedUrl });
    const text = htmlToText(html).slice(0, 20000);
    if (!text) {
        return {
            imported: false,
            skipped: true,
            reason: 'empty_website_content'
        };
    }

    await KnowledgeBaseEntry.create({
        userId: user.id,
        title: `${user.businessName || 'Business'} Website Knowledge`,
        category: 'Website',
        content: `Source: ${normalizedUrl}\n\n${text}`
    });

    return {
        imported: true,
        source: normalizedUrl
    };
};

const getRetellAgentById = async ({ baseUrl, agentId }) => {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
        return null;
    }

    try {
        const agent = await requestJson({
            method: 'GET',
            url: `${baseUrl}/get-agent/${encodeURIComponent(normalizedAgentId)}`,
            headers: {
                Authorization: `Bearer ${RETELL_API_KEY}`
            }
        });
        return agent || null;
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const missing = message.includes('not found') || message.includes('item') || message.includes('404');
        if (missing) {
            return null;
        }
        throw error;
    }
};

const toFormBody = (params) =>
    Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');

const normalizeTwilioCountryCode = (value) => {
    const raw = normalizeCountryCode(value);
    if (!raw) {
        return String(TWILIO_NUMBER_COUNTRY || 'US').trim().toUpperCase();
    }
    return raw;
};

const getAutoAssignCountryFallbacks = (preferredCountry) => {
    const normalizedPreferred = normalizeTwilioCountryCode(preferredCountry || '');
    const fromEnv = String(process.env.TWILIO_AUTO_ASSIGN_COUNTRIES || '')
        .split(',')
        .map((value) => normalizeTwilioCountryCode(value))
        .filter(Boolean);
    const defaultCountry = normalizeTwilioCountryCode(TWILIO_NUMBER_COUNTRY || 'US');
    const ordered = [normalizedPreferred, ...fromEnv, defaultCountry].filter(Boolean);
    return ordered.filter((value, index) => ordered.indexOf(value) === index);
};

const isTwilioCountryUnavailableForAutoAssign = (error) => {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }
    return (
        message.includes('regulatory bundle verification') ||
        message.includes('no available twilio numbers found')
    );
};

const getSipTrunkConfigForUser = (user) => {
    const userTerminationUri = String(user?.retellSipTerminationUri || '').trim();
    const userTrunkUsername = String(user?.retellSipTrunkAuthUsername || '').trim();
    const userTrunkPassword = String(user?.retellSipTrunkAuthPassword || '').trim();

    return {
        terminationUri: userTerminationUri || String(RETELL_SIP_TERMINATION_URI || '').trim(),
        trunkUsername: userTrunkUsername || String(RETELL_SIP_TRUNK_AUTH_USERNAME || '').trim(),
        trunkPassword: userTrunkPassword || String(RETELL_SIP_TRUNK_AUTH_PASSWORD || '').trim()
    };
};

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const discoverTwilioTerminationUriForNumber = async (phoneNumber) => {
    const normalizedPhone = String(phoneNumber || '').trim();
    if (!normalizedPhone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        return null;
    }

    const targetDigits = normalizePhoneDigits(normalizedPhone);
    if (!targetDigits) {
        return null;
    }

    const trunkPagesToScan = 20;
    const phonePagesToScanPerTrunk = 20;
    let trunksUrl = 'https://trunking.twilio.com/v1/Trunks?PageSize=100';
    let trunksScanned = 0;

    while (trunksUrl && trunksScanned < trunkPagesToScan) {
        const trunksResponse = await requestTwilioJson({
            method: 'GET',
            url: trunksUrl
        });

        const trunks = Array.isArray(trunksResponse?.trunks) ? trunksResponse.trunks : [];
        for (const trunk of trunks) {
            const trunkSid = String(trunk?.sid || '').trim();
            const domainName = String(trunk?.domain_name || '').trim();
            if (!trunkSid || !domainName) {
                continue;
            }

            let phoneNumbersUrl = `https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers?PageSize=100`;
            let phonePagesScanned = 0;
            while (phoneNumbersUrl && phonePagesScanned < phonePagesToScanPerTrunk) {
                const phoneNumbersResponse = await requestTwilioJson({
                    method: 'GET',
                    url: phoneNumbersUrl
                });

                const phoneNumbers = Array.isArray(phoneNumbersResponse?.phone_numbers)
                    ? phoneNumbersResponse.phone_numbers
                    : [];

                const matched = phoneNumbers.some((item) => normalizePhoneDigits(item?.phone_number) === targetDigits);
                if (matched) {
                    return {
                        terminationUri: domainName,
                        trunkSid
                    };
                }

                phoneNumbersUrl = phoneNumbersResponse?.meta?.next_page_url || null;
                phonePagesScanned += 1;
            }
        }

        trunksUrl = trunksResponse?.meta?.next_page_url || null;
        trunksScanned += 1;
    }

    return null;
};

const resolveSipTrunkConfigForImport = async ({ user, phoneNumber }) => {
    const configured = getSipTrunkConfigForUser(user);
    if (configured.terminationUri) {
        return configured;
    }

    try {
        const discovered = await discoverTwilioTerminationUriForNumber(phoneNumber);
        if (discovered?.terminationUri) {
            return {
                ...configured,
                terminationUri: discovered.terminationUri
            };
        }
    } catch (_error) {
        // Discovery is best-effort. If it fails, we fall back to existing configured values.
    }

    return configured;
};

const requestTwilioForm = ({ method, url, params }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = toFormBody(params || {});

        const req = https.request(
            {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || 443,
                headers: {
                    Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(payload)
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    let parsedBody = null;
                    try {
                        parsedBody = data ? JSON.parse(data) : null;
                    } catch (_error) {
                        parsedBody = data || null;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody);
                    } else {
                        reject(
                            new Error(
                                `Twilio ${res.statusCode} ${res.statusMessage || ''} ${
                                    typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody || {})
                                }`
                            )
                        );
                    }
                });
            }
        );

        req.on('error', reject);
        req.write(payload);
        req.end();
    });

const requestTwilioJson = ({ method, url }) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request(
            {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                protocol: parsed.protocol,
                port: parsed.port || 443,
                headers: {
                    Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
                    Accept: 'application/json'
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    let parsedBody = null;
                    try {
                        parsedBody = data ? JSON.parse(data) : null;
                    } catch (_error) {
                        parsedBody = data || null;
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedBody || {});
                    } else {
                        reject(
                            new Error(
                                `Twilio ${res.statusCode} ${res.statusMessage || ''} ${
                                    typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody || {})
                                }`
                            )
                        );
                    }
                });
            }
        );

        req.on('error', reject);
        req.end();
    });

const isTwilioBundleRequiredError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('bundle required') || message.includes('"code":21649') || message.includes('code 21649');
};

const getTwilioNumber = async ({ country, areaCode, contains, limit } = {}) => {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        return {
            skipped: true,
            reason: 'twilio_not_configured'
        };
    }

    const selectedCountry = normalizeTwilioCountryCode(country || TWILIO_NUMBER_COUNTRY || 'US');
    const requestedLimit = Math.max(1, Math.min(Number(limit || 1), 20));
    const base = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`;
    const queryParams = new URLSearchParams({
        VoiceEnabled: 'true',
        SmsEnabled: 'true',
        Limit: String(requestedLimit)
    });

    const isNanpCountry = selectedCountry === 'US' || selectedCountry === 'CA';

    if (areaCode && isNanpCountry) {
        queryParams.set('AreaCode', String(areaCode).replace(/\D/g, '').slice(0, 6));
    }
    if (contains) {
        queryParams.set('Contains', String(contains).trim());
    }

    const authHeader = {
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
    };
    const searchableTypes = ['Local', 'Mobile', 'National', 'TollFree'];
    const merged = new Map();

    await Promise.all(
        searchableTypes.map(async (type) => {
            try {
                const available = await requestJson({
                    method: 'GET',
                    url: `${base}/AvailablePhoneNumbers/${selectedCountry}/${type}.json?${queryParams.toString()}`,
                    headers: authHeader
                });

                const candidates = available?.available_phone_numbers || [];
                candidates.forEach((item) => {
                    const phoneNumber = item?.phone_number || '';
                    if (!phoneNumber || merged.has(phoneNumber)) {
                        return;
                    }
                    merged.set(phoneNumber, {
                        phoneNumber,
                        friendlyName: item?.friendly_name || '',
                        locality: item?.locality || '',
                        region: item?.region || '',
                        isoCountry: item?.iso_country || selectedCountry,
                        numberType: String(type || '').toUpperCase()
                    });
                });
            } catch (_error) {
                // Some Twilio number types are unavailable for certain countries.
            }
        })
    );

    return {
        phoneNumbers: Array.from(merged.values()).slice(0, requestedLimit)
    };
};

const purchaseTwilioNumber = async ({ phoneNumber, areaCode, country }) => {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio is not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    }

    const selectedCountry = normalizeTwilioCountryCode(country || TWILIO_NUMBER_COUNTRY || 'US');
    const base = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`;

    const tryPurchase = async (candidatePhoneNumber) =>
        requestTwilioForm({
            method: 'POST',
            url: `${base}/IncomingPhoneNumbers.json`,
            params: {
                PhoneNumber: candidatePhoneNumber,
                AreaCode: undefined,
                VoiceUrl: undefined,
                SmsUrl: undefined,
                FriendlyName: `${candidatePhoneNumber} (${selectedCountry})`
            }
        });

    let selectedPhoneNumber = String(phoneNumber || '').trim();
    let lastError = null;
    if (selectedPhoneNumber) {
        try {
            const purchase = await tryPurchase(selectedPhoneNumber);
            return {
                phoneNumber: purchase?.phone_number || '',
                phoneSid: purchase?.sid || ''
            };
        } catch (error) {
            if (isTwilioBundleRequiredError(error)) {
                lastError = error;
            } else {
                throw error;
            }
        }
    }

    const available = await getTwilioNumber({
            country: selectedCountry,
            areaCode,
            limit: 20
        });
    const candidatesRaw = Array.isArray(available?.phoneNumbers) ? available.phoneNumbers : [];
    const scoreType = (type) => {
        const normalized = String(type || '').toUpperCase();
        if (normalized === 'LOCAL') return 1;
        if (normalized === 'NATIONAL') return 2;
        if (normalized === 'TOLLFREE') return 3;
        if (normalized === 'MOBILE') return 4;
        return 9;
    };
    const candidates = [...candidatesRaw]
        .filter((item) => String(item?.phoneNumber || '').trim())
        .sort((a, b) => scoreType(a?.numberType) - scoreType(b?.numberType));

    if (candidates.length === 0) {
        throw new Error(`No available Twilio numbers found for country ${selectedCountry}. Try a different country/area code.`);
    }

    for (const candidate of candidates) {
        selectedPhoneNumber = String(candidate?.phoneNumber || '').trim();
        if (!selectedPhoneNumber) {
            continue;
        }
        try {
            const purchase = await tryPurchase(selectedPhoneNumber);
            return {
                phoneNumber: purchase?.phone_number || '',
                phoneSid: purchase?.sid || ''
            };
        } catch (error) {
            lastError = error;
            if (isTwilioBundleRequiredError(error)) {
                continue;
            }
            throw error;
        }
    }

    if (lastError && isTwilioBundleRequiredError(lastError)) {
        throw new Error(
            `All available Twilio numbers for ${selectedCountry} currently require regulatory bundle verification. ` +
            'Complete Twilio Regulatory Bundle setup or choose another country/number.'
        );
    }

    if (!selectedPhoneNumber) {
        const available = await getTwilioNumber({
            country: selectedCountry,
            areaCode,
            limit: 1
        });
        selectedPhoneNumber = String(available?.phoneNumbers?.[0]?.phoneNumber || '').trim();
        if (!selectedPhoneNumber) {
            throw new Error(`No available Twilio numbers found for country ${selectedCountry}. Try a different country/area code.`);
        }
    }
    throw lastError || new Error(`Twilio could not purchase a number for ${selectedCountry}.`);
};

const ensureNumberNotUsedByAnotherBusiness = async ({ userId, phoneNumber }) => {
    if (!phoneNumber) {
        return;
    }

    const existing = await User.findOne({
        where: {
            inboundNumber: phoneNumber,
            id: {
                [Op.ne]: userId
            }
        },
        attributes: ['id', 'email']
    });

    if (existing) {
        throw new Error(`This number is already assigned to another business account (${existing.email}).`);
    }
};

const listAvailableNumbersForUser = async ({ userId, country, areaCode, contains, limit = 10 }) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found for provisioning');
    }

    const available = await getTwilioNumber({
        country: country || user.countryCode || undefined,
        areaCode,
        contains,
        limit
    });

    return available.phoneNumbers || [];
};

const createRetellAgent = async ({ businessName, inboundNumber, ownerPhone, ownerName, customPrompt, voiceId: requestedVoiceId }) => {
    if (!RETELL_API_KEY) {
        return {
            skipped: true,
            reason: 'retell_not_configured'
        };
    }

    const baseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const configuredPath = String(RETELL_CREATE_AGENT_PATH || '/create-agent').trim();
    const normalizedConfiguredPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`;

    const responseEngineType = String(RETELL_RESPONSE_ENGINE_TYPE || 'retell-llm').trim().toLowerCase();
    const voiceId = String(requestedVoiceId || RETELL_VOICE_ID || '').trim();
    const configuredLlmId = String(RETELL_LLM_ID || '').trim();
    const conversationFlowId = String(RETELL_CONVERSATION_FLOW_ID || '').trim();

    if (!voiceId) {
        throw new Error('Retell is missing RETELL_VOICE_ID. Set a valid voice id from Retell dashboard.');
    }

    let responseEngine = null;
    let selectedLlmId = configuredLlmId;
    if (responseEngineType === 'conversation-flow') {
        if (!conversationFlowId) {
            throw new Error('Retell is missing RETELL_CONVERSATION_FLOW_ID for conversation-flow response engine.');
        }
        responseEngine = {
            type: 'conversation-flow',
            conversation_flow_id: conversationFlowId
        };
    } else {
        const generalPrompt = buildBusinessPrompt({
            businessName,
            ownerName,
            ownerPhone,
            customPrompt
        });
        const createdLlmId = await createRetellLlm({
            baseUrl,
            generalPrompt
        });
        const llmId = createdLlmId || configuredLlmId;
        if (!llmId) {
            throw new Error('Retell is missing RETELL_LLM_ID for retell-llm response engine.');
        }
        selectedLlmId = llmId;
        responseEngine = {
            type: 'retell-llm',
            llm_id: llmId
        };
    }

    const payload = {
        agent_name: `${businessName || 'Business'} Voice Agent`,
        template_id: RETELL_AGENT_TEMPLATE_ID || undefined,
        response_engine: responseEngine,
        voice_id: voiceId,
        inbound_phone_number: inboundNumber || undefined,
        owner_phone: ownerPhone || undefined,
        webhook_url: RETELL_WEBHOOK_URL || undefined
    };

    const fallbackPaths = [normalizedConfiguredPath, '/create-agent', '/v2/agents']
        .filter(Boolean)
        .filter((value, index, arr) => arr.indexOf(value) === index);

    let created = null;
    let lastError = null;
    let firstMeaningfulError = null;
    for (const path of fallbackPaths) {
        try {
            created = await requestJson({
                method: 'POST',
                url: `${baseUrl}${path}`,
                headers: {
                    Authorization: `Bearer ${RETELL_API_KEY}`
                },
                body: payload
            });
            break;
        } catch (error) {
            lastError = error;
            const message = String(error?.message || '');
            const isNotFound = message.includes('HTTP 404') || message.includes('Cannot POST');
            const isLikelyEndpointMismatch =
                message.includes('HTTP 400') &&
                (
                    message.toLowerCase().includes('invalid response engine') ||
                    message.toLowerCase().includes('invalid request format') ||
                    message.includes('request/body')
                );
            if (!isNotFound && !firstMeaningfulError) {
                firstMeaningfulError = error;
            }
            if (!isNotFound && !isLikelyEndpointMismatch) {
                throw error;
            }
        }
    }

    if (!created) {
        const baseError = firstMeaningfulError || lastError || new Error('Failed to create Retell agent');
        const baseMessage = String(baseError?.message || '');
        if (
            responseEngineType === 'retell-llm' &&
            baseMessage.toLowerCase().includes('invalid response engine')
        ) {
            try {
                const llms = await requestJson({
                    method: 'GET',
                    url: `${baseUrl}/list-retell-llms`,
                    headers: {
                        Authorization: `Bearer ${RETELL_API_KEY}`
                    }
                });
                const ids = Array.isArray(llms)
                    ? llms.map((item) => String(item?.llm_id || '').trim()).filter(Boolean).slice(0, 5)
                    : [];
                const hint = ids.length
                    ? `Available LLM ids include: ${ids.join(', ')}.`
                    : 'No LLM ids were returned from Retell for this API key.';
                throw new Error(
                    `Retell rejected response_engine. Check RETELL_LLM_ID (${selectedLlmId}). ${hint}`
                );
            } catch (llmLookupError) {
                const lookupMessage = String(llmLookupError?.message || '');
                if (lookupMessage.startsWith('Retell rejected response_engine.')) {
                    throw llmLookupError;
                }
                throw new Error(
                    `Retell rejected response_engine. Check RETELL_LLM_ID (${selectedLlmId}) and RETELL_RESPONSE_ENGINE_TYPE.`
                );
            }
        }
        throw baseError;
    }

    return {
        retellAgentId: created?.agent_id || created?.id || ''
    };
};

const bindRetellNumberToAgent = async ({ phoneNumber, agentId }) => {
    if (!RETELL_API_KEY) {
        return {
            skipped: true,
            reason: 'retell_not_configured'
        };
    }

    const normalizedPhone = String(phoneNumber || '').trim();
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedPhone || !normalizedAgentId) {
        return {
            skipped: true,
            reason: 'missing_phone_or_agent'
        };
    }

    const baseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const encodedPhone = encodeURIComponent(normalizedPhone);
    const updatePaths = [
        `/update-phone-number/${encodedPhone}`,
        `/v2/update-phone-number/${encodedPhone}`
    ];

    const body = {
        // Legacy fields (still accepted for single agent in many accounts)
        inbound_agent_id: normalizedAgentId,
        outbound_agent_id: normalizedAgentId,
        // New weighted fields
        inbound_agents: [{ agent_id: normalizedAgentId, weight: 1 }],
        outbound_agents: [{ agent_id: normalizedAgentId, weight: 1 }]
    };

    let lastError = null;
    for (const path of updatePaths) {
        for (const method of ['PATCH', 'POST']) {
            try {
                const updated = await requestJson({
                    method,
                    url: `${baseUrl}${path}`,
                    headers: {
                        Authorization: `Bearer ${RETELL_API_KEY}`
                    },
                    body
                });

                return {
                    bound: true,
                    phoneNumber: normalizedPhone,
                    agentId: normalizedAgentId,
                    response: updated
                };
            } catch (error) {
                lastError = error;
                const message = String(error?.message || '');
                const isRetryablePathOrMethod =
                    message.includes('HTTP 404') ||
                    message.includes('Cannot PATCH') ||
                    message.includes('Cannot POST') ||
                    message.includes('method not allowed');
                if (!isRetryablePathOrMethod) {
                    throw error;
                }
            }
        }
    }

    const finalMessage = String(lastError?.message || '');
    if (finalMessage.includes('HTTP 404') || finalMessage.includes('not found')) {
        throw new Error(
            `Retell phone number ${normalizedPhone} was not found in Retell. ` +
            'If using SIP trunking, import this number in Retell Phone Numbers first, then retry setup.'
        );
    }

    throw lastError || new Error('Failed to bind Retell phone number to agent');
};

const importRetellPhoneNumberIfNeeded = async ({ phoneNumber, agentId, sipTrunkConfig }) => {
    if (!RETELL_API_KEY) {
        return {
            skipped: true,
            reason: 'retell_not_configured'
        };
    }

    const normalizedPhone = String(phoneNumber || '').trim();
    const normalizedAgentId = String(agentId || '').trim();
    const resolvedSipConfig = sipTrunkConfig || {};
    const terminationUri = String(resolvedSipConfig?.terminationUri || RETELL_SIP_TERMINATION_URI || '').trim();
    const trunkUsername = String(resolvedSipConfig?.trunkUsername || RETELL_SIP_TRUNK_AUTH_USERNAME || '').trim();
    const trunkPassword = String(resolvedSipConfig?.trunkPassword || RETELL_SIP_TRUNK_AUTH_PASSWORD || '').trim();

    if (!normalizedPhone || !normalizedAgentId) {
        return {
            skipped: true,
            reason: 'missing_phone_or_agent'
        };
    }

    if (!terminationUri) {
        return {
            skipped: true,
            reason: 'missing_sip_termination_uri'
        };
    }

    const baseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const importPaths = ['/import-phone-number', '/v2/import-phone-number'];
    const importBody = {
        phone_number: normalizedPhone,
        termination_uri: terminationUri,
        inbound_agent_id: normalizedAgentId,
        outbound_agent_id: normalizedAgentId,
        inbound_agents: [{ agent_id: normalizedAgentId, weight: 1 }],
        outbound_agents: [{ agent_id: normalizedAgentId, weight: 1 }],
        sip_trunk_auth_username: trunkUsername || undefined,
        sip_trunk_auth_password: trunkPassword || undefined
    };

    let lastError = null;
    for (const path of importPaths) {
        try {
            const imported = await requestJson({
                method: 'POST',
                url: `${baseUrl}${path}`,
                headers: {
                    Authorization: `Bearer ${RETELL_API_KEY}`
                },
                body: importBody
            });
            return {
                imported: true,
                phoneNumber: normalizedPhone,
                response: imported
            };
        } catch (error) {
            lastError = error;
            const message = String(error?.message || '');
            const isNotFound = message.includes('HTTP 404') || message.includes('Cannot POST');
            if (!isNotFound) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Failed to import phone number to Retell');
};

const isRetellAgentMissingError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }

    const hasAgentKeyword = message.includes('agent');
    const hasMissingPattern =
        message.includes('not found') ||
        message.includes('does not exist') ||
        message.includes('unknown') ||
        message.includes('invalid') ||
        message.includes('no such');

    return hasAgentKeyword && hasMissingPattern;
};

const isRetellPhoneMissingError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }
    return (
        message.includes('phone number') &&
        (
            message.includes('not found') ||
            message.includes('does not exist') ||
            message.includes('no such')
        )
    );
};

const isRetellManualInterventionError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }
    return (
        message.includes('retell phone number') &&
        (
            message.includes('was not found') ||
            message.includes('import manually in retell dashboard') ||
            message.includes('missing_sip_termination_uri')
        )
    );
};

const createAndPersistRetellAgent = async (user, options = {}) => {
    const retell = await createRetellAgent({
        businessName: user.businessName,
        inboundNumber: user.inboundNumber,
        ownerPhone: user.ownerPhone,
        ownerName: user.username,
        customPrompt: options.customPrompt,
        voiceId: options.voiceId
    });

    if (!retell?.retellAgentId) {
        const reason = retell?.reason === 'retell_not_configured'
            ? 'Retell is not configured. Set RETELL_API_KEY in backend .env.'
            : 'Retell agent provisioning did not return an agent id.';
        user.provisioningStatus = 'manual_required';
        user.provisioningError = normalizeProvisioningError(reason);
        await user.save();
        throw new Error(reason);
    }

    user.retellAgentId = retell.retellAgentId;
    await user.save();
};

const provisionRetellAgentForUser = async (userId, options = {}) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found for Retell provisioning');
    }

    if (!user.inboundNumber) {
        throw new Error('Please buy a business number first before setting up Retell voice agent.');
    }

    const force = Boolean(options?.force);
    const customPrompt = normalizePromptText(options?.customPrompt);
    const baseUrl = String(RETELL_API_BASE_URL || 'https://api.retellai.com').trim().replace(/\/$/, '');
    const sipTrunkConfig = await resolveSipTrunkConfigForImport({
        user,
        phoneNumber: user.inboundNumber
    });
    user.provisioningStatus = 'in_progress';
    user.provisioningError = '';
    await user.save();

    try {
        if (user.retellAgentId && !force) {
            const liveAgent = await getRetellAgentById({
                baseUrl,
                agentId: user.retellAgentId
            });

            if (liveAgent) {
                await bindRetellNumberToAgent({
                    phoneNumber: user.inboundNumber,
                    agentId: user.retellAgentId
                });

                await syncRetellIntegrationWhenConfigured(user);

                user.provisioningStatus = 'active';
                user.provisioningError = '';
                await user.save();

                return {
                    userId: user.id,
                    inboundNumber: user.inboundNumber,
                    twilioPhoneNumberSid: user.twilioPhoneNumberSid,
                    retellAgentId: user.retellAgentId,
                    provisioningStatus: user.provisioningStatus
                };
            }

            user.retellAgentId = '';
            await user.save();
        }

        if (!user.retellAgentId || force) {
            await createAndPersistRetellAgent(user, {
                customPrompt,
                voiceId: options?.voiceId
            });
        }

        try {
            await bindRetellNumberToAgent({
                phoneNumber: user.inboundNumber,
                agentId: user.retellAgentId
            });
        } catch (bindError) {
            if (isRetellPhoneMissingError(bindError)) {
                const importResult = await importRetellPhoneNumberIfNeeded({
                    phoneNumber: user.inboundNumber,
                    agentId: user.retellAgentId,
                    sipTrunkConfig
                });

                if (importResult?.skipped && importResult.reason === 'missing_sip_termination_uri') {
                    throw new Error(
                        `Retell phone number ${user.inboundNumber} was not found. ` +
                        'Set SIP trunk details in this business profile (or RETELL_SIP_TERMINATION_URI in backend .env) to auto-import SIP-trunk numbers, or import manually in Retell dashboard.'
                    );
                }

                await bindRetellNumberToAgent({
                    phoneNumber: user.inboundNumber,
                    agentId: user.retellAgentId
                });
            } else
            if (!force && isRetellAgentMissingError(bindError)) {
                user.retellAgentId = '';
                await user.save();

                await createAndPersistRetellAgent(user, {
                    customPrompt,
                    voiceId: options?.voiceId
                });

                await bindRetellNumberToAgent({
                    phoneNumber: user.inboundNumber,
                    agentId: user.retellAgentId
                });
            } else {
                throw bindError;
            }
        }

        await syncRetellIntegrationWhenConfigured(user);

        user.provisioningStatus = 'active';
        user.provisioningError = '';
        await user.save();

        return {
            userId: user.id,
            inboundNumber: user.inboundNumber,
            twilioPhoneNumberSid: user.twilioPhoneNumberSid,
            retellAgentId: user.retellAgentId,
            provisioningStatus: user.provisioningStatus
        };
    } catch (error) {
        user.provisioningStatus = 'manual_required';
        user.provisioningError = normalizeProvisioningError(error?.message, 'Retell setup failed');
        await user.save();
        if (isRetellManualInterventionError(error)) {
            return {
                userId: user.id,
                inboundNumber: user.inboundNumber,
                twilioPhoneNumberSid: user.twilioPhoneNumberSid,
                retellAgentId: user.retellAgentId,
                provisioningStatus: user.provisioningStatus
            };
        }
        throw error;
    }
};

const generateRetellPromptForUser = async (userId, options = {}) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const businessName = String(options?.businessName || user.businessName || '').trim();
    const ownerName = String(options?.ownerName || user.username || '').trim();
    const ownerPhone = String(options?.ownerPhone || user.ownerPhone || '').trim();
    const userInstructions = normalizePromptText(options?.userInstructions || options?.customPrompt || '');

    const generated = await generatePromptWithOpenAI({
        businessName,
        ownerName,
        ownerPhone,
        userInstructions
    });

    return {
        prompt: generated.prompt,
        model: generated.model
    };
};

const importWebsiteKnowledgeBaseForUser = async (userId, options = {}) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const requestedWebsiteUrl = normalizeWebsiteUrl(options?.websiteUrl || '');
    if (!requestedWebsiteUrl) {
        return {
            imported: false,
            skipped: true,
            reason: 'empty_website_url'
        };
    }

    try {
        return await importWebsiteKnowledgeBase({
            user,
            websiteUrl: requestedWebsiteUrl
        });
    } catch (error) {
        return {
            imported: false,
            error: normalizeProvisioningError(error?.message || 'Website import failed')
        };
    }
};

const provisionForUser = async (userId, options = {}) => {
    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error('User not found for provisioning');
    }

    user.provisioningStatus = 'in_progress';
    user.provisioningError = '';
    await user.save();

    try {
        const requestedPhoneNumber = String(options?.phoneNumber || '').trim();
        const requestedCountry = normalizeTwilioCountryCode(options?.country || user.countryCode || '');
        const requestedAreaCode = String(options?.areaCode || '').trim();
        const requestedWebsiteUrl = normalizeWebsiteUrl(options?.websiteUrl || '');
        const autoAssign = Boolean(options?.autoAssign);
        const skipRetell = Boolean(options?.skipRetell);
        const forceTwilioPurchase = Boolean(options?.forceTwilioPurchase);
        const sipTrunkConfig = await resolveSipTrunkConfigForImport({
            user,
            phoneNumber: user.inboundNumber
        });

        const twilioAlreadyConfigured = Boolean(user.inboundNumber && user.twilioPhoneNumberSid && !requestedPhoneNumber && !forceTwilioPurchase);
        let twilio = twilioAlreadyConfigured
            ? {
                  skipped: true,
                  reason: 'twilio_already_configured'
              }
            : null;

        if (!twilio) {
            try {
                twilio = await purchaseTwilioNumber({
                    phoneNumber: requestedPhoneNumber || undefined,
                    areaCode: requestedAreaCode || undefined,
                    country: requestedCountry || undefined
                });
            } catch (error) {
                if (autoAssign && !requestedPhoneNumber && isTwilioCountryUnavailableForAutoAssign(error)) {
                    let lastFallbackError = error;
                    const fallbackCountries = getAutoAssignCountryFallbacks(requestedCountry || TWILIO_NUMBER_COUNTRY || 'US');
                    for (const fallbackCountry of fallbackCountries) {
                        if (fallbackCountry === requestedCountry) {
                            continue;
                        }
                        try {
                            twilio = await purchaseTwilioNumber({
                                areaCode: undefined,
                                country: fallbackCountry
                            });
                            break;
                        } catch (fallbackError) {
                            lastFallbackError = fallbackError;
                            if (isTwilioCountryUnavailableForAutoAssign(fallbackError)) {
                                continue;
                            }
                            throw fallbackError;
                        }
                    }
                    if (!twilio) {
                        throw lastFallbackError;
                    }
                } else {
                    throw error;
                }
            }
        }

        if (twilio.phoneNumber) {
            await ensureNumberNotUsedByAnotherBusiness({
                userId: user.id,
                phoneNumber: twilio.phoneNumber
            });
            user.inboundNumber = twilio.phoneNumber;
            user.twilioPhoneNumberSid = twilio.phoneSid;
        }

        const retellAlreadyConfigured = Boolean(user.retellAgentId);
        const retell = skipRetell
            ? {
                  skipped: true,
                  reason: 'retell_skipped'
              }
            : retellAlreadyConfigured
                ? {
                      skipped: true,
                      reason: 'retell_already_configured'
                  }
                : await createRetellAgent({
                      businessName: user.businessName,
                      inboundNumber: user.inboundNumber,
                      ownerPhone: user.ownerPhone,
                      ownerName: user.username,
                      customPrompt: options?.customPrompt,
                      voiceId: options?.voiceId
                  });

        if (retell.retellAgentId) {
            user.retellAgentId = retell.retellAgentId;
        }

        if (!skipRetell && user.retellAgentId && user.inboundNumber) {
            try {
                await bindRetellNumberToAgent({
                    phoneNumber: user.inboundNumber,
                    agentId: user.retellAgentId
                });
            } catch (bindError) {
                if (isRetellPhoneMissingError(bindError)) {
                    const importResult = await importRetellPhoneNumberIfNeeded({
                        phoneNumber: user.inboundNumber,
                        agentId: user.retellAgentId,
                        sipTrunkConfig
                    });

                    if (importResult?.skipped && importResult.reason === 'missing_sip_termination_uri') {
                        throw new Error(
                            `Retell phone number ${user.inboundNumber} was not found. ` +
                            'Set SIP trunk details in this business profile (or RETELL_SIP_TERMINATION_URI in backend .env) to auto-import SIP-trunk numbers, or import manually in Retell dashboard.'
                        );
                    }

                    await bindRetellNumberToAgent({
                        phoneNumber: user.inboundNumber,
                        agentId: user.retellAgentId
                    });
                } else {
                    throw bindError;
                }
            }

            await syncRetellIntegrationWhenConfigured(user);
        }

        if ((twilio.skipped || twilio.phoneNumber) && (retell.skipped || retell.retellAgentId)) {
            user.provisioningStatus = 'active';
        } else {
            user.provisioningStatus = 'manual_required';
        }

        let websiteKnowledgeBase = null;
        if (requestedWebsiteUrl) {
            try {
                websiteKnowledgeBase = await importWebsiteKnowledgeBase({
                    user,
                    websiteUrl: requestedWebsiteUrl
                });
            } catch (websiteError) {
                websiteKnowledgeBase = {
                    imported: false,
                    error: normalizeProvisioningError(websiteError?.message || 'Website import failed')
                };
            }
        }

        await user.save();

        return {
            userId: user.id,
            inboundNumber: user.inboundNumber,
            twilioPhoneNumberSid: user.twilioPhoneNumberSid,
            retellAgentId: user.retellAgentId,
            provisioningStatus: user.provisioningStatus,
            websiteKnowledgeBase
        };
    } catch (error) {
        user.provisioningStatus = 'failed';
        user.provisioningError = normalizeProvisioningError(error?.message, 'Provisioning failed');
        await user.save();
        throw error;
    }
};

module.exports = {
    provisionForUser,
    purchaseTwilioNumber,
    listAvailableNumbersForUser,
    provisionRetellAgentForUser,
    buildRetellToolDefinitions,
    syncRetellIntegrationForUser,
    generateRetellPromptForUser,
    importWebsiteKnowledgeBaseForUser
};
