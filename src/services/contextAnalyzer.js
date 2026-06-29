const logger = require('../utils/logger');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Comment = require('../models/Comment');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const getRelationshipLimit = () => {
  const configured = Number.parseInt(process.env.RELATIONSHIP_ANALYSIS_LIMIT, 10);
  return Number.isFinite(configured) ? configured : 750;
};

const resolveWorkspaceId = (workspaceId) => normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());

/**
 * Context Analyzer Service
 * Analyzes relationships and patterns across multiple Trello boards
 */

// Analyze card relationships across boards
const analyzeCardRelationships = async (options = {}) => {
  try {
    logger.info('Analyzing card relationships across boards');
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const limit = getRelationshipLimit();
    const populateRelationshipQuery = (query) => query
      .populate('boardId')
      .populate('listId')
      .populate('members')
      .populate('comments');

    let leftCards = [];
    let rightCards = [];

    if (options.cardId) {
      const card = await populateRelationshipQuery(Card.findOne({ _id: options.cardId, workspaceId }));
      if (!card) return [];
      leftCards = [card];
      rightCards = await populateRelationshipQuery(
        Card.find({ workspaceId, closed: false, _id: { $ne: card._id } })
          .sort({ riskLevel: -1, due: 1, lastActivity: -1 })
          .limit(limit)
      );
    } else if (options.boardId) {
      leftCards = await populateRelationshipQuery(
        Card.find({ workspaceId, closed: false, boardId: options.boardId })
          .sort({ riskLevel: -1, due: 1, lastActivity: -1 })
          .limit(limit)
      );
      rightCards = await populateRelationshipQuery(
        Card.find({ workspaceId, closed: false, boardId: { $ne: options.boardId } })
          .sort({ riskLevel: -1, due: 1, lastActivity: -1 })
          .limit(limit)
      );
    } else {
      leftCards = await populateRelationshipQuery(
        Card.find({ workspaceId, closed: false })
          .sort({ riskLevel: -1, due: 1, lastActivity: -1 })
          .limit(limit)
      );
      rightCards = leftCards;
    }
    
    const relationships = [];
    
    for (let i = 0; i < leftCards.length; i++) {
      const card1 = leftCards[i];
      
      for (let j = options.boardId || options.cardId ? 0 : i + 1; j < rightCards.length; j++) {
        const card2 = rightCards[j];
        if (card1._id.toString() === card2._id.toString()) {
          continue;
        }
        
        // Skip cards on same board
        if (card1.boardId._id.toString() === card2.boardId._id.toString()) {
          continue;
        }
        
        // Calculate relationship strength
        let strength = 0;
        const factors = [];
        
        // Shared members
        const sharedMembers = card1.members.filter(m1 => 
          card2.members.some(m2 => m2._id.toString() === m1._id.toString())
        );
        
        if (sharedMembers.length > 0) {
          strength += sharedMembers.length * 0.3;
          factors.push(`Shared members: ${sharedMembers.map(m => m.username).join(', ')}`);
        }
        
        // Similar labels
        const card1Labels = card1.labels.map(l => (l.name || '').toLowerCase()).filter(Boolean);
        const card2Labels = card2.labels.map(l => (l.name || '').toLowerCase()).filter(Boolean);
        const sharedLabels = card1Labels.filter(l => card2Labels.includes(l));
        
        if (sharedLabels.length > 0) {
          strength += sharedLabels.length * 0.2;
          factors.push(`Shared labels: ${sharedLabels.join(', ')}`);
        }
        
        // Similar names
        if (card1.name && card2.name) {
          const name1Words = card1.name.toLowerCase().split(/\W+/).filter(w => w.length > 3);
          const name2Words = card2.name.toLowerCase().split(/\W+/).filter(w => w.length > 3);
          const sharedWords = name1Words.filter(w => name2Words.includes(w));
          
          if (sharedWords.length > 1) {
            strength += sharedWords.length * 0.1;
            factors.push(`Similar names`);
          }
        }
        
        // Record relationship if strong enough
        if (strength >= 0.5) {
          relationships.push({
            card1: {
              id: card1._id,
              name: card1.name,
              boardId: card1.boardId._id,
              boardName: card1.boardId.name
            },
            card2: {
              id: card2._id,
              name: card2.name,
              boardId: card2.boardId._id,
              boardName: card2.boardId.name
            },
            strength,
            factors,
            type: determineRelationshipType(factors)
          });
        }
      }
    }
    
    logger.info(`Found ${relationships.length} cross-board relationships`);
    return relationships;
  } catch (error) {
    logger.error('Failed to analyze card relationships:', error);
    return [];
  }
};

