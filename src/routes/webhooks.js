const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const trelloSync = require('../services/trelloSync');

// Trello webhook endpoint
router.post('/trello', async (req, res) => {
  try {
    const event = req.body;
    
    logger.info('Received Trello webhook event');
    
    // Handle the webhook event asynchronously
    trelloSync.handleWebhookEvent(event).catch(error => {
      logger.error('Failed to handle webhook event:', error);
    });
    
    // Respond immediately to Trello
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook'
    });
  }
});

// Webhook verification (Trello sends HEAD request to verify)
router.head('/trello', (req, res) => {
  res.status(200).send('OK');
});

module.exports = router;
