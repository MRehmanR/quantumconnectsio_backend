const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AutomationEvent = sequelize.define(
    'AutomationEvent',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        source: {
            type: DataTypes.ENUM('retell', 'n8n', 'system'),
            allowNull: false,
            defaultValue: 'system'
        },
        eventType: {
            type: DataTypes.STRING,
            allowNull: false
        },
        idempotencyKey: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        tenantEmail: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: ''
        },
        occurredAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        payload: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        },
        status: {
            type: DataTypes.ENUM('received', 'processed', 'failed', 'duplicate'),
            allowNull: false,
            defaultValue: 'received'
        },
        processedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        errorMessage: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        }
    },
    {
        tableName: 'automation_events',
        timestamps: true
    }
);

module.exports = AutomationEvent;
