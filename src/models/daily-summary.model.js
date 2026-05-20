const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const DailySummary = sequelize.define(
    'DailySummary',
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
        tenantEmail: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        summaryDate: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        totalCalls: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        bookings: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        cancellations: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        escalations: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        noShows: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        kbQueries: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        source: {
            type: DataTypes.ENUM('manual', 'scheduled'),
            allowNull: false,
            defaultValue: 'manual'
        },
        generatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'daily_summaries',
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['tenantEmail', 'summaryDate']
            }
        ]
    }
);

module.exports = DailySummary;