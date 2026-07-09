const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const User = sequelize.define(
    'User',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true,
                len: [3, 50]
            }
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                isEmail: true
            }
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        role: {
            type: DataTypes.ENUM('user', 'admin'),
            allowNull: false,
            defaultValue: 'user'
        },
        businessName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        inboundNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null
        },
        ownerPhone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        timezone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'UTC'
        },
        countryCode: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        billingAnniversaryDay: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1
        },
        twilioPhoneNumberSid: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        retellAgentId: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        retellSipTerminationUri: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        retellSipTrunkAuthUsername: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        retellSipTrunkAuthPassword: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        provisioningStatus: {
            type: DataTypes.ENUM('pending', 'in_progress', 'active', 'failed', 'manual_required'),
            allowNull: false,
            defaultValue: 'pending'
        },
        provisioningError: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        plan: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Free'
        },
        status: {
            type: DataTypes.ENUM('Active', 'Suspended'),
            allowNull: false,
            defaultValue: 'Active'
        },
        callsUsed: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        referralCode: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            defaultValue: null
        },
        referredByCode: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        referredByMethod: {
            type: DataTypes.ENUM('link', 'code', ''),
            allowNull: false,
            defaultValue: ''
        },
        referralBonusMinutes: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        referralBonusExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        stripeCustomerId: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        receptionistName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Aria'
        },
        receptionistVoice: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Aria'
        },
        receptionistCustomGreeting: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        receptionistStatus: {
            type: DataTypes.ENUM('live', 'paused', 'scheduled'),
            allowNull: false,
            defaultValue: 'paused'
        },
        receptionistScheduleMode: {
            type: DataTypes.ENUM('always_on', 'custom'),
            allowNull: false,
            defaultValue: 'always_on'
        },
        receptionistWeeklySchedule: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: '[]'
        },
        receptionistFaqActiveMap: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: '{}'
        },
        receptionistBookingRules: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: '{}'
        },
        resetPasswordTokenHash: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null
        },
        resetPasswordExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'users',
        timestamps: true,
        defaultScope: {
            attributes: { exclude: ['password'] }
        }
    }
);

module.exports = User;
