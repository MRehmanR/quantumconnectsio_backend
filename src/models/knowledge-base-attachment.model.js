const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KnowledgeBaseAttachment = sequelize.define(
    'KnowledgeBaseAttachment',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        knowledgeBaseEntryId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        fileName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        fileDataUrl: {
            type: DataTypes.TEXT('long'),
            allowNull: false,
            defaultValue: ''
        }
    },
    {
        tableName: 'knowledge_base_attachments',
        timestamps: true
    }
);

module.exports = KnowledgeBaseAttachment;
