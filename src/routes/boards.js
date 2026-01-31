const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const trelloSync = require('../services/trelloSync');
const contextAnalyzer = require('../services/contextAnalyzer');
const nlpService = require('../services/nlpService');

// Get all boards
router.get('/', async (req, res) => {
  try {
    const boards = await Board.find({ closed: false })
      .populate('members')
      .sort({ name: 1 });
    
    res.json({
      success: true,
      count: boards.length,
      boards
    });
  } catch (error) {
    logger.error('Failed to get boards:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve boards'
    });
  }
});

// Get a specific board
router.get('/:boardId', async (req, res) => {
  try {
    const board = await Board.findById(req.params.boardId)
      .populate('members');
    
    if (!board) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    // Get lists and cards
    const lists = await List.find({ boardId: board._id, closed: false })
      .sort({ position: 1 });
    
    const cards = await Card.find({ boardId: board._id, closed: false })
      .populate('members');
    
    res.json({
      success: true,
      board,
      lists,
      cards
    });
  } catch (error) {
    logger.error('Failed to get board:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve board'
    });
  }
});

// Sync a specific board
router.post('/:boardId/sync', async (req, res) => {
  try {
    const board = await Board.findById(req.params.boardId);
    
    if (!board) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    await trelloSync.syncBoard(board.trelloId);
    
    res.json({
      success: true,
      message: 'Board synced successfully'
    });
  } catch (error) {
    logger.error('Failed to sync board:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync board'
    });
  }
});

// Get board context
router.get('/:boardId/context', async (req, res) => {
  try {
    const context = await contextAnalyzer.getBoardContext(req.params.boardId);
    
    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }
    
    res.json({
      success: true,
      context
    });
  } catch (error) {
    logger.error('Failed to get board context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve board context'
    });
  }
});

// Get card details
router.get('/:boardId/cards/:cardId', async (req, res) => {
  try {
    const card = await Card.findById(req.params.cardId)
      .populate('boardId')
      .populate('listId')
      .populate('members')
      .populate({
        path: 'comments',
        populate: { path: 'memberId' }
      });
    
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }
    
    // Get card context
    const context = await contextAnalyzer.getCardContext(card._id);
    
    // Get NLP analysis
    const nlpAnalysis = await nlpService.analyzeCardContent(card._id);
    
    res.json({
      success: true,
      card,
      context,
      nlpAnalysis
    });
  } catch (error) {
    logger.error('Failed to get card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve card'
    });
  }
});

// Get card relationships
router.get('/:boardId/relationships', async (req, res) => {
  try {
    const relationships = await contextAnalyzer.analyzeCardRelationships();
    
    // Filter to this board
    const boardRelationships = relationships.filter(r => 
      r.card1.boardId.toString() === req.params.boardId || 
      r.card2.boardId.toString() === req.params.boardId
    );
    
    res.json({
      success: true,
      count: boardRelationships.length,
      relationships: boardRelationships
    });
  } catch (error) {
    logger.error('Failed to get relationships:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve relationships'
    });
  }
});

// Get workflow patterns
router.get('/:boardId/workflow', async (req, res) => {
  try {
    const allPatterns = await contextAnalyzer.analyzeWorkflowPatterns();
    
    // Filter to this board
    const boardPattern = allPatterns.find(p => 
      p.boardId.toString() === req.params.boardId
    );
    
    if (!boardPattern) {
      return res.status(404).json({
        success: false,
        error: 'Workflow patterns not found'
      });
    }
    
    res.json({
      success: true,
      workflow: boardPattern
    });
  } catch (error) {
    logger.error('Failed to get workflow patterns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve workflow patterns'
    });
  }
});

module.exports = router;
