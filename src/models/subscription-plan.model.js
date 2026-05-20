const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const SubscriptionPlan = sequelize.define(
    'SubscriptionPlan',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        price: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        callsLimit: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 50
        },
        concurrentLimit: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 5
        }
    },
    {
        tableName: 'subscription_plans',
        timestamps: true
    }
);

module.exports = SubscriptionPlan;
