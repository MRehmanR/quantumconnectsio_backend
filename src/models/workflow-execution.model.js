const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const WorkflowExecution = sequelize.define(
    'WorkflowExecution',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        workflowKey: {
            type: DataTypes.STRING,
            allowNull: false
        },
        executionId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        status: {
            type: DataTypes.ENUM('running', 'success', 'error'),
            allowNull: false,
            defaultValue: 'running'
        },
        tenantEmail: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        finishedAt: {
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
        tableName: 'workflow_executions',
        timestamps: true
    }
);

module.exports = WorkflowExecution;
