const assert = require('node:assert/strict');
const e = require('../src/config/env');

(async () => {
    if (process.argv.includes('--smtp-only')) {
        for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
            assert.ok(e[key], `Required email configuration is missing: ${key}`);
        }
        const frontend = new URL(e.FRONTEND_APP_URL);
        assert.equal(frontend.origin, 'https://quantumconnects.io', 'Reset links must use the production site');
        assert.equal(frontend.pathname, '/', 'Reset links must use the application root');
        const transport = require('nodemailer').createTransport({
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure: e.SMTP_SECURE === 'true',
            auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 15000
        });
        try {
            await transport.verify();
            console.log('Production SMTP authentication verified (no email sent).');
        } finally {
            transport.close();
        }
        return;
    }
    const base = `http://127.0.0.1:${e.PORT}`;
    let ready = false;
    for (let i = 0; i < 20; i++) {
        try {
            const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
            if (health.ok) { ready = true; break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Backend did not become healthy after restart');
    for (const route of ['forgot-password', 'reset-password']) {
        const response = await fetch(`${base}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 400, `${route} route must reject missing fields`);
        assert.equal((await response.json()).success, false);
    }
    const { sequelize } = require('../src/config/db');
    try {
        const columns = await sequelize.getQueryInterface().describeTable('users');
        assert.ok(columns.resetPasswordTokenHash && columns.resetPasswordExpiresAt, 'Reset columns are missing');
    } finally {
        await sequelize.close();
    }
    console.log('Production health, password reset endpoints, and database columns verified.');
})().catch(error => {
    console.error('Password reset verification failed:', error.code || error.name);
    process.exitCode = 1;
});
