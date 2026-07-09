const express = require('express');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const dashboardDataRoutes = require('./routes/dashboard-data.routes');
const automationRoutes = require('./routes/automation.routes');
const auditMiddleware = require('./middleware/audit.middleware');
const { connectDB } = require('./config/db');
require('./models');

const app = express();

// Middleware
app.use(
	express.json({
		verify: (req, _res, buf) => {
			if (buf && buf.length > 0) {
				req.rawBody = buf.toString('utf8');
			}
		}
	})
);
app.use(express.urlencoded({ extended: true }));
app.use('/api', auditMiddleware);

// Database connection
connectDB().catch((error) => {
	console.error('Database connection failed:', error);
});

app.get('/api/health', (req, res) => {
	res.status(200).json({ success: true, message: 'Backend is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', dashboardDataRoutes);
app.use('/api/automation', automationRoutes);

module.exports = app;
