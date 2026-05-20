const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const EscalationLog = sequelize.define(
    'EscalationLog',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        },
        callLogId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        },
        reason: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'unspecified'
        },
        ownerPhone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        outcome: {
            type: DataTypes.ENUM('transferred', 'voicemail', 'failed'),
            allowNull: false,
            defaultValue: 'transferred'
        },
        transferredAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        voicemailAudioUrl: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        voicemailTranscript: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        }
    },
    {
        tableName: 'escalation_logs',
        timestamps: true
    }
);

module.exports = EscalationLog;
