const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Invoice = sequelize.define(
    'Invoice',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        invoiceNumber: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        amount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        status: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Paid'
        },
        issuedAt: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        planName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Core'
        },
        paymentReference: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        }
    },
    {
        tableName: 'invoices',
        timestamps: true
    }
);

module.exports = Invoice;