// Determine relationship type
const determineRelationshipType = (factors) => {
  const factorsText = factors.join(' ').toLowerCase();
  
  if (factorsText.includes('depends') || factorsText.includes('blocked')) {
    return 'dependency';
  }
  
  if (factorsText.includes('related') || factorsText.includes('similar')) {
    return 'related_work';
  }
  
  if (factorsText.includes('shared members')) {
    return 'shared_team';
  }
  
  return 'general';
};

// Analyze workflow patterns across boards
const analyzeWorkflowPatterns = async (options = {}) => {
  try {
    logger.info('Analyzing workflow patterns');
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const boards = await Board.find({ workspaceId, closed: false });
    const workflowPatterns = [];
    
    for (const board of boards) {
      const lists = await List.find({ boardId: board._id, workspaceId, closed: false })
        .sort({ position: 1 });
      
      if (lists.length < 3) continue;
      
      const cards = await Card.find({
        workspaceId,
        boardId: board._id,
        'history.1': { $exists: true }
      });
      
      if (cards.length < 5) continue;
      
      // Analyze list transitions
      const transitions = {};
      
      for (const card of cards) {
        for (let i = 0; i < card.history.length - 1; i++) {
          const fromList = card.history[i].listId.toString();
          const toList = card.history[i + 1].listId.toString();
          const key = `${fromList}->${toList}`;
          transitions[key] = (transitions[key] || 0) + 1;
        }
      }
      
      // Get common transitions
      const commonTransitions = Object.entries(transitions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([transition, count]) => {
          const [fromListId, toListId] = transition.split('->');
          const fromList = lists.find(l => l._id.toString() === fromListId);
          const toList = lists.find(l => l._id.toString() === toListId);
          
          return {
            from: fromList ? fromList.name : 'Unknown',
            to: toList ? toList.name : 'Unknown',
            count
          };
        });
      
      // Calculate average cycle time
      let totalCycleTime = 0;
      let cardsWithCompleteCycle = 0;
      
      for (const card of cards) {
        if (card.history.length >= 2) {
          const firstEntry = card.history[0];
          const lastEntry = card.history[card.history.length - 1];
          
          if (firstEntry && lastEntry) {
            const startTime = new Date(firstEntry.enteredAt);
            const endTime = lastEntry.exitedAt ? 
              new Date(lastEntry.exitedAt) : new Date();
            const cycleTimeHours = (endTime - startTime) / (1000 * 60 * 60);
            
            totalCycleTime += cycleTimeHours;
            cardsWithCompleteCycle++;
          }
        }
      }
      
      const averageCycleTime = cardsWithCompleteCycle > 0 ? 
        totalCycleTime / cardsWithCompleteCycle : 0;
      
      workflowPatterns.push({
        boardId: board._id,
        boardName: board.name,
        workflowStages: lists.map(list => ({
          listId: list._id,
          name: list.name,
          averageTimeInList: list.averageTimeInList || 0,
          cardCount: list.cardCount || 0
        })),
        commonTransitions,
        averageCycleTime,
        cardsAnalyzed: cards.length
      });
    }
    
    logger.info(`Analyzed workflow patterns for ${workflowPatterns.length} boards`);
    return workflowPatterns;
  } catch (error) {
    logger.error('Failed to analyze workflow patterns:', error);
    return [];
  }
};

// Analyze team patterns
const analyzeTeamPatterns = async (options = {}) => {
  try {
    logger.info('Analyzing team patterns');
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const members = await Member.find({ workspaceId })
      .populate('boards')
      .populate('assignedCards');
    
    const teamPatterns = [];
    
    for (const member of members) {
      if (!member.assignedCards || member.assignedCards.length < 3) continue;
      
      // Analyze card types
      const cardTypes = {};
      const boardActivity = {};
      
      for (const card of member.assignedCards) {
        const boardId = card.boardId.toString();
        boardActivity[boardId] = (boardActivity[boardId] || 0) + 1;
        
        for (const label of card.labels) {
          if (label.name) {
            const labelName = label.name.toLowerCase();
            cardTypes[labelName] = (cardTypes[labelName] || 0) + 1;
          }
        }
      }
      
      // Get common card types
      const commonCardTypes = Object.entries(cardTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({
          type,
          count,
          percentage: Math.round((count / member.assignedCards.length) * 100)
        }));
      
      // Get board focus
      const boardFocus = Object.entries(boardActivity)
        .sort((a, b) => b[1] - a[1])
        .map(([boardId, count]) => {
          const board = member.boards.find(b => b._id.toString() === boardId);
          return {
            boardId,
            boardName: board ? board.name : 'Unknown',
            cardCount: count,
            percentage: Math.round((count / member.assignedCards.length) * 100)
          };
        });
      
      // Identify specialties
      const specialties = commonCardTypes
        .filter(ct => ct.percentage > 30)
        .map(ct => ct.type);
      
      // Update member's specialties
      member.specialties = specialties;
      await member.save();
      
      teamPatterns.push({
        memberId: member._id,
        username: member.username,
        fullName: member.fullName,
        commonCardTypes,
        boardFocus,
        specialties,
        workloadLevel: member.workloadLevel,
        totalAssignedCards: member.assignedCards.length
      });
    }
    
    logger.info(`Analyzed team patterns for ${teamPatterns.length} members`);
    return teamPatterns;
  } catch (error) {
    logger.error('Failed to analyze team patterns:', error);
    return [];
  }
};

