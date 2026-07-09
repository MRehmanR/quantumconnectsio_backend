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

const escapeHtml = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const sendDemoBookingConfirmationEmail = async ({ to, booking }) => {
    const subject = 'Your Quantum Connects demo is confirmed';
    const text = [
        `Hi ${booking.customerName},`,
        '',
        `Your live demo is confirmed for ${booking.date} at ${booking.time} (${booking.timezone}).`,
        '',
        `Business: ${booking.businessName}`,
        `Industry: ${booking.industry || 'Not provided'}`,
        `Monthly calls: ${booking.callVolume || 'Not provided'}`,
        `Main challenge: ${booking.challenge || 'Not provided'}`,
        '',
        'We will use these details to prepare your demo.',
        '',
        'Quantum Connects'
    ].join('\n');
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55;">
        <h2 style="margin:0 0 12px;">Your Quantum Connects demo is confirmed</h2>
        <p>Hi ${escapeHtml(booking.customerName)},</p>
        <p>Your live demo is confirmed for <strong>${escapeHtml(booking.date)} at ${escapeHtml(booking.time)} (${escapeHtml(booking.timezone)})</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:18px 0;">
          <p><strong>Business:</strong> ${escapeHtml(booking.businessName)}</p>
          <p><strong>Industry:</strong> ${escapeHtml(booking.industry || 'Not provided')}</p>
          <p><strong>Monthly calls:</strong> ${escapeHtml(booking.callVolume || 'Not provided')}</p>
          <p><strong>Main challenge:</strong> ${escapeHtml(booking.challenge || 'Not provided')}</p>
        </div>
        <p>We will use these details to prepare your demo.</p>
      </div>
    `;

    await sendEmail({ to, subject, text, html });
};

const sendDemoBookingNotificationEmail = async ({ to, booking }) => {
    const subject = `New demo booked: ${booking.businessName}`;
    const text = [
        'New demo appointment booked.',
        '',
        `Name: ${booking.customerName}`,
        `Email: ${booking.customerEmail}`,
        `Phone: ${booking.customerPhone || 'Not provided'}`,
        `Business: ${booking.businessName}`,
        `Date/time: ${booking.date} ${booking.time} (${booking.timezone})`,
        '',
        `Industry: ${booking.industry || 'Not provided'}`,
        `Monthly calls: ${booking.callVolume || 'Not provided'}`,
        `Job value: ${booking.jobValue || 'Not provided'}`,
        `Challenge: ${booking.challenge || 'Not provided'}`,
        `Current system: ${booking.currentSystem || 'Not provided'}`,
        `Timeline: ${booking.timeline || 'Not provided'}`,
        '',
        `Business details: ${booking.businessDetails || 'Not provided'}`,
        `Purchase purpose: ${booking.purchasePurpose || 'Not provided'}`
    ].join('\n');
    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55;">
        <h2 style="margin:0 0 12px;">New demo appointment booked</h2>
        <p><strong>${escapeHtml(booking.businessName)}</strong> booked a demo for <strong>${escapeHtml(booking.date)} ${escapeHtml(booking.time)} (${escapeHtml(booking.timezone)})</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:18px 0;">
          <p><strong>Name:</strong> ${escapeHtml(booking.customerName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(booking.customerEmail)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(booking.customerPhone || 'Not provided')}</p>
          <p><strong>Industry:</strong> ${escapeHtml(booking.industry || 'Not provided')}</p>
          <p><strong>Monthly calls:</strong> ${escapeHtml(booking.callVolume || 'Not provided')}</p>
          <p><strong>Average job value:</strong> ${escapeHtml(booking.jobValue || 'Not provided')}</p>
          <p><strong>Challenge:</strong> ${escapeHtml(booking.challenge || 'Not provided')}</p>
          <p><strong>Current system:</strong> ${escapeHtml(booking.currentSystem || 'Not provided')}</p>
          <p><strong>Timeline:</strong> ${escapeHtml(booking.timeline || 'Not provided')}</p>
        </div>
        <p><strong>Business details:</strong><br>${escapeHtml(booking.businessDetails || 'Not provided')}</p>
        <p><strong>Purchase purpose:</strong><br>${escapeHtml(booking.purchasePurpose || 'Not provided')}</p>
      </div>
    `;

    await sendEmail({ to, subject, text, html });
};

module.exports = {
    sendEmail,
    sendPasswordResetEmail,
    sendDemoBookingConfirmationEmail,
    sendDemoBookingNotificationEmail
};
