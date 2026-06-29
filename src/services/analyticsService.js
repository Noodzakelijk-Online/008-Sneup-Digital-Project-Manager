const logger = require('../utils/logger');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Analytics = require('../models/Analytics');
const schedule = require('node-schedule');
const jobObservabilityService = require('./jobObservabilityService');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

/**
 * Analytics Service
 * Generates analytics, detects bottlenecks, and assesses project health
 */

// Initialize analytics generation
const initAnalytics = () => {
  try {
    logger.info('Initializing analytics service...');
    
    // Schedule analytics generation
    const analyticsCron = process.env.ANALYTICS_CRON || '0 * * * *';
    schedule.scheduleJob(analyticsCron, async () => {
      logger.info('Running scheduled analytics generation');
      await jobObservabilityService.trackJob({
        jobName: 'analytics.generate_all',
        jobType: 'analytics',
        triggerType: 'scheduled'
      }, () => generateAllAnalytics());
    });
    
    logger.info('Analytics service initialized');
  } catch (error) {
    logger.error('Failed to initialize analytics service:', error);
    throw error;
  }
};

// Generate analytics for all boards
const generateAllAnalytics = async () => {
  try {
    logger.info('Generating analytics for all boards');
    const workspaceId = getDefaultWorkspaceObjectId();
    
    const boards = await Board.find({ workspaceId, closed: false });
    
    let successCount = 0;
    let failureCount = 0;

    for (const board of boards) {
      try {
        await generateBoardAnalytics(board._id, { workspaceId });
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        logger.error(`Failed to generate analytics for board ${board.name}:`, error);
      }
    }
    
    logger.info('Analytics generation completed');
    return {
      processedCount: boards.length,
      successCount,
      failureCount
    };
  } catch (error) {
    logger.error('Failed to generate all analytics:', error);
    throw error;
  }
};

// Generate analytics for a specific board
const generateBoardAnalytics = async (boardId, options = {}) => {
  try {
    logger.info(`Generating analytics for board: ${boardId}`);
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    const board = await Board.findOne({ _id: boardId, workspaceId });
    if (!board) {
      logger.warn(`Board not found: ${boardId}`);
      return null;
    }
    
    const lists = await List.find({ boardId: board._id, workspaceId, closed: false })
      .sort({ position: 1 });
    
    const cards = await Card.find({ boardId: board._id, workspaceId });
    const activeCards = cards.filter(card => !card.closed);
    
    const members = await Member.find({ boards: board._id, workspaceId });
    
    // Calculate card counts
    const cardCountByList = [];
    for (const list of lists) {
      const count = await Card.countDocuments({ 
        listId: list._id, 
        workspaceId,
        closed: false 
      });
      cardCountByList.push({
        listId: list._id,
        count
      });
    }
    
    // Calculate velocity
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Find completed lists
    const completedLists = lists.filter(list => 
      list.name.toLowerCase().includes('done') || 
      list.name.toLowerCase().includes('complete') ||
      list.name.toLowerCase().includes('finished')
    );
    
    const completedListIds = completedLists.map(list => list._id);
    
    // Count completed cards
    const cardsCompletedLast7Days = await Card.countDocuments({
      boardId: board._id,
      workspaceId,
      listId: { $in: completedListIds },
      'history.enteredAt': { $gte: sevenDaysAgo }
    });
    
    const cardsCompletedLast30Days = await Card.countDocuments({
      boardId: board._id,
      workspaceId,
      listId: { $in: completedListIds },
      'history.enteredAt': { $gte: thirtyDaysAgo }
    });
    
    const cardsPerDay = cardsCompletedLast30Days / 30;
    const cardsPerWeek = cardsCompletedLast7Days;
    
    // Calculate cycle time
    let totalCycleTime = 0;
    let cardCount = 0;
    
    for (const card of cards) {
      if (completedListIds.some(id => id.toString() === card.listId.toString()) && 
          card.history.length > 1) {
        const firstEntry = card.history[0];
        const lastEntry = card.history[card.history.length - 1];
        
        if (firstEntry && lastEntry && lastEntry.enteredAt) {
          const startTime = new Date(firstEntry.enteredAt);
          const endTime = new Date(lastEntry.enteredAt);
          const cycleTimeHours = (endTime - startTime) / (1000 * 60 * 60);
          
          totalCycleTime += cycleTimeHours;
          cardCount++;
        }
      }
    }
    
    const averageCycleTime = cardCount > 0 ? totalCycleTime / cardCount : 0;
    
    // Detect bottlenecks
    const bottlenecks = await detectBottlenecks(board._id, lists, averageCycleTime, { workspaceId });
    
    // Calculate team performance
    const teamPerformance = await calculateTeamPerformance(
      members, 
      completedListIds, 
      thirtyDaysAgo,
      { workspaceId }
    );
    
    // Calculate project health
    const projectHealth = await calculateProjectHealth(
      board._id,
      activeCards,
      bottlenecks,
      teamPerformance
    );
    
    // Create analytics record
    const analytics = new Analytics({
      boardId: board._id,
      workspaceId,
      date: now,
      cardCount: {
        total: activeCards.length,
        byList: cardCountByList
      },
      velocity: {
        cardsPerDay,
        cardsPerWeek,
        pointsPerDay: 0,
        pointsPerWeek: 0
      },
      cycleTime: {
        average: averageCycleTime,
        byCardType: []
      },
      leadTime: {
        average: averageCycleTime,
        byCardType: []
      },
      bottlenecks,
      teamPerformance,
      projectHealth
    });
    
    await analytics.save();
    
    logger.info(`Analytics generated for board: ${board.name}`);
    return analytics;
  } catch (error) {
    logger.error(`Failed to generate analytics for board ${boardId}:`, error);
    throw error;
  }
};

