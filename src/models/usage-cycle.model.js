const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const UsageCycle = sequelize.define(
    'UsageCycle',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true
        },
        cycleStart: {
            type: DataTypes.DATE,
            allowNull: false
        },
        cycleEnd: {
            type: DataTypes.DATE,
            allowNull: false
        },
        includedCallsUsed: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        addonCallsBalance: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        addonCallsUsed: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        concurrentCallsActive: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        alert70SentAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        },
        alert100SentAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'usage_cycles',
        timestamps: true
    }
);

module.exports = UsageCycle;
