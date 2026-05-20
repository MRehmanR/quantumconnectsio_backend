const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const FeatureToggleConfig = sequelize.define(
    'FeatureToggleConfig',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        accountKey: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            defaultValue: 'default'
        },
        config: {
            type: DataTypes.JSON,
            allowNull: false
        }
    },
    {
        tableName: 'feature_toggle_configs',
        timestamps: true
    }
);

module.exports = FeatureToggleConfig;
