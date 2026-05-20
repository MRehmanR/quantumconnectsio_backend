const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KbQueryLog = sequelize.define(
    'KbQueryLog',
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
        queryText: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        answerText: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ''
        },
        confidence: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        },
        escalated: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {}
        }
    },
    {
        tableName: 'kb_query_logs',
        timestamps: true
    }
);

module.exports = KbQueryLog;
