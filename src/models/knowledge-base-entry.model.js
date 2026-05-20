const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KnowledgeBaseEntry = sequelize.define(
    'KnowledgeBaseEntry',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        title: {
            type: DataTypes.STRING,
            allowNull: false
        },
        content: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        category: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'General'
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        }
    },
    {
        tableName: 'knowledge_base_entries',
        timestamps: true
    }
);

module.exports = KnowledgeBaseEntry;
