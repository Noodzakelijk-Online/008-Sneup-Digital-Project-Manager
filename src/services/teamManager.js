const logger = require('../utils/logger');
const Board = require('../models/Board');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Intervention = require('../models/Intervention');
const nlpService = require('./nlpService');
const contextAnalyzer = require('./contextAnalyzer');
const operationsLedgerService = require('./operationsLedgerService');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

/**
 * Team Manager Service
 * Autonomous team management, workload balancing, and task assignment
 */

// Analyze team workload and suggest rebalancing
const resolveWorkspaceId = (workspaceId) => normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());

const toMemberId = (memberId) => String(memberId);

const isOverdue = (card, now) => card.due && new Date(card.due) < now && !card.dueComplete;

const isHighRisk = (card) => card.riskLevel === 'high' || card.riskLevel === 'critical';

const normalizeLabelText = (value) => String(value || '').trim().toLowerCase();

const getSpecialtySet = (member) => {
  if (!member || !Array.isArray(member.specialties)) {
    return new Set();
  }

  if (member.__sneupSpecialtySet) {
    return member.__sneupSpecialtySet;
  }

  const values = new Set();
  for (const value of member.specialties) {
    const normalized = normalizeLabelText(value);
    if (normalized) values.add(normalized);
  }

  member.__sneupSpecialtySet = values;
  return values;
};

const labelAwareScore = (member, cardLabels = []) => {
  if (!member?.specialties || member.specialties.length === 0 || cardLabels.length === 0) {
    return 0;
  }

  const memberSpecialties = getSpecialtySet(member);
  return cardLabels.reduce((score, label) => {
    const normalizedLabel = normalizeLabelText(label?.name || label);
    if (!normalizedLabel) return score;

    for (const specialty of memberSpecialties) {
      if (specialty && normalizedLabel.includes(specialty)) {
        return score + 2;
      }
    }
    return score;
  }, 0);
};

const normalizeCardMembers = (card) => (card.members || []).map((member) => toMemberId(member._id || member));

const getBoardMemberAssignments = async (board, workspaceId) => {
  const rows = await Card.aggregate([
    { $match: { boardId: board._id, workspaceId, closed: false } },
    { $unwind: '$members' },
    { $group: { _id: '$members', count: { $sum: 1 } } }
  ]);

  return rows.reduce((acc, row) => {
    acc[toMemberId(row._id)] = {
      count: row.count
    };
    return acc;
  }, {});
};

