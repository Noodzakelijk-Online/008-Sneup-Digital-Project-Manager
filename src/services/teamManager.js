const logger = require('../utils/logger');
const Board = require('../models/Board');
const Card = require('../models/Card');
const Member = require('../models/Member');
const trelloClient = require('./trelloClient');
const nlpService = require('./nlpService');
const contextAnalyzer = require('./contextAnalyzer');

/**
 * Team Manager Service
 * Autonomous team management, workload balancing, and task assignment
 */

// Analyze team workload and suggest rebalancing
const analyzeTeamWorkload = async (boardId) => {
  try {
    logger.info(`Analyzing team workload for board: ${boardId}`);
    
    const board = await Board.findById(boardId).populate('members');
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    const workloadAnalysis = {
      boardId: board._id,
      boardName: board.name,
      members: [],
      overloadedMembers: [],
      underutilizedMembers: [],
      recommendations: []
    };
    
    // Analyze each member
    for (const member of board.members) {
      const assignedCards = await Card.find({
        boardId: board._id,
        members: member._id,
        closed: false
      });
      
      const overdueCards = assignedCards.filter(card => 
        card.due && new Date(card.due) < new Date() && !card.dueComplete
      ).length;
      
      const highRiskCards = assignedCards.filter(card => 
        card.riskLevel === 'high' || card.riskLevel === 'critical'
      ).length;
      
      // Calculate workload score
      const workloadScore = assignedCards.length + (overdueCards * 2) + (highRiskCards * 1.5);
      
      const memberAnalysis = {
        memberId: member._id,
        username: member.username,
        fullName: member.fullName,
        assignedCards: assignedCards.length,
        overdueCards,
        highRiskCards,
        workloadScore,
        workloadLevel: member.workloadLevel,
        specialties: member.specialties || []
      };
      
      workloadAnalysis.members.push(memberAnalysis);
      
      if (member.workloadLevel === 'overloaded') {
        workloadAnalysis.overloadedMembers.push(memberAnalysis);
      } else if (member.workloadLevel === 'light') {
        workloadAnalysis.underutilizedMembers.push(memberAnalysis);
      }
    }
    
    // Generate recommendations
    if (workloadAnalysis.overloadedMembers.length > 0 && 
        workloadAnalysis.underutilizedMembers.length > 0) {
      for (const overloadedMember of workloadAnalysis.overloadedMembers) {
        // Find cards that could be reassigned
        const cards = await Card.find({
          boardId: board._id,
          members: overloadedMember.memberId,
          closed: false,
          riskLevel: { $in: ['none', 'low'] }
        }).limit(3);
        
        for (const card of cards) {
          // Find best available member
          const bestMember = await findBestMemberForCard(
            card,
            workloadAnalysis.underutilizedMembers
          );
          
          if (bestMember) {
            workloadAnalysis.recommendations.push({
              type: 'reassign',
              cardId: card._id,
              cardName: card.name,
              fromMember: {
                id: overloadedMember.memberId,
                username: overloadedMember.username
              },
              toMember: {
                id: bestMember.memberId,
                username: bestMember.username
              },
              reason: `Rebalance workload: ${overloadedMember.username} is overloaded (${overloadedMember.assignedCards} cards), ${bestMember.username} has capacity (${bestMember.assignedCards} cards)`
            });
          }
        }
      }
    }
    
    logger.info(`Workload analysis completed for board: ${board.name}`);
    return workloadAnalysis;
  } catch (error) {
    logger.error(`Failed to analyze team workload for board ${boardId}:`, error);
    return null;
  }
};

// Find best member for a card
const findBestMemberForCard = async (card, availableMembers) => {
  try {
    if (!availableMembers || availableMembers.length === 0) {
      return null;
    }
    
    // Score each member
    const memberScores = [];
    
    for (const member of availableMembers) {
      let score = 0;
      
      // Prefer members with lighter workload
      if (member.workloadLevel === 'light') {
        score += 3;
      } else if (member.workloadLevel === 'normal') {
        score += 1;
      }
      
      // Match specialties with card labels
      if (member.specialties && member.specialties.length > 0) {
        for (const specialty of member.specialties) {
          for (const label of card.labels) {
            if (label.name && label.name.toLowerCase().includes(specialty.toLowerCase())) {
              score += 2;
            }
          }
        }
      }
      
      memberScores.push({
        member,
        score
      });
    }
    
    // Sort by score descending
    memberScores.sort((a, b) => b.score - a.score);
    
    return memberScores.length > 0 ? memberScores[0].member : null;
  } catch (error) {
    logger.error('Failed to find best member for card:', error);
    return null;
  }
};

