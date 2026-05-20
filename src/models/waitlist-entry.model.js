const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const WaitlistEntry = sequelize.define(
    'WaitlistEntry',
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
        appointmentType: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Consultation'
        },
        preferredDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            defaultValue: null
        },
        preferredTimeWindow: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        customerName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        customerPhone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        customerEmail: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        status: {
            type: DataTypes.ENUM('pending', 'notified', 'accepted', 'expired', 'skipped'),
            allowNull: false,
            defaultValue: 'pending'
        },
        priorityIndex: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        notifiedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        }
    },
    {
        tableName: 'waitlist_entries',
        timestamps: true
    }
);

module.exports = WaitlistEntry;
