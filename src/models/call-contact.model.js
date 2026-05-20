const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const CallContact = sequelize.define(
    'CallContact',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        callLogId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Unknown Caller'
        },
        phone: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
        }
    },
    {
        tableName: 'call_contacts',
        timestamps: true
    }
);

module.exports = CallContact;
