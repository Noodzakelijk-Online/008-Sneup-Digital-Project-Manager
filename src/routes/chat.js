const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const conversationalAI = require('../services/conversationalAI');
const priorityEngine = require('../services/priorityEngine');
const Conversation = require('../models/Conversation');
const { getRequestWorkspaceObjectId, scopeQuery } = require('../services/workspaceScopeService');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');

router.param('memberId', validateObjectIdParam('memberId'));
router.param('conversationId', validateObjectIdParam('conversationId'));

// Send message to Sneup
router.post('/message', requirePermission('chat:write'), async (req, res) => {
  try {
    const { memberId, message, channel, cardId } = req.body;

    if (!memberId || !message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'memberId and message are required'
      });
    }

    if (!/^[a-f\d]{24}$/i.test(String(memberId)) || (cardId && !/^[a-f\d]{24}$/i.test(String(cardId)))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid memberId or cardId'
      });
    }

    if (message.length > 4000) {
      return res.status(413).json({
        success: false,
        error: 'Message is too long'
      });
    }

    // Check for quick query first
    const quickResponse = await conversationalAI.handleQuickQuery(memberId, message, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    
    if (quickResponse) {
      const quickPayload = typeof quickResponse === 'string'
        ? { response: quickResponse, sourceEvidence: [] }
        : quickResponse;

      return res.json({
        success: true,
        response: quickPayload.response,
        sourceEvidence: quickPayload.sourceEvidence || [],
        quick: true
      });
    }

    // Process with full AI
    const result = await conversationalAI.processMessage(
      memberId,
      message,
      channel || 'web_chat',
      cardId,
      { workspaceId: getRequestWorkspaceObjectId(req) }
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
    const limit = clampInteger(req.query.limit, 10, 1, 50);

    const conversations = await Conversation.getRecentForMember(memberId, limit, getRequestWorkspaceObjectId(req));

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
    const conversation = await Conversation.findOne(scopeQuery(req, { _id: req.params.conversationId }))
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
router.post('/conversation/:conversationId/resolve', requirePermission('chat:write'), async (req, res) => {
  try {
    const { resolution } = req.body;
    const conversation = await Conversation.findOne(scopeQuery(req, { _id: req.params.conversationId }));

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
router.post('/conversation/:conversationId/rate', requirePermission('chat:write'), async (req, res) => {
  try {
    const rating = clampInteger(req.body.rating, 0, 1, 5);
    if (rating === 0) {
      return res.status(400).json({
        success: false,
        error: 'rating must be between 1 and 5'
      });
    }
    const conversation = await Conversation.findOne(scopeQuery(req, { _id: req.params.conversationId }));

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
    const priorities = await priorityEngine.getPrioritizedCards(req.params.memberId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

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
    const priority = await priorityEngine.getImmediatePriority(req.params.memberId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

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
    const dailyPriorities = await priorityEngine.getDailyPriorities(req.params.memberId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

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
    const days = clampInteger(req.query.days, 30, 1, 365);
    const stats = await Conversation.getStatistics(days, getRequestWorkspaceObjectId(req));

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
