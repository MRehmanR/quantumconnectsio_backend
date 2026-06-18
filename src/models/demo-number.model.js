const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const DemoNumber = sequelize.define(
    'DemoNumber',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        phoneNumber: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        providerNumberId: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        provider: {
            type: DataTypes.ENUM('twilio'),
            allowNull: false,
            defaultValue: 'twilio'
        },
        countryCode: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        status: {
            type: DataTypes.ENUM('available', 'assigned', 'expired', 'promoted'),
            allowNull: false,
            defaultValue: 'available'
        },
        assignedToUserId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        },
        assignedAt: {
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
        tableName: 'demo_numbers',
        timestamps: true
    }
);

module.exports = DemoNumber;