// Automatically assign unassigned cards
const autoAssignCards = async (boardId) => {
  try {
    logger.info(`Auto-assigning cards for board: ${boardId}`);
    
    const board = await Board.findById(boardId).populate('members');
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    // Find unassigned cards
    const unassignedCards = await Card.find({
      boardId: board._id,
      closed: false,
      $or: [
        { members: { $exists: false } },
        { members: { $size: 0 } }
      ]
    });
    
    logger.info(`Found ${unassignedCards.length} unassigned cards`);
    
    const assignments = [];
    
    for (const card of unassignedCards) {
      // Get available members
      const availableMembers = [];
      for (const member of board.members) {
        const assignedCount = await Card.countDocuments({
          boardId: board._id,
          members: member._id,
          closed: false
        });
        
        availableMembers.push({
          memberId: member._id,
          username: member.username,
          fullName: member.fullName,
          assignedCards: assignedCount,
          workloadLevel: member.workloadLevel,
          specialties: member.specialties || []
        });
      }
      
      // Filter to only available members
      const lightMembers = availableMembers.filter(m => 
        m.workloadLevel === 'light' || m.workloadLevel === 'normal'
      );
      
      if (lightMembers.length === 0) {
        logger.warn(`No available members for card: ${card.name}`);
        continue;
      }
      
      // Find best member
      const bestMember = await findBestMemberForCard(card, lightMembers);
      
      if (bestMember) {
        assignments.push({
          cardId: card._id,
          cardName: card.name,
          assignedTo: {
            id: bestMember.memberId,
            username: bestMember.username
          },
          reason: `Auto-assigned based on workload and specialties`
        });
      }
    }
    
    logger.info(`Generated ${assignments.length} auto-assignment recommendations`);
    return {
      boardId: board._id,
      boardName: board.name,
      unassignedCount: unassignedCards.length,
      assignments
    };
  } catch (error) {
    logger.error(`Failed to auto-assign cards for board ${boardId}:`, error);
    return null;
  }
};

// Execute team management recommendation
const executeRecommendation = async (recommendation) => {
  try {
    logger.info(`Executing recommendation: ${recommendation.type}`);
    
    if (recommendation.type === 'reassign') {
      const card = await Card.findById(recommendation.cardId);
      if (!card) {
        logger.warn(`Card not found: ${recommendation.cardId}`);
        return { success: false, error: 'Card not found' };
      }
      
      // Remove old member
      card.members = card.members.filter(m => 
        m.toString() !== recommendation.fromMember.id.toString()
      );
      
      // Add new member
      const newMember = await Member.findById(recommendation.toMember.id);
      if (!newMember) {
        logger.warn(`Member not found: ${recommendation.toMember.id}`);
        return { success: false, error: 'Member not found' };
      }
      
      card.members.push(newMember._id);
      await card.save();
      
      // Update in Trello
      try {
        await trelloClient.cardApi.removeMember(
          card.trelloId,
          recommendation.fromMember.id
        );
        
        await trelloClient.cardApi.addMember(
          card.trelloId,
          newMember.trelloId
        );
        
        // Add comment explaining the change
        const comment = `Card reassigned from @${recommendation.fromMember.username} to @${recommendation.toMember.username} by Sneup for workload balancing.`;
        await trelloClient.cardApi.addComment(card.trelloId, comment);
        
        logger.info(`Successfully reassigned card: ${card.name}`);
        return { success: true };
      } catch (trelloError) {
        logger.error('Failed to update Trello:', trelloError);
        return { success: false, error: 'Failed to update Trello' };
      }
    }
    
    return { success: false, error: 'Unknown recommendation type' };
  } catch (error) {
    logger.error('Failed to execute recommendation:', error);
    return { success: false, error: error.message };
  }
};

