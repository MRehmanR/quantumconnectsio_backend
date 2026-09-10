const { RETELL_API_KEY, RETELL_API_BASE_URL } = require('../config/env');
const request = async (path, options = {}) => {
    if (!RETELL_API_KEY) throw new Error('Voice service is not configured.');
    const response = await fetch(`${String(RETELL_API_BASE_URL).replace(/\/+$/, '')}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Voice service request failed (${response.status}).`);
    return response.json();
};
const safePreviewUrl = value => {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
    catch { return null; }
};
const listVoices = async () => {
    const voices = await request('/list-voices');
    if (!Array.isArray(voices)) throw new Error('Invalid voice catalog response.');
    return voices.filter(voice => voice.voice_id && voice.voice_name).map(voice => ({
        id: voice.voice_id, label: voice.voice_name, gender: voice.gender || '',
        accent: voice.accent || '', provider: voice.provider || '',
        previewUrl: safePreviewUrl(voice.preview_audio_url)
    }));
};
const updateVoice = async ({ agentId, voiceId }) => {
    const voices = await listVoices();
    if (!voices.some(voice => voice.id === voiceId)) throw new Error('Selected voice is not available. Please reload the voice list.');
    return request(`/update-agent/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify({ voice_id: voiceId }) });
};
module.exports = { listVoices, updateVoice };