// Detect bottlenecks in workflow
const detectBottlenecks = async (boardId, lists, averageCycleTime, options = {}) => {
  try {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    const bottlenecks = [];
    
    // Skip if no cycle time data
    if (!averageCycleTime || averageCycleTime === 0) {
      return bottlenecks;
    }
    
    const expectedTimePerList = averageCycleTime / lists.length;
    
    for (const list of lists) {
      // Skip completed lists
      if (list.isDoneList()) {
        continue;
      }
      
      // Calculate average time cards spend in this list
      const cards = await Card.find({ 
        boardId, 
        workspaceId,
        'history.listId': list._id 
      });
      
      let totalTimeInList = 0;
      let cardsInList = 0;
      
      for (const card of cards) {
        for (const historyEntry of card.history) {
          if (historyEntry.listId.toString() === list._id.toString()) {
            const enteredAt = new Date(historyEntry.enteredAt);
            const exitedAt = historyEntry.exitedAt ? 
              new Date(historyEntry.exitedAt) : new Date();
            const timeInListHours = (exitedAt - enteredAt) / (1000 * 60 * 60);
            
            totalTimeInList += timeInListHours;
            cardsInList++;
          }
        }
      }
      
      const averageTimeInList = cardsInList > 0 ? 
        totalTimeInList / cardsInList : 0;
      
      // Update list with average time
      list.averageTimeInList = averageTimeInList;
      await list.save();
      
      // Determine if this is a bottleneck
      const multiplier = averageTimeInList / expectedTimePerList;
      
      let severity = null;
      if (multiplier > 3) {
        severity = 'high';
      } else if (multiplier > 2) {
        severity = 'medium';
      }
      
      if (severity) {
        const currentCardCount = await Card.countDocuments({ 
          listId: list._id, 
          workspaceId,
          closed: false 
        });
        
        bottlenecks.push({
          listId: list._id,
          listName: list.name,
          severity,
          averageTimeInList,
          cardCount: currentCardCount,
          trend: 'stable'
        });
      }
    }
    
    logger.info(`Detected ${bottlenecks.length} bottlenecks`);
    return bottlenecks;
  } catch (error) {
    logger.error('Failed to detect bottlenecks:', error);
    return [];
  }
};

