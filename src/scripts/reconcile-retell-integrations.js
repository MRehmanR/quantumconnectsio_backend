const parseReconciliationArgs = (args) => {
    const values = Array.from(args || []);
    const apply = values.includes('--apply');
    const userIdIndex = values.indexOf('--user-id');
    let userId = null;

    if (userIdIndex >= 0) {
        const parsed = Number(values[userIdIndex + 1]);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error('A positive numeric user id must follow --user-id.');
        }
        userId = parsed;
    }

    const supported = new Set(['--apply', '--dry-run', '--user-id']);
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (index === userIdIndex + 1) {
            continue;
        }
        if (!supported.has(value)) {
            throw new Error(`Unknown reconciliation option: ${value}`);
        }
    }

    return {
        apply,
        dryRun: !apply,
        userId
    };
};

const maskIdentifier = (value) => {
    const normalized = String(value || '').trim();
    if (normalized.length <= 6) {
        return normalized ? `${normalized.slice(0, 1)}…${normalized.slice(-1)}` : '';
    }
    return `${normalized.slice(0, 3)}…${normalized.slice(-3)}`;
};

const main = async () => {
    const options = parseReconciliationArgs(process.argv.slice(2));
    const { PUBLIC_API_BASE_URL } = require('../config/env');
    if (options.apply && !String(PUBLIC_API_BASE_URL || '').trim()) {
        throw new Error('PUBLIC_API_BASE_URL is required when --apply is used.');
    }

    const { sequelize, connectDB } = require('../config/db');
    const { User } = require('../models');
    const { syncRetellIntegrationForUser } = require('../services/provisioning.service');

    try {
        await connectDB();
        const where = { role: 'user' };
        if (options.userId) {
            where.id = options.userId;
        }
        const users = await User.findAll({ where, order: [['id', 'ASC']] });
        const provisionedUsers = users.filter((user) => user.inboundNumber && user.retellAgentId);

        for (const user of provisionedUsers) {
            const result = await syncRetellIntegrationForUser(user, {
                dryRun: options.dryRun
            });
            console.log(JSON.stringify({
                userId: String(user.id),
                inboundNumber: maskIdentifier(user.inboundNumber),
                retellAgentId: maskIdentifier(user.retellAgentId),
                mode: options.dryRun ? 'dry-run' : 'applied',
                promptPreserved: result.promptPreserved,
                changes: result.changes
            }));
        }

        if (provisionedUsers.length === 0) {
            console.log(JSON.stringify({ mode: options.dryRun ? 'dry-run' : 'applied', matchedUsers: 0 }));
        }
    } finally {
        await sequelize.close();
    }
};

if (require.main === module) {
    main().catch((error) => {
        console.error(error?.message || 'Retell reconciliation failed.');
        process.exitCode = 1;
    });
}

module.exports = {
    parseReconciliationArgs,
    maskIdentifier,
    main
};
