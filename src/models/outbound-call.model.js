const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const OutboundCall = sequelize.define(
    'OutboundCall',
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
        relatedAppointmentId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        },
        callType: {
            type: DataTypes.ENUM('reminder', 'waitlist', 'no_show_followup', 'custom'),
            allowNull: false,
            defaultValue: 'custom'
        },
        toPhone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        scheduledAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        completedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        outcome: {
            type: DataTypes.ENUM('confirmed', 'cancelled', 'rescheduled', 'no_answer', 'failed'),
            allowNull: false,
            defaultValue: 'no_answer'
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        }
    },
    {
        tableName: 'outbound_calls',
        timestamps: true
    }
);

module.exports = OutboundCall;
