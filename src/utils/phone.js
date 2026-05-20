const { parsePhoneNumberFromString } = require('libphonenumber-js');

const COUNTRY_FROM_CALLING_CODE = {
    '1': 'US',
    '44': 'GB',
    '92': 'PK',
    '91': 'IN',
    '971': 'AE',
    '61': 'AU',
    '81': 'JP',
    '49': 'DE',
    '33': 'FR',
    '39': 'IT',
    '34': 'ES',
    '966': 'SA',
    '974': 'QA',
    '965': 'KW',
    '968': 'OM',
    '973': 'BH'
};

const toDigits = (value) => String(value || '').replace(/\D/g, '');

const getCountryHintFromE164 = (value) => {
    const raw = String(value || '').trim();
    if (!raw.startsWith('+')) {
        return '';
    }

    const digits = raw.slice(1).replace(/\D/g, '');
    for (let len = 3; len >= 1; len -= 1) {
        const code = digits.slice(0, len);
        if (COUNTRY_FROM_CALLING_CODE[code]) {
            return COUNTRY_FROM_CALLING_CODE[code];
        }
    }

    return '';
};

const normalizePhone = (value, options = {}) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return { ok: true, e164: '', reason: '' };
    }

    const referenceCountry =
        options.defaultCountry ||
        getCountryHintFromE164(options.referenceE164 || '') ||
        '';

    let candidate = raw;
    if (candidate.startsWith('00')) {
        candidate = `+${candidate.slice(2)}`;
    }

    const parseAttempt = (input, country) => {
        try {
            return parsePhoneNumberFromString(input, country || undefined);
        } catch {
            return null;
        }
    };

    let parsed = parseAttempt(candidate, candidate.startsWith('+') ? '' : referenceCountry);

    if (!parsed && !candidate.startsWith('+') && referenceCountry) {
        const digits = toDigits(candidate);
        if (digits.startsWith('0')) {
            parsed = parseAttempt(digits, referenceCountry);
        }
    }

    if (!parsed || !parsed.isValid()) {
        return {
            ok: false,
            e164: '',
            reason: 'Invalid phone number. Use international format like +923001234567.'
        };
    }

    return {
        ok: true,
        e164: parsed.number,
        reason: ''
    };
};

module.exports = {
    normalizePhone,
    getCountryHintFromE164
};
