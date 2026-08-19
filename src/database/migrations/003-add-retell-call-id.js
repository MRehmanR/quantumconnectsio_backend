module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('call_logs', 'retellCallId', {
            type: Sequelize.STRING,
            allowNull: true,
            unique: true,
            defaultValue: null
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('call_logs', 'retellCallId');
    }
};
