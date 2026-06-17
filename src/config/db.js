const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const {
    DB_DIALECT,
    DATABASE_URL,
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DB_SSL,
    DB_SSLMODE,
    DB_STORAGE,
    DB_LOGGING,
    DB_SYNC_ALTER,
    ADMIN_USERNAME,
    ADMIN_EMAIL,
    ADMIN_PASSWORD
} = require('./env');

const createSequelizeConfig = () => {
    const logging = DB_LOGGING === 'true' ? console.log : false;

    if (DB_DIALECT === 'sqlite') {
        return {
            dialect: 'sqlite',
            storage: DB_STORAGE,
            logging
        };
    }

    const sslEnabled = DB_SSL === 'true' || String(DB_SSLMODE || '').toLowerCase() === 'require';
    const dialectOptions = sslEnabled
        ? {
              ssl: {
                  require: true,
                  rejectUnauthorized: false
              }
          }
        : {};

    if (DATABASE_URL) {
        return {
            url: DATABASE_URL,
            options: {
                dialect: 'postgres',
                logging,
                dialectOptions
            }
        };
    }

    return {
        dialect: 'postgres',
        host: DB_HOST,
        port: DB_PORT,
        database: DB_NAME,
        username: DB_USER,
        password: DB_PASSWORD,
        logging,
        dialectOptions
    };
};

const sequelizeConfig = createSequelizeConfig();
const sequelize = sequelizeConfig.url
    ? new Sequelize(sequelizeConfig.url, sequelizeConfig.options)
    : new Sequelize(sequelizeConfig);

const ensureDefaultAdmin = async () => {
    const User = require('../models/user.model');
    const adminUser = await User.unscoped().findOne({ where: { role: 'admin' } });

    if (adminUser) {
        return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({
        username: ADMIN_USERNAME,
        email: ADMIN_EMAIL,
        password: passwordHash,
        role: 'admin'
    });

    console.log('Default admin user created from environment settings.');
};

const ensureSchemaColumns = async () => {
    if (DB_DIALECT === 'sqlite') {
        return;
    }

    const queryInterface = sequelize.getQueryInterface();

    const usersTable = await queryInterface.describeTable('users');
    if (!usersTable.stripeCustomerId) {
        await queryInterface.addColumn('users', 'stripeCustomerId', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!usersTable.retellSipTerminationUri) {
        await queryInterface.addColumn('users', 'retellSipTerminationUri', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!usersTable.retellSipTrunkAuthUsername) {
        await queryInterface.addColumn('users', 'retellSipTrunkAuthUsername', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!usersTable.retellSipTrunkAuthPassword) {
        await queryInterface.addColumn('users', 'retellSipTrunkAuthPassword', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!usersTable.receptionistName) {
        await queryInterface.addColumn('users', 'receptionistName', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'Aria'
        });
    }
    if (!usersTable.receptionistVoice) {
        await queryInterface.addColumn('users', 'receptionistVoice', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'Aria'
        });
    }
    if (!usersTable.receptionistCustomGreeting) {
        await queryInterface.addColumn('users', 'receptionistCustomGreeting', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!usersTable.receptionistStatus) {
        await queryInterface.addColumn('users', 'receptionistStatus', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'paused'
        });
    }
    if (!usersTable.receptionistScheduleMode) {
        await queryInterface.addColumn('users', 'receptionistScheduleMode', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'always_on'
        });
    }
    if (!usersTable.receptionistWeeklySchedule) {
        await queryInterface.addColumn('users', 'receptionistWeeklySchedule', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: '[]'
        });
    }
    if (!usersTable.receptionistFaqActiveMap) {
        await queryInterface.addColumn('users', 'receptionistFaqActiveMap', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: '{}'
        });
    }
    if (!usersTable.receptionistBookingRules) {
        await queryInterface.addColumn('users', 'receptionistBookingRules', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: '{}'
        });
    }
    if (!usersTable.resetPasswordTokenHash) {
        await queryInterface.addColumn('users', 'resetPasswordTokenHash', {
            type: Sequelize.STRING,
            allowNull: true,
            defaultValue: null
        });
    }
    if (!usersTable.resetPasswordExpiresAt) {
        await queryInterface.addColumn('users', 'resetPasswordExpiresAt', {
            type: Sequelize.DATE,
            allowNull: true,
            defaultValue: null
        });
    }
    if (!usersTable.countryCode) {
        await queryInterface.addColumn('users', 'countryCode', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }

    const invoicesTable = await queryInterface.describeTable('invoices');
    if (!invoicesTable.paymentReference) {
        await queryInterface.addColumn('invoices', 'paymentReference', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }

    const knowledgeBaseTable = await queryInterface.describeTable('knowledge_base_entries');
    if (!knowledgeBaseTable.userId && !knowledgeBaseTable.user_id) {
        await queryInterface.addColumn('knowledge_base_entries', 'userId', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null
        });
    } else if (!knowledgeBaseTable.userId && knowledgeBaseTable.user_id) {
        await queryInterface.addColumn('knowledge_base_entries', 'userId', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null
        });
        await queryInterface.sequelize.query(
            'UPDATE "knowledge_base_entries" SET "userId" = "user_id" WHERE "userId" IS NULL'
        );
    }

    const appointmentsTable = await queryInterface.describeTable('appointments');
    if (!appointmentsTable.depositStatus) {
        await queryInterface.addColumn('appointments', 'depositStatus', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'None'
        });
    }
    if (!appointmentsTable.depositRequiredAmount) {
        await queryInterface.addColumn('appointments', 'depositRequiredAmount', {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        });
    }
    if (!appointmentsTable.depositPaidAmount) {
        await queryInterface.addColumn('appointments', 'depositPaidAmount', {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        });
    }
    if (!appointmentsTable.depositCurrency) {
        await queryInterface.addColumn('appointments', 'depositCurrency', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'usd'
        });
    }
    if (!appointmentsTable.depositCheckoutUrl) {
        await queryInterface.addColumn('appointments', 'depositCheckoutUrl', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!appointmentsTable.depositCheckoutSessionId) {
        await queryInterface.addColumn('appointments', 'depositCheckoutSessionId', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
    }
    if (!appointmentsTable.depositRequestedAt) {
        await queryInterface.addColumn('appointments', 'depositRequestedAt', {
            type: Sequelize.DATE,
            allowNull: true,
            defaultValue: null
        });
    }
    if (!appointmentsTable.depositPaidAt) {
        await queryInterface.addColumn('appointments', 'depositPaidAt', {
            type: Sequelize.DATE,
            allowNull: true,
            defaultValue: null
        });
    }
};

const connectDB = async () => {
    await sequelize.authenticate();

    if (DB_DIALECT === 'sqlite' && DB_SYNC_ALTER === 'true') {
        const [backupTables] = await sequelize.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup'"
        );

        for (const row of backupTables) {
            await sequelize.query(`DROP TABLE IF EXISTS ${row.name}`);
        }
    }

    await sequelize.sync({ alter: DB_SYNC_ALTER === 'true' });
    await ensureSchemaColumns();
    await ensureDefaultAdmin();
};

module.exports = {
    sequelize,
    connectDB,
    ensureDefaultAdmin
};
