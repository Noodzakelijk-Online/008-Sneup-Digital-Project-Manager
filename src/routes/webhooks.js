const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const trelloSync = require('../services/trelloSync');
const genericWebhookService = require('../services/genericWebhookService');
const { verifyTrelloWebhook } = require('../utils/requestSecurity');

const sendGenericWebhookError = (res, error) => {
  const statusCode = error.statusCode || 500;
  const errorByStatus = {
    400: 'Webhook payload is invalid',
    401: 'Webhook signature is invalid',
    404: 'Webhook endpoint is not configured',
    413: 'Webhook payload is too large'
  };
  res.status(statusCode).json({
    success: false,
    error: errorByStatus[statusCode] || 'Webhook could not be processed'
  });
};

// Trello webhook endpoint
router.post('/trello', verifyTrelloWebhook, async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.action || !event.model || !event.model.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Trello webhook payload'
      });
    }
    
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

router.post('/generic/:accountId', async (req, res) => {
  try {
    const result = await genericWebhookService.ingest({
      accountId: req.params.accountId,
      rawBody: req.rawBody,
      body: req.body,
      signature: req.get('x-sneup-signature')
    });
    res.status(202).json({
      success: true,
      eventId: result.event.id,
      signalId: result.signal.id
    });
  } catch (error) {
    logger.warn('Generic webhook rejected', {
      statusCode: error.statusCode || 500,
      code: error.code || 'processing_failed'
    });
    sendGenericWebhookError(res, error);
  }
});

module.exports = router;