// Calculate team performance
const calculateTeamPerformance = async (members, completedListIds, thirtyDaysAgo, options = {}) => {
  try {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    const teamPerformance = {
      overallUtilization: 0,
      memberUtilization: []
    };
    
    for (const member of members) {
      // Count assigned cards
      const assignedCards = await Card.countDocuments({ 
        members: member._id, 
        workspaceId,
        closed: false 
      });
      
      // Count completed cards in last 30 days
      const completedCards = await Card.countDocuments({
        members: member._id,
        workspaceId,
        listId: { $in: completedListIds },
        'history.enteredAt': { $gte: thirtyDaysAgo }
      });
      
      // Calculate utilization (assuming 5 cards is optimal)
      const utilization = Math.min(assignedCards / 5, 1);
      
      // Update member stats
      member.completedCards.last30Days = completedCards;
      
      // Determine workload level
      if (utilization > 0.9) {
        member.workloadLevel = 'overloaded';
      } else if (utilization > 0.7) {
        member.workloadLevel = 'heavy';
      } else if (utilization > 0.3) {
        member.workloadLevel = 'normal';
      } else {
        member.workloadLevel = 'light';
      }
      
      await member.save();
      
      teamPerformance.memberUtilization.push({
        memberId: member._id,
        utilization,
        cardsCompleted: completedCards,
        averageCompletionTime: member.averageCompletionTime || 0
      });
    }
    
    // Calculate overall utilization
    if (teamPerformance.memberUtilization.length > 0) {
      const totalUtilization = teamPerformance.memberUtilization.reduce(
        (sum, member) => sum + member.utilization, 0
      );
      teamPerformance.overallUtilization = 
        totalUtilization / teamPerformance.memberUtilization.length;
    }
    
    return teamPerformance;
  } catch (error) {
    logger.error('Failed to calculate team performance:', error);
    return {
      overallUtilization: 0,
      memberUtilization: []
    };
  }
};

// Calculate project health
const calculateProjectHealth = async (boardId, activeCards, bottlenecks, teamPerformance) => {
  try {
    const now = new Date();
    
    // Count overdue cards
    const overdueCards = activeCards.filter(card => 
      card.due && new Date(card.due) < now && !card.dueComplete
    ).length;
    
    // Calculate on-track percentage
    const onTrackPercentage = activeCards.length > 0 ? 
      ((activeCards.length - overdueCards) / activeCards.length) * 100 : 100;
    
    // Determine overall health
    let overallHealth = 'healthy';
    const riskFactors = [];
    
    if (onTrackPercentage < 70) {
      overallHealth = 'critical';
      riskFactors.push('High percentage of overdue cards');
    } else if (onTrackPercentage < 85) {
      overallHealth = 'at_risk';
      riskFactors.push('Significant percentage of overdue cards');
    }
    
    if (bottlenecks.some(b => b.severity === 'high')) {
      if (overallHealth !== 'critical') overallHealth = 'at_risk';
      riskFactors.push('Severe bottlenecks detected');
    }
    
    if (teamPerformance.overallUtilization > 0.9) {
      if (overallHealth !== 'critical') overallHealth = 'at_risk';
      riskFactors.push('Team overutilization');
    }
    
    return {
      overall: overallHealth,
      riskFactors,
      onTrackPercentage,
      delayedCards: overdueCards,
      blockedCards: 0
    };
  } catch (error) {
    logger.error('Failed to calculate project health:', error);
    return {
      overall: 'healthy',
      riskFactors: [],
      onTrackPercentage: 100,
      delayedCards: 0,
      blockedCards: 0
    };
  }
};

// Get latest analytics for a board
const getLatestAnalytics = async (boardId, options = {}) => {
  try {
    return await Analytics.getLatest(boardId, normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId()));
  } catch (error) {
    logger.error(`Failed to get latest analytics for board ${boardId}:`, error);
    return null;
  }
};

// Get analytics history for a board
const getAnalyticsHistory = async (boardId, days = 30, options = {}) => {
  try {
    return await Analytics.getHistory(boardId, days, normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId()));
  } catch (error) {
    logger.error(`Failed to get analytics history for board ${boardId}:`, error);
    return [];
  }
};

module.exports = {
  initAnalytics,
  generateAllAnalytics,
  generateBoardAnalytics,
  detectBottlenecks,
  getLatestAnalytics,
  getAnalyticsHistory
};
