const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const trelloSync = require('../services/trelloSync');
const contextAnalyzer = require('../services/contextAnalyzer');
const nlpService = require('../services/nlpService');
const operationsLedgerService = require('../services/operationsLedgerService');
const operatingLedgerAnalyzer = require('../services/operatingLedgerAnalyzer');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const {
  getRequestWorkspaceObjectId,
  scopeQuery
} = require('../services/workspaceScopeService');
const {
  clampInteger,
  requirePermission,
  validateObjectIdParam
} = require('../utils/requestSecurity');

router.param('boardId', validateObjectIdParam('boardId'));
router.param('cardId', validateObjectIdParam('cardId'));

const scopedBoardQuery = (req, boardId) => scopeQuery(req, { _id: boardId });

const requireScopedBoard = async (req) => {
  const board = await Board.findOne(scopedBoardQuery(req, req.params.boardId));
  if (!board) {
    const error = new Error('Board not found');
    error.statusCode = 404;
    throw error;
  }
  return board;
};

const sendScopedError = (res, error, fallbackMessage) => {
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.statusCode ? error.message : fallbackMessage
  });
};

// Get all boards
router.get('/', async (req, res) => {
  try {
    const boards = await Board.find(scopeQuery(req, { closed: false }))
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
    const board = await Board.findOne(scopedBoardQuery(req, req.params.boardId))
      .populate('members');

    if (!board) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }

    const lists = await List.find(scopeQuery(req, { boardId: board._id, closed: false }))
      .sort({ position: 1 });

    const cards = await Card.find(scopeQuery(req, { boardId: board._id, closed: false }))
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
router.post('/:boardId/sync', requirePermission('sync:run'), async (req, res) => {
  try {
    const board = await requireScopedBoard(req);

    await trelloSync.syncBoard(board.trelloId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      message: 'Board synced successfully'
    });
  } catch (error) {
    logger.error('Failed to sync board:', error);
    sendScopedError(res, error, 'Failed to sync board');
  }
});

// Get board operations ledger
const getBoardOperationsLedger = async (req, res) => {
  try {
    await requireScopedBoard(req);
    const ledger = await operationsLedgerService.getBoardLedger(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      ledger
    });
  } catch (error) {
    logger.error('Failed to get board operations ledger:', error);
    sendScopedError(res, error, 'Failed to get board operations ledger');
  }
};

router.get('/:boardId/operations-ledger', getBoardOperationsLedger);
router.get('/:boardId/operating-ledger', getBoardOperationsLedger);

// Get board decision queue
router.get('/:boardId/decision-queue', async (req, res) => {
  try {
    await requireScopedBoard(req);
    const items = await operationsLedgerService.listDecisionQueue({
      boardId: req.params.boardId,
      workspaceId: getRequestWorkspaceObjectId(req),
      status: req.query.status || 'open',
      ownerType: req.query.ownerType,
      limit: clampInteger(req.query.limit, 100, 1, 250)
    });

    res.json({
      success: true,
      count: items.length,
      items
    });
  } catch (error) {
    logger.error('Failed to get board decision queue:', error);
    sendScopedError(res, error, 'Failed to get board decision queue');
  }
});

// Run safe board analysis and persist findings/health snapshots
router.post('/:boardId/analyze', requirePermission('analysis:run'), async (req, res) => {
  try {
    await requireScopedBoard(req);
    const result = await operatingLedgerAnalyzer.analyzeBoard(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req),
      createRecommendations: req.body.createRecommendations !== false,
      recommendationLimit: clampInteger(req.body.recommendationLimit, 25, 0, 100)
    });

    res.json({
      success: true,
      snapshot: result.snapshot,
      findings: result.findings,
      recommendations: result.recommendations
    });
  } catch (error) {
    logger.error('Failed to analyze board:', error);
    sendScopedError(res, error, 'Failed to analyze board');
  }
});

// Get board findings
router.get('/:boardId/findings', async (req, res) => {
  try {
    await requireScopedBoard(req);
    operationsLedgerService.requireDatabase();
    const findings = await CardFinding.find(scopeQuery(req, {
      boardId: req.params.boardId,
      status: req.query.status || 'open'
    }))
      .sort({ severity: -1, signalScore: -1, lastObservedAt: -1 })
      .populate('cardId memberId')
      .limit(clampInteger(req.query.limit, 100, 1, 250));

    res.json({ success: true, count: findings.length, findings });
  } catch (error) {
    logger.error('Failed to get board findings:', error);
    sendScopedError(res, error, 'Failed to get board findings');
  }
});

// Get board health snapshots
router.get('/:boardId/health-snapshots', async (req, res) => {
  try {
    await requireScopedBoard(req);
    operationsLedgerService.requireDatabase();
    const snapshots = await BoardHealthSnapshot.find(scopeQuery(req, { boardId: req.params.boardId }))
      .sort({ generatedAt: -1 })
      .limit(clampInteger(req.query.limit, 10, 1, 50));

    res.json({ success: true, count: snapshots.length, snapshots });
  } catch (error) {
    logger.error('Failed to get board health snapshots:', error);
    sendScopedError(res, error, 'Failed to get board health snapshots');
  }
});

// Get board context
router.get('/:boardId/context', async (req, res) => {
  try {
    await requireScopedBoard(req);
    const context = await contextAnalyzer.getBoardContext(req.params.boardId, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

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
    sendScopedError(res, error, 'Failed to retrieve board context');
  }
});

// Get card details
router.get('/:boardId/cards/:cardId', async (req, res) => {
  try {
    const board = await requireScopedBoard(req);
    const card = await Card.findOne(scopeQuery(req, { _id: req.params.cardId, boardId: board._id }))
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

    const context = await contextAnalyzer.getCardContext(card._id, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });
    const nlpAnalysis = await nlpService.analyzeCardContent(card._id, {
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      card,
      context,
      nlpAnalysis
    });
  } catch (error) {
    logger.error('Failed to get card:', error);
    sendScopedError(res, error, 'Failed to retrieve card');
  }
});

// Get card relationships
router.get('/:boardId/relationships', async (req, res) => {
  try {
    await requireScopedBoard(req);
    const boardRelationships = await contextAnalyzer.analyzeCardRelationships({
      boardId: req.params.boardId,
      workspaceId: getRequestWorkspaceObjectId(req)
    });

    res.json({
      success: true,
      count: boardRelationships.length,
      relationships: boardRelationships
    });
  } catch (error) {
    logger.error('Failed to get relationships:', error);
    sendScopedError(res, error, 'Failed to retrieve relationships');
  }
});

// Get workflow patterns
router.get('/:boardId/workflow', async (req, res) => {
  try {
    await requireScopedBoard(req);
    const allPatterns = await contextAnalyzer.analyzeWorkflowPatterns({
      workspaceId: getRequestWorkspaceObjectId(req)
    });
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
    sendScopedError(res, error, 'Failed to retrieve workflow patterns');
  }
});

module.exports = router;