const analyzeTeamWorkload = async (boardId, options = {}) => {
  try {
    logger.info(`Analyzing team workload for board: ${boardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const board = await Board.findOne({ _id: boardId, workspaceId })
      .populate('members', 'username fullName specialties workloadLevel');
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

    const now = new Date();
    const assignedCards = await Card.find(
      { boardId: board._id, workspaceId, closed: false },
      {
        members: 1,
        due: 1,
        dueComplete: 1,
        riskLevel: 1,
        labels: 1
      }
    ).lean();
    const assignmentByMember = {};
    const lowRiskCandidates = {};

    for (const card of assignedCards) {
      const isCardOverdue = isOverdue(card, now);
      const isCardHighRisk = isHighRisk(card);
      const memberIds = normalizeCardMembers(card);

      if (memberIds.length === 0) continue;

      for (const memberId of memberIds) {
        if (!assignmentByMember[memberId]) {
          assignmentByMember[memberId] = {
            assignedCards: 0,
            overdueCards: 0,
            highRiskCards: 0
          };
        }

        assignmentByMember[memberId].assignedCards += 1;
        assignmentByMember[memberId].overdueCards += isCardOverdue ? 1 : 0;
        assignmentByMember[memberId].highRiskCards += isCardHighRisk ? 1 : 0;

        if (!isCardHighRisk && (card.riskLevel === 'none' || card.riskLevel === 'low')) {
          lowRiskCandidates[memberId] = lowRiskCandidates[memberId] || [];
          if (lowRiskCandidates[memberId].length < 3) {
            lowRiskCandidates[memberId].push(card);
          }
        }
      }
    }

    // Analyze each member
    for (const member of board.members) {
      const key = toMemberId(member._id);
      const assignmentStats = assignmentByMember[key] || {
        assignedCards: 0,
        overdueCards: 0,
        highRiskCards: 0
      };

      // Calculate workload score
      const workloadScore = assignmentStats.assignedCards + (assignmentStats.overdueCards * 2) + (assignmentStats.highRiskCards * 1.5);
      
      const memberAnalysis = {
        memberId: member._id,
        username: member.username,
        fullName: member.fullName,
        assignedCards: assignmentStats.assignedCards,
        overdueCards: assignmentStats.overdueCards,
        highRiskCards: assignmentStats.highRiskCards,
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
        const candidateCards = lowRiskCandidates[toMemberId(overloadedMember.memberId)] || [];
        // Find cards that could be reassigned
        for (const card of candidateCards) {
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
      score += labelAwareScore(member, card.labels || []);
      
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
const autoAssignCards = async (boardId, options = {}) => {
  try {
    logger.info(`Auto-assigning cards for board: ${boardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const board = await Board.findOne({ _id: boardId, workspaceId })
      .populate('members', 'username fullName workloadLevel specialties');
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    const assignmentCounts = await getBoardMemberAssignments(board, workspaceId);

    // Find unassigned cards
    const unassignedCards = await Card.find({
      boardId: board._id,
      workspaceId,
      closed: false,
      $or: [
        { members: { $exists: false } },
        { members: { $size: 0 } }
      ]
    }, {
      _id: 1,
      name: 1,
      labels: 1
    }).lean();
    
    logger.info(`Found ${unassignedCards.length} unassigned cards`);
    
    const assignments = [];
    
    for (const card of unassignedCards) {
      // Get available members
      const availableMembers = [];
      for (const member of board.members) {
        const memberId = toMemberId(member._id);
        availableMembers.push({
          memberId: member._id,
          username: member.username,
          fullName: member.fullName,
          assignedCards: assignmentCounts[memberId]?.count || 0,
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
const executeRecommendation = async (recommendation, options = {}) => {
  try {
    logger.info(`Queuing team recommendation for approval: ${recommendation.type}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    if (recommendation.type === 'reassign') {
      const card = await Card.findOne({ _id: recommendation.cardId, workspaceId });
      if (!card) {
        logger.warn(`Card not found: ${recommendation.cardId}`);
        return { success: false, error: 'Card not found' };
      }
      
      const [fromMember, toMember] = await Member.find({
        _id: { $in: [recommendation.fromMember.id, recommendation.toMember.id] },
        workspaceId
      })
        .then((members) => {
          const byId = new Map();
          members.forEach((member) => byId.set(toMemberId(member._id), member));
          return [
            byId.get(toMemberId(recommendation.fromMember.id)) || null,
            byId.get(toMemberId(recommendation.toMember.id)) || null
          ];
        });

      if (!fromMember) {
        logger.warn(`Member not found: ${recommendation.fromMember.id}`);
        return { success: false, error: 'Member not found' };
      }

      if (!toMember) {
        logger.warn(`Member not found: ${recommendation.toMember.id}`);
        return { success: false, error: 'Member not found' };
      }

      const intervention = new Intervention({
        boardId: card.boardId,
        workspaceId,
        cardId: card._id,
        memberId: fromMember._id,
        type: 'reassign',
        trigger: 'member_overloaded',
        severity: 'medium',
        action: 'Approve workload rebalance',
        message: `Card reassignment from @${fromMember.username} to @${toMember.username} is recommended for workload balancing.`,
        metadata: {
          reason: recommendation.reason,
          fromMemberId: fromMember._id,
          fromMemberTrelloId: fromMember.trelloId,
          toMemberId: toMember._id,
          toMemberTrelloId: toMember.trelloId,
          commentText: `Card reassignment from @${fromMember.username} to @${toMember.username} was approved in Sneup for workload balancing.`,
          source: 'team_recommendation'
        }
      });

      const queuedRecommendation = await operationsLedgerService.createRecommendationFromIntervention(intervention);

      return {
        success: true,
        requiresApproval: true,
        recommendationId: queuedRecommendation._id,
        message: 'Recommendation queued for approval'
      };
    }
    
    return { success: false, error: 'Unknown recommendation type' };
  } catch (error) {
    logger.error('Failed to execute recommendation:', error);
    return { success: false, error: error.message };
  }
};

// Identify at-risk cards and suggest interventions
const identifyAtRiskCards = async (boardId, options = {}) => {
  try {
    logger.info(`Identifying at-risk cards for board: ${boardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    const now = new Date();
    
    const board = await Board.findOne({ _id: boardId, workspaceId });
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    // Get all active cards
    const cards = await Card.find({
      boardId: board._id,
      workspaceId,
      closed: false
    }, {
      name: 1,
      listId: 1,
      members: 1,
      due: 1,
      dueComplete: 1,
      riskLevel: 1,
      timeInCurrentList: 1,
      lastActivity: 1
    }).populate('listId', 'name averageTimeInList')
      .populate('members', 'username')
      .lean();

    const assessCardRisk = (card, averageTimeInList, now = new Date()) => {
      const riskFactors = [];
      let riskScore = 0;

      if (isOverdue(card, now)) {
        riskFactors.push('Overdue');
        riskScore += 3;
      }

      if (card.due) {
        const dueDate = new Date(card.due);
        const nowDate = new Date(now);
        const daysUntilDue = Math.ceil((dueDate - nowDate) / (1000 * 60 * 60 * 24));
        if (daysUntilDue >= 0 && daysUntilDue <= 2) {
          riskFactors.push('Due soon');
          riskScore += 2;
        }
      }

      if (averageTimeInList > 0 && card.timeInCurrentList > (averageTimeInList * 2)) {
        riskFactors.push('Stuck in current list');
        riskScore += 2;
      }

      const daysSinceActivity = (now - new Date(card.lastActivity || now)) / (1000 * 60 * 60 * 24);
      if (daysSinceActivity > 7) {
        riskFactors.push('No recent activity');
        riskScore += 1;
      }

      if (!card.members || card.members.length === 0) {
        riskFactors.push('No members assigned');
        riskScore += 1;
      }

      let riskLevel = 'none';
      if (riskScore >= 6) riskLevel = 'critical';
      else if (riskScore >= 4) riskLevel = 'high';
      else if (riskScore >= 2) riskLevel = 'medium';
      else if (riskScore >= 1) riskLevel = 'low';

      return { riskLevel, riskFactors, riskScore };
    };

    const atRiskCards = [];
    
    for (const card of cards) {
      // Assess risk
      const list = card.listId;
      const averageTimeInList = list ? list.averageTimeInList : 0;
      const riskAssessment = assessCardRisk(card, averageTimeInList, now);
      
      if (riskAssessment.riskLevel === 'high' || riskAssessment.riskLevel === 'critical') {
        // Generate interventions
        const interventions = [];
        
        // Check if stuck
        if (averageTimeInList > 0 && card.timeInCurrentList > (averageTimeInList * 2)) {
          interventions.push({
            type: 'move',
            action: 'Consider moving card forward or breaking it into smaller tasks',
            priority: 'high'
          });
        }
        
        // Check if overdue
        if (isOverdue(card, now)) {
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
        const daysSinceActivity = (now - new Date(card.lastActivity || now)) / (1000 * 60 * 60 * 24);
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
const generateTeamReport = async (boardId, options = {}) => {
  try {
    logger.info(`Generating team report for board: ${boardId}`);
    const workspaceId = resolveWorkspaceId(options.workspaceId);
    
    const board = await Board.findOne({ _id: boardId, workspaceId }).populate('members');
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    // Get workload analysis
    const workloadAnalysis = await analyzeTeamWorkload(boardId, { workspaceId });
    
    // Get at-risk cards
    const atRiskAnalysis = await identifyAtRiskCards(boardId, { workspaceId });
    
    // Get auto-assignment suggestions
    const autoAssignments = await autoAssignCards(boardId, { workspaceId });
    
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
