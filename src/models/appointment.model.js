const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Appointment = sequelize.define(
    'Appointment',
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
        inboundNumber: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        caller: {
            type: DataTypes.STRING,
            allowNull: false
        },
        appointmentDate: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        appointmentTime: {
            type: DataTypes.STRING,
            allowNull: false
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Consultation'
        },
        status: {
            type: DataTypes.ENUM('Confirmed', 'Pending', 'Completed', 'Cancelled', 'NoShow'),
            allowNull: false,
            defaultValue: 'Pending'
        },
        depositStatus: {
            type: DataTypes.ENUM('None', 'Requested', 'Paid', 'Failed', 'Cancelled'),
            allowNull: false,
            defaultValue: 'None'
        },
        depositRequiredAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        },
        depositPaidAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        },
        depositCurrency: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'usd'
        },
        depositCheckoutUrl: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        depositCheckoutSessionId: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        depositRequestedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        depositPaidAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'appointments',
        timestamps: true
    }
);

module.exports = Appointment;
