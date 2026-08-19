module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('call_logs', 'summary', {
            type: Sequelize.TEXT,
            allowNull: false,
            defaultValue: ''
        });
        await queryInterface.addColumn('call_logs', 'callSuccessful', {
            type: Sequelize.BOOLEAN,
            allowNull: true,
            defaultValue: null
        });
        await queryInterface.addColumn('call_logs', 'disconnectionReason', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: ''
        });
        await queryInterface.addColumn('call_logs', 'endedAt', {
            type: Sequelize.DATE,
            allowNull: true,
            defaultValue: null
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('call_logs', 'endedAt');
        await queryInterface.removeColumn('call_logs', 'disconnectionReason');
        await queryInterface.removeColumn('call_logs', 'callSuccessful');
        await queryInterface.removeColumn('call_logs', 'summary');
    }
};
