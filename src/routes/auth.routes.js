const express = require('express');
const {
    login,
    register,
    provisionBusinessNumber,
    getAvailableBusinessNumbers,
    provisionRetellVoiceAgent,
    generateRetellPrompt,
    importWebsiteKnowledgeBase
} = require('../controllers/auth.controller');
const { authenticate, requireActiveSubscription } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.post('/signup', register);
router.get('/available-numbers', authenticate, requireActiveSubscription, getAvailableBusinessNumbers);
router.post('/import-website-knowledge', authenticate, requireActiveSubscription, importWebsiteKnowledgeBase);
router.post('/provision-number', authenticate, requireActiveSubscription, provisionBusinessNumber);
router.post('/provision-retell-agent', authenticate, requireActiveSubscription, provisionRetellVoiceAgent);
router.post('/generate-retell-prompt', authenticate, requireActiveSubscription, generateRetellPrompt);

module.exports = router;
