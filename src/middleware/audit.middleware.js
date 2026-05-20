const { AuditLog } = require('../models');

const auditMiddleware = (req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', async () => {
        try {
            await AuditLog.create({
                method: req.method,
                path: req.originalUrl || req.url,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
                actorEmail: req.user?.email || req.headers['x-actor-email'] || '',
                ipAddress: req.ip || '',
                metadata: {
                    userAgent: req.headers['user-agent'] || '',
                    requestId: req.headers['x-request-id'] || ''
                }
            });
        } catch (_error) {
            // Avoid impacting request flow if audit logging fails.
        }
    });

    next();
};

module.exports = auditMiddleware;
