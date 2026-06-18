const express = require('express');
const {
    assignDemoNumber,
    promoteDemoNumber,
    getActiveDemoNumber
} = require('../controllers/numbers.controller');
const { authenticate, requireActiveSubscription } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/assign-demo', authenticate, requireActiveSubscription, assignDemoNumber);
router.post('/promote', authenticate, requireActiveSubscription, promoteDemoNumber);
router.get('/active-demo', authenticate, requireActiveSubscription, getActiveDemoNumber);

module.exports = router;