// Get context for a specific card
const getCardContext = async (cardId, options = {}) => {
  try {
    logger.info(`Getting context for card: ${cardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const card = await Card.findOne({ _id: cardId, workspaceId })
      .populate('boardId')
      .populate('listId')
      .populate('members')
      .populate({
        path: 'comments',
        populate: { path: 'memberId' }
      });
    
    if (!card) {
      logger.warn(`Card not found: ${cardId}`);
      return null;
    }
    
    // Get relationships
    const allRelationships = await analyzeCardRelationships({ cardId, workspaceId });
    const relationships = allRelationships.filter(r => 
      r.card1.id.toString() === cardId.toString() || 
      r.card2.id.toString() === cardId.toString()
    );
    
    // Get workflow context
    const lists = await List.find({ boardId: card.boardId._id, workspaceId, closed: false })
      .sort({ position: 1 });
    
    const currentStageIndex = lists.findIndex(l => 
      l._id.toString() === card.listId._id.toString()
    );
    
    const workflowContext = {
      currentStage: {
        id: card.listId._id,
        name: card.listId.name,
        index: currentStageIndex,
        totalStages: lists.length
      },
      previousStage: currentStageIndex > 0 ? {
        id: lists[currentStageIndex - 1]._id,
        name: lists[currentStageIndex - 1].name
      } : null,
      nextStage: currentStageIndex < lists.length - 1 ? {
        id: lists[currentStageIndex + 1]._id,
        name: lists[currentStageIndex + 1].name
      } : null,
      timeInCurrentList: card.timeInCurrentList || 0
    };
    
    // Get team context
    const memberDetails = [];
    for (const member of card.members) {
      const assignedCount = await Card.countDocuments({
        members: member._id,
        workspaceId,
        closed: false
      });
      
      memberDetails.push({
        id: member._id,
        username: member.username,
        fullName: member.fullName,
        workloadLevel: member.workloadLevel,
        assignedCardCount: assignedCount
      });
    }
    
    return {
      card: {
        id: card._id,
        name: card.name,
        description: card.description,
        board: {
          id: card.boardId._id,
          name: card.boardId.name
        },
        list: {
          id: card.listId._id,
          name: card.listId.name
        },
        members: card.members.map(m => ({
          id: m._id,
          username: m.username,
          fullName: m.fullName
        })),
        due: card.due,
        labels: card.labels,
        comments: card.comments.map(c => ({
          id: c._id,
          text: c.text,
          createdAt: c.createdAt,
          member: c.memberId ? {
            id: c.memberId._id,
            username: c.memberId.username
          } : null
        }))
      },
      relationships,
      workflow: workflowContext,
      team: {
        assignedMembers: memberDetails,
        memberCount: memberDetails.length
      },
      riskLevel: card.riskLevel,
      riskFactors: card.riskFactors || []
    };
  } catch (error) {
    logger.error(`Failed to get context for card ${cardId}:`, error);
    return null;
  }
};

// Get context for a specific board
const getBoardContext = async (boardId, options = {}) => {
  try {
    logger.info(`Getting context for board: ${boardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const board = await Board.findOne({ _id: boardId, workspaceId })
      .populate('members');
    
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    const lists = await List.find({ boardId: board._id, workspaceId, closed: false })
      .sort({ position: 1 });
    
    const cards = await Card.find({ boardId: board._id, workspaceId, closed: false });
    
    // Get relationships
    const cardRelationships = await analyzeCardRelationships({ boardId, workspaceId });
    
    return {
      board: {
        id: board._id,
        name: board.name,
        description: board.description,
        url: board.url
      },
      lists: lists.map(list => ({
        id: list._id,
        name: list.name,
        cardCount: list.cardCount || 0,
        averageTimeInList: list.averageTimeInList || 0
      })),
      cardCount: cards.length,
      members: board.members.map(member => ({
        id: member._id,
        username: member.username,
        fullName: member.fullName,
        workloadLevel: member.workloadLevel
      })),
      cardRelationships
    };
  } catch (error) {
    logger.error(`Failed to get context for board ${boardId}:`, error);
    return null;
  }
};

module.exports = {
  analyzeCardRelationships,
  analyzeWorkflowPatterns,
  analyzeTeamPatterns,
  getCardContext,
  getBoardContext
};
