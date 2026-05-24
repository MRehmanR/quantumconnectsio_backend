module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'resetPasswordTokenHash', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn('users', 'resetPasswordExpiresAt', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'resetPasswordTokenHash');
    await queryInterface.removeColumn('users', 'resetPasswordExpiresAt');
  }
};
