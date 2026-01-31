const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const conversationalAI = require('../services/conversationalAI');
const priorityEngine = require('../services/priorityEngine');
const Conversation = require('../models/Conversation');

// Send message to Sneup
router.post('/message', async (req, res) => {
  try {
    const { memberId, message, channel, cardId } = req.body;

    if (!memberId || !message) {
      return res.status(400).json({
        success: false,
        error: 'memberId and message are required'
      });
    }

    // Check for quick query first
    const quickResponse = await conversationalAI.handleQuickQuery(memberId, message);
    
    if (quickResponse) {
      return res.json({
        success: true,
        response: quickResponse,
        quick: true
      });
    }

    // Process with full AI
    const result = await conversationalAI.processMessage(
      memberId,
      message,
      channel || 'web_chat',
      cardId
    );

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Failed to process chat message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process message'
    });
  }
});

// Get conversation history
router.get('/conversations/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const conversations = await Conversation.getRecentForMember(memberId, limit);

    res.json({
      success: true,
      count: conversations.length,
      conversations
    });
  } catch (error) {
    logger.error('Failed to get conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversations'
    });
  }
});

// Get specific conversation
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId)
      .populate('memberId boardId cardId');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      conversation
    });
  } catch (error) {
    logger.error('Failed to get conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversation'
    });
  }
});

// Mark conversation as resolved
router.post('/conversation/:conversationId/resolve', async (req, res) => {
  try {
    const { resolution } = req.body;
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    await conversation.markResolved(resolution);

    res.json({
      success: true,
      message: 'Conversation marked as resolved',
      conversation
    });
  } catch (error) {
    logger.error('Failed to resolve conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve conversation'
    });
  }
});

// Rate conversation
router.post('/conversation/:conversationId/rate', async (req, res) => {
  try {
    const { rating } = req.body;
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    await conversation.setSatisfactionRating(rating);

    res.json({
      success: true,
      message: 'Rating recorded',
      conversation
    });
  } catch (error) {
    logger.error('Failed to rate conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record rating'
    });
  }
});

// Get priorities for a member
router.get('/priorities/:memberId', async (req, res) => {
  try {
    const priorities = await priorityEngine.getPrioritizedCards(req.params.memberId);

    res.json({
      success: true,
      priorities
    });
  } catch (error) {
    logger.error('Failed to get priorities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve priorities'
    });
  }
});

// Get immediate priority (what to work on right now)
router.get('/priorities/:memberId/immediate', async (req, res) => {
  try {
    const priority = await priorityEngine.getImmediatePriority(req.params.memberId);

    res.json({
      success: true,
      ...priority
    });
  } catch (error) {
    logger.error('Failed to get immediate priority:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve immediate priority'
    });
  }
});

// Get daily priorities
router.get('/priorities/:memberId/daily', async (req, res) => {
  try {
    const dailyPriorities = await priorityEngine.getDailyPriorities(req.params.memberId);

    res.json({
      success: true,
      ...dailyPriorities
    });
  } catch (error) {
    logger.error('Failed to get daily priorities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve daily priorities'
    });
  }
});

// Get conversation statistics
router.get('/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = await Conversation.getStatistics(days);

    res.json({
      success: true,
      period: `Last ${days} days`,
      stats
    });
  } catch (error) {
    logger.error('Failed to get conversation stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics'
    });
  }
});

module.exports = router;
