const fs = require('node:fs');
const path = require('node:path');

// This payload is encrypted in GitHub Actions and passed through SSH as an env var.
if (process.env.PASSWORD_RESET_ENV) {
    const settings = JSON.parse(process.env.PASSWORD_RESET_ENV);
    const allowed = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'FRONTEND_APP_URL'];
    for (const key of Object.keys(settings)) {
        if (!allowed.includes(key) || /[\r\n"]/.test(String(settings[key]))) {
            throw new Error('Invalid password reset configuration');
        }
    }
    const envPath = path.join(__dirname, '../.env');
    const original = fs.readFileSync(envPath, 'utf8');
    const remaining = original.split(/\r?\n/).filter(line => !Object.keys(settings).some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
    const updated = [...remaining, ...Object.entries(settings).map(([key, value]) => `${key}="${value}"`), ''].join('\n');
    if (updated !== original) {
        fs.writeFileSync(`${envPath}.pre-password-reset-${Date.now()}`, original, { mode: 0o600 });
        fs.writeFileSync(envPath, updated, { mode: 0o600 });
        fs.chmodSync(envPath, 0o600);
    }
    console.log('Password reset email and frontend configuration applied.');
}
