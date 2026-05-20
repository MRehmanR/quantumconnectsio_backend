const { sequelize, connectDB } = require('../config/db');
require('../models');

const initializeDatabase = async () => {
    try {
        await connectDB();
        console.log('Connection to the database has been established successfully.');
        console.log('Database and tables are initialized successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
};

initializeDatabase();