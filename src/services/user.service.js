const bcrypt = require('bcryptjs');
const User = require('../models/user.model');

const createUser = async (userData) => {
    const passwordHash = await bcrypt.hash(userData.password, 10);
    return User.create({
        username: userData.username,
        email: userData.email,
        password: passwordHash,
        role: userData.role || 'user'
    });
};

const getAllUsers = async () => {
    return User.findAll({ order: [['createdAt', 'DESC']] });
};

const getUserById = async (userId) => {
    return User.findByPk(userId);
};

const updateUser = async (userId, updateData) => {
    const user = await User.unscoped().findByPk(userId);
    if (!user) {
        return null;
    }

    const payload = { ...updateData };
    if (payload.password) {
        payload.password = await bcrypt.hash(payload.password, 10);
    }

    await user.update(payload);
    return User.findByPk(userId);
};

const deleteUser = async (userId) => {
    const user = await User.findByPk(userId);
    if (!user) {
        return 0;
    }

    await user.destroy();
    return 1;
};

module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser
};