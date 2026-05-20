const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ReferralBonusAward = sequelize.define(
    'ReferralBonusAward',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        referrerUserId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        referredUserId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        minutesAwarded: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 20
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: false
        }
    },
    {
        tableName: 'referral_bonus_awards',
        timestamps: true
    }
);

module.exports = ReferralBonusAward;
