const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AuditLog = sequelize.define(
    'AuditLog',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        method: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'GET'
        },
        path: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        statusCode: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 200
        },
        durationMs: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        actorEmail: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        ipAddress: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        }
    },
    {
        tableName: 'audit_logs',
        timestamps: true
    }
);

module.exports = AuditLog;
