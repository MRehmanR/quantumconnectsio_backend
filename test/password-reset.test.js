const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-password-reset-'));
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = path.join(testDirectory, 'password-reset.sqlite');
process.env.DB_LOGGING = 'false';
process.env.FRONTEND_APP_URL = 'https://app.quantumconnects.test/';
process.env.SMTP_HOST = 'smtp.gmail.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'sender@example.test';
process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
process.env.SMTP_FROM = 'sender@example.test';

let capturedResetEmail = null;
const emailModulePath = require.resolve('../src/utils/email');
require.cache[emailModulePath] = {
    id: emailModulePath,
    filename: emailModulePath,
    loaded: true,
    exports: {
        sendPasswordResetEmail: async (payload) => {
            capturedResetEmail = payload;
        }
    }
};

const { sequelize } = require('../src/config/db');
const { User } = require('../src/models');
const authService = require('../src/services/auth.service');

test.before(async () => {
    await sequelize.sync({ force: true });
});

test.after(async () => {
    await sequelize.close();
    fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('password reset uses the configured site and the new password works once', async () => {
    await User.create({
        username: 'reset-user',
        email: 'reset.user@example.com',
        password: 'old-password-123',
        businessName: 'Reset User Business',
        ownerPhone: '+447700900011',
        timezone: 'UTC',
        countryCode: 'GB'
    });

    const result = await authService.requestPasswordReset('Reset.User@example.com', {
        frontendBaseUrl: 'https://untrusted.example'
    });

    assert.deepEqual(result, { sent: true, delivery: 'email' });
    assert.ok(capturedResetEmail);
    assert.equal(capturedResetEmail.to, 'reset.user@example.com');

    const resetUrl = new URL(capturedResetEmail.resetUrl);
    const token = resetUrl.searchParams.get('token');
    const email = resetUrl.searchParams.get('email');

    assert.equal(resetUrl.origin, 'https://app.quantumconnects.test');
    assert.equal(resetUrl.pathname, '/reset-password');
    assert.equal(email, 'reset.user@example.com');
    assert.ok(token);
    assert.equal(token.length, 64);

    await authService.resetPassword({
        email: 'Reset.User@example.com',
        token,
        password: 'new-password-123'
    });

    const updatedUser = await User.unscoped().findOne({ where: { email: 'reset.user@example.com' } });
    assert.ok(updatedUser);
    assert.equal(updatedUser.resetPasswordTokenHash, null);
    assert.equal(updatedUser.resetPasswordExpiresAt, null);
    const login = await authService.login(email, 'new-password-123');
    assert.equal(login.user.email, email);
    await assert.rejects(authService.login(email, 'old-password-123'), /Invalid credentials/);
    await assert.rejects(authService.resetPassword({ email, token, password: 'another-password' }), /Invalid or expired/);
});

test('expired reset links cannot change the password', async () => {
    await User.create({username: 'expired-user', email: 'expired@example.com', password: await require('bcryptjs').hash('unchanged-password', 10), businessName: 'Expiry Test', ownerPhone: '+447700900012', timezone: 'UTC', countryCode: 'GB'});
    await authService.requestPasswordReset('expired@example.com');
    const link = new URL(capturedResetEmail.resetUrl);
    await User.update({ resetPasswordExpiresAt: new Date(Date.now() - 1000) }, { where: { email: 'expired@example.com' } });
    await assert.rejects(authService.resetPassword({email: 'expired@example.com', token: link.searchParams.get('token'), password: 'expired-password'}), /Invalid or expired/);
    assert.ok(await authService.login('expired@example.com', 'unchanged-password'));
});
