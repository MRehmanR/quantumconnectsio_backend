const nodemailer = require('nodemailer');
const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM
} = require('../config/env');

let cachedTransport = null;

const getTransport = () => {
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
        const error = new Error('Email service is not configured');
        error.code = 'SMTP_NOT_CONFIGURED';
        throw error;
    }

    if (!cachedTransport) {
        cachedTransport = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE === 'true' || SMTP_SECURE === true,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });
    }

    return cachedTransport;
};

const sendEmail = async ({ to, subject, text, html }) => {
    const transport = getTransport();
    await transport.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html
    });
};

const sendPasswordResetEmail = async ({ to, resetUrl }) => {
    const subject = 'Reset your Quantum Connects password';
    const text = `You requested a password reset. Use the link below to set a new password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827;">
        <h2 style="margin-bottom: 12px;">Reset your Quantum Connects password</h2>
        <p>You requested a password reset. Click the button below to set a new password.</p>
        <p style="margin: 16px 0;">
          <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block;">Reset Password</a>
        </p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `;

    await sendEmail({ to, subject, text, html });
};

module.exports = {
    sendEmail,
    sendPasswordResetEmail
};
