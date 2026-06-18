const normalizeCountryCode = (value, fallback = '') => {
    const raw = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (!raw) {
        return String(fallback || '').trim().toUpperCase();
    }

    const aliases = {
        UK: 'GB',
        UNITEDKINGDOM: 'GB',
        GREATBRITAIN: 'GB',
        BRITAIN: 'GB',
        ENGLAND: 'GB',
        SCOTLAND: 'GB',
        WALES: 'GB',
        NORTHERNIRELAND: 'GB',
        UAE: 'AE',
        UNITEDARABEMIRATES: 'AE',
        USA: 'US',
        UNITEDSTATES: 'US',
        UNITEDSTATESOFAMERICA: 'US'
    };

    return aliases[raw] || raw;
};

const resolveCountryFromPayload = (payload = {}) =>
    normalizeCountryCode(
        payload.countryCode ||
        payload.country ||
        payload.region ||
        payload.locationCountry ||
        payload.geoCountry ||
        payload.geoLocation?.countryCode ||
        payload.geoLocation?.country ||
        ''
    );

module.exports = {
    normalizeCountryCode,
    resolveCountryFromPayload
};
