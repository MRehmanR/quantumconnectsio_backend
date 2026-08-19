const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const CallLog = sequelize.define(
    'CallLog',
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
        retellCallId: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            defaultValue: null
        },
        inboundNumber: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        callerNumber: {
            type: DataTypes.STRING,
            allowNull: false
        },
        callTime: {
            type: DataTypes.DATE,
            allowNull: false
        },
        durationSeconds: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 60
        },
        sentiment: {
            type: DataTypes.ENUM('Positive', 'Neutral', 'Negative'),
            allowNull: false,
            defaultValue: 'Neutral'
        },
        status: {
            type: DataTypes.ENUM('Completed', 'Escalated', 'Missed'),
            allowNull: false,
            defaultValue: 'Completed'
        },
        transcript: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        summary: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        callSuccessful: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            defaultValue: null
        },
        disconnectionReason: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        endedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'call_logs',
        timestamps: true
    }
);

module.exports = CallLog;
