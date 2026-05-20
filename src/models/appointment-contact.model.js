const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AppointmentContact = sequelize.define(
    'AppointmentContact',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        appointmentId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ''
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
        tableName: 'appointment_contacts',
        timestamps: true
    }
);

module.exports = AppointmentContact;