// Identify at-risk cards and suggest interventions
const identifyAtRiskCards = async (boardId) => {
  try {
    logger.info(`Identifying at-risk cards for board: ${boardId}`);
    
    const board = await Board.findById(boardId);
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    // Get all active cards
    const cards = await Card.find({
      boardId: board._id,
      closed: false
    }).populate('listId').populate('members');
    
    const atRiskCards = [];
    
    for (const card of cards) {
      // Assess risk
      const list = await card.listId;
      const averageTimeInList = list ? list.averageTimeInList : 0;
      const riskAssessment = card.assessRisk(averageTimeInList);
      
      if (riskAssessment.riskLevel === 'high' || riskAssessment.riskLevel === 'critical') {
        // Generate interventions
        const interventions = [];
        
        // Check if stuck
        if (card.isStuck(averageTimeInList)) {
          interventions.push({
            type: 'move',
            action: 'Consider moving card forward or breaking it into smaller tasks',
            priority: 'high'
          });
        }
        
        // Check if overdue
        if (card.isOverdue()) {
          interventions.push({
            type: 'escalate',
            action: 'Card is overdue - escalate to team lead or reassign',
            priority: 'critical'
          });
        }
        
        // Check if no members
        if (!card.members || card.members.length === 0) {
          interventions.push({
            type: 'assign',
            action: 'Assign a team member to this card',
            priority: 'high'
          });
        }
        
        // Check if no recent activity
        const daysSinceActivity = (Date.now() - new Date(card.lastActivity)) / (1000 * 60 * 60 * 24);
        if (daysSinceActivity > 7) {
          interventions.push({
            type: 'follow_up',
            action: 'No activity in 7+ days - follow up with assigned members',
            priority: 'medium'
          });
        }
        
        atRiskCards.push({
          cardId: card._id,
          cardName: card.name,
          listName: list ? list.name : 'Unknown',
          riskLevel: riskAssessment.riskLevel,
          riskFactors: riskAssessment.riskFactors,
          riskScore: riskAssessment.riskScore,
          assignedMembers: card.members.map(m => ({
            id: m._id,
            username: m.username
          })),
          interventions
        });
      }
    }
    
    // Sort by risk score descending
    atRiskCards.sort((a, b) => b.riskScore - a.riskScore);
    
    logger.info(`Found ${atRiskCards.length} at-risk cards`);
    return {
      boardId: board._id,
      boardName: board.name,
      atRiskCards
    };
  } catch (error) {
    logger.error(`Failed to identify at-risk cards for board ${boardId}:`, error);
    return null;
  }
};

// Generate daily team report
const generateTeamReport = async (boardId) => {
  try {
    logger.info(`Generating team report for board: ${boardId}`);
    
    const board = await Board.findById(boardId).populate('members');
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    // Get workload analysis
    const workloadAnalysis = await analyzeTeamWorkload(boardId);
    
    // Get at-risk cards
    const atRiskAnalysis = await identifyAtRiskCards(boardId);
    
    // Get auto-assignment suggestions
    const autoAssignments = await autoAssignCards(boardId);
    
    const report = {
      boardId: board._id,
      boardName: board.name,
      generatedAt: new Date(),
      summary: {
        totalMembers: board.members.length,
        overloadedMembers: workloadAnalysis ? workloadAnalysis.overloadedMembers.length : 0,
        underutilizedMembers: workloadAnalysis ? workloadAnalysis.underutilizedMembers.length : 0,
        atRiskCards: atRiskAnalysis ? atRiskAnalysis.atRiskCards.length : 0,
        unassignedCards: autoAssignments ? autoAssignments.unassignedCount : 0
      },
      workloadAnalysis,
      atRiskAnalysis,
      autoAssignments
    };
    
    logger.info(`Team report generated for board: ${board.name}`);
    return report;
  } catch (error) {
    logger.error(`Failed to generate team report for board ${boardId}:`, error);
    return null;
  }
};

module.exports = {
  analyzeTeamWorkload,
  autoAssignCards,
  executeRecommendation,
  identifyAtRiskCards,
  generateTeamReport
};
