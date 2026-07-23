const logger = require('../utils/logger');
const Performance = require('../models/Performance');
const Member = require('../models/Member');
const Card = require('../models/Card');
const Intervention = require('../models/Intervention');
const Comment = require('../models/Comment');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

class PerformanceTracker {
  recordKey(value) {
    return String(value?._id || value || '');
  }

  isOverdue(card) {
    if (typeof card?.isOverdue === 'function') return card.isOverdue();
    return Boolean(card?.due && !card?.dueComplete && !card?.closed && new Date() > new Date(card.due));
  }

  calculateAverageResponseTimeFromInterventions(interventions = []) {
    const responseTimes = interventions
      .filter(intervention => ['comment', 'follow_up'].includes(intervention?.type)
        && intervention?.response?.respondedAt && intervention?.createdAt)
      .map(intervention => (new Date(intervention.response.respondedAt) - new Date(intervention.createdAt)) / (1000 * 60 * 60))
      .filter(Number.isFinite);

    return responseTimes.length > 0
      ? responseTimes.reduce((sum, responseTime) => sum + responseTime, 0) / responseTimes.length
      : 0;
  }

  calculateTeamAverageFromCards(cards = [], memberKeys, memberCount, startDate, endDate) {
    if (memberCount === 0) {
      return { cardsCompleted: 0, cycleTime: 0, onTimeRate: 0 };
    }

    const completedCards = cards.filter(card =>
      card.closed && card.closedAt >= startDate && card.closedAt <= endDate
    );
    const completedAssignments = completedCards.flatMap(card => (card.members || [])
      .filter(memberId => memberKeys.has(this.recordKey(memberId)))
      .map(() => card));
    const totalCycleTime = completedAssignments.reduce((total, card) => {
      if (!card.createdAt || !card.closedAt) return total;
      return total + (new Date(card.closedAt) - new Date(card.createdAt)) / (1000 * 60 * 60 * 24);
    }, 0);
    const onTimeCards = completedAssignments.filter(card => !card.due || card.closedAt <= card.due).length;
    const cardsWithDueDates = completedAssignments.filter(card => card.due).length;

    return {
      cardsCompleted: completedAssignments.length / memberCount,
      cycleTime: completedAssignments.length > 0 ? totalCycleTime / completedAssignments.length : 0,
      onTimeRate: cardsWithDueDates > 0 ? (onTimeCards / cardsWithDueDates * 100) : 100
    };
  }

  async buildBoardPerformanceContext(boardId, period, workspaceId, members = []) {
    const { startDate, endDate } = this.getPeriodDates(period);
    const memberIds = members.map(member => member._id);
    const memberKeys = new Set(memberIds.map(memberId => this.recordKey(memberId)));
    const membersById = new Map(members.map(member => [this.recordKey(member._id), member]));
    const [cards, interventions] = await Promise.all([
      Card.find({
        boardId,
        workspaceId,
        members: { $in: memberIds },
        createdAt: { $lte: endDate }
      }),
      Intervention.find({
        boardId,
        workspaceId,
        memberId: { $in: memberIds },
        createdAt: { $gte: startDate, $lte: endDate }
      })
    ]);
    const cardIds = cards.map(card => card._id);
    const comments = cardIds.length > 0
      ? await Comment.find({
        workspaceId,
        cardId: { $in: cardIds },
        memberId: { $in: memberIds },
        createdAt: { $gte: startDate, $lte: endDate }
      })
      : [];
    const cardsByMember = new Map(memberIds.map(memberId => [this.recordKey(memberId), []]));
    const interventionsByMember = new Map(memberIds.map(memberId => [this.recordKey(memberId), []]));
    const commentsByMember = new Map(memberIds.map(memberId => [this.recordKey(memberId), []]));

    for (const card of cards) {
      for (const memberId of card.members || []) {
        const key = this.recordKey(memberId);
        if (memberKeys.has(key)) cardsByMember.get(key).push(card);
      }
    }
    for (const intervention of interventions) {
      const key = this.recordKey(intervention.memberId);
      if (memberKeys.has(key)) interventionsByMember.get(key).push(intervention);
    }
    for (const comment of comments) {
      const key = this.recordKey(comment.memberId);
      if (memberKeys.has(key)) commentsByMember.get(key).push(comment);
    }

    return {
      boardId,
      workspaceId,
      startDate,
      endDate,
      membersById,
      cardsByMember,
      interventionsByMember,
      commentsByMember,
      teamAverage: this.calculateTeamAverageFromCards(cards, memberKeys, members.length, startDate, endDate)
    };
  }

  // Calculate performance for a member
  async calculateMemberPerformance(memberId, period = 'weekly', options = {}) {
    try {
      const context = options.context;
      const { startDate, endDate } = context || this.getPeriodDates(period);
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const memberKey = this.recordKey(memberId);
      const member = context?.membersById.get(memberKey)
        || await Member.findOne({ _id: memberId, workspaceId }).populate('boards');
      if (!member) {
        throw new Error('Member not found');
      }
      const boardId = options.boardId || member.boards?.[0]?._id || member.boards?.[0];

      logger.info(`Calculating ${period} performance for member ${member.username}`);

      // Get all cards for this member in the period
      const cards = context?.cardsByMember.get(memberKey) || await Card.find({
        boardId,
        members: memberId,
        workspaceId,
        createdAt: { $lte: endDate }
      });

      // Get completed cards in this period
      const completedCards = cards.filter(card => 
        card.closed && card.closedAt >= startDate && card.closedAt <= endDate
      );

      // Get interventions for this member
      const interventions = context?.interventionsByMember.get(memberKey) || await Intervention.find({
        boardId,
        memberId,
        workspaceId,
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Get comments by this member
      const comments = context?.commentsByMember.get(memberKey) || await Comment.find({
        memberId,
        workspaceId,
        ...(boardId ? { cardId: { $in: cards.map(card => card._id) } } : {}),
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Calculate metrics
      const metrics = {
        cardsAssigned: cards.filter(c => !c.closed).length,
        cardsCompleted: completedCards.length,
        cardsOnTime: completedCards.filter(c => !c.due || c.closedAt <= c.due).length,
        cardsLate: completedCards.filter(c => c.due && c.closedAt > c.due).length,
        cardsOverdue: cards.filter(card => !card.closed && this.isOverdue(card)).length,
        averageCycleTime: this.calculateAverageCycleTime(completedCards),
        interventionsReceived: interventions.length,
        interventionsResponded: interventions.filter(i => i.response && i.response.respondedAt).length,
        interventionsIgnored: interventions.filter(i => !i.response || !i.response.respondedAt).length,
        escalationsReceived: interventions.filter(i => i.escalation && i.escalation.escalated).length,
        commentsPosted: comments.length,
        averageResponseTime: context
          ? this.calculateAverageResponseTimeFromInterventions(interventions)
          : await this.calculateAverageResponseTime(memberId, startDate, endDate, { workspaceId, boardId })
      };

      // Get team averages for comparison
      const teamAverage = context?.teamAverage || await this.calculateTeamAverage(boardId, startDate, endDate, { workspaceId });

      // Create or update performance record
      let performance = await Performance.findOne({
        memberId,
        workspaceId,
        period,
        startDate
      });

      if (!performance) {
        performance = new Performance({
          memberId,
          workspaceId,
          boardId,
          period,
          startDate,
          endDate,
          metrics
        });
      } else {
        performance.metrics = metrics;
      }

      // Set team comparison
      performance.comparison.teamAverage = teamAverage;

      // Calculate derived metrics
      performance.calculate();

      // Check and add flags
      performance.checkAndAddFlags();

      await performance.save();

      if (!options.deferRanking) {
        await this.calculateRankAndPercentile(performance);
        await performance.save();
      }

      logger.info(`Performance calculated for ${member.username}: Score ${performance.calculated.performanceScore}`);

      return performance;
    } catch (error) {
      logger.error('Failed to calculate member performance:', error);
      throw error;
    }
  }

  // Calculate performance for all members on a board
  async calculateBoardPerformance(boardId, period = 'weekly', options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const members = await Member.find({ boards: boardId, workspaceId });
      if (members.length === 0) {
        logger.info(`Calculated performance for 0 members on board ${boardId}`);
        return [];
      }
      const context = await this.buildBoardPerformanceContext(boardId, period, workspaceId, members);
      const performances = [];

      for (const member of members) {
        const performance = await this.calculateMemberPerformance(member._id, period, {
          boardId,
          workspaceId,
          context,
          deferRanking: true
        });
        performances.push(performance);
      }

      await this.recalculateBoardRankings(boardId, period, context.startDate, workspaceId);

      logger.info(`Calculated performance for ${performances.length} members on board ${boardId}`);
      return performances;
    } catch (error) {
      logger.error('Failed to calculate board performance:', error);
      throw error;
    }
  }

  // Calculate average cycle time
  calculateAverageCycleTime(cards) {
    if (cards.length === 0) return 0;

    const cycleTimes = cards
      .filter(c => c.createdAt && c.closedAt)
      .map(c => (c.closedAt - c.createdAt) / (1000 * 60 * 60 * 24));

    return cycleTimes.length > 0
      ? cycleTimes.reduce((sum, time) => sum + time, 0) / cycleTimes.length
      : 0;
  }

  // Calculate average response time to comments/mentions
  async calculateAverageResponseTime(memberId, startDate, endDate, options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const interventions = await Intervention.find({
        memberId,
        workspaceId,
        ...(options.boardId ? { boardId: options.boardId } : {}),
        type: { $in: ['comment', 'follow_up'] },
        'response.respondedAt': { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      return this.calculateAverageResponseTimeFromInterventions(interventions);
    } catch (error) {
      logger.error('Failed to calculate average response time:', error);
      return 0;
    }
  }

  // Calculate team average metrics
  async calculateTeamAverage(boardId, startDate, endDate, options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const members = await Member.find({ boards: boardId, workspaceId });
      
      if (members.length === 0) {
        return { cardsCompleted: 0, cycleTime: 0, onTimeRate: 0 };
      }

      let totalCompleted = 0;
      let totalCycleTime = 0;
      let totalOnTime = 0;
      let totalWithDueDate = 0;

      for (const member of members) {
        const cards = await Card.find({
          boardId,
          members: member._id,
          workspaceId,
          closed: true,
          closedAt: { $gte: startDate, $lte: endDate }
        });

        totalCompleted += cards.length;
        totalCycleTime += this.calculateAverageCycleTime(cards) * cards.length;
        
        const onTimeCards = cards.filter(c => !c.due || c.closedAt <= c.due);
        totalOnTime += onTimeCards.length;
        totalWithDueDate += cards.filter(c => c.due).length;
      }

      return {
        cardsCompleted: totalCompleted / members.length,
        cycleTime: totalCompleted > 0 ? totalCycleTime / totalCompleted : 0,
        onTimeRate: totalWithDueDate > 0 ? (totalOnTime / totalWithDueDate * 100) : 100
      };
    } catch (error) {
      logger.error('Failed to calculate team average:', error);
      return { cardsCompleted: 0, cycleTime: 0, onTimeRate: 0 };
    }
  }

  // Calculate rank and percentile
  async calculateRankAndPercentile(performance) {
    try {
      const allPerformances = await Performance.find({
        workspaceId: performance.workspaceId,
        boardId: performance.boardId,
        period: performance.period,
        startDate: performance.startDate
      }).sort({ 'calculated.performanceScore': -1 });

      const rank = allPerformances.findIndex(p => 
        p._id.toString() === performance._id.toString()
      ) + 1;

      const percentile = Math.round((1 - (rank - 1) / allPerformances.length) * 100);

      performance.comparison.rank = rank;
      performance.comparison.totalMembers = allPerformances.length;
      performance.comparison.percentile = percentile;
    } catch (error) {
      logger.error('Failed to calculate rank and percentile:', error);
    }
  }

  async recalculateBoardRankings(boardId, period, startDate, workspaceId) {
    const performances = await Performance.find({
      workspaceId,
      boardId,
      period,
      startDate
    }).sort({ 'calculated.performanceScore': -1 });
    const totalMembers = performances.length;

    for (let index = 0; index < performances.length; index += 1) {
      const performance = performances[index];
      performance.comparison.rank = index + 1;
      performance.comparison.totalMembers = totalMembers;
      performance.comparison.percentile = Math.round((1 - index / totalMembers) * 100);
      await performance.save();
    }
  }

  // Get period dates
  getPeriodDates(period) {
    const now = new Date();
    let startDate, endDate;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      
      case 'weekly':
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;
      
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    return { startDate, endDate };
  }

  // Generate performance report for a member
  async generateMemberReport(memberId, period = 'weekly', options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const performance = await Performance.getLatest(memberId, period, workspaceId);
      
      if (!performance) {
        throw new Error('No performance data found');
      }

      const history = await Performance.getHistory(memberId, period, 12, workspaceId);
      
      return {
        current: performance.generateSummary(),
        history: history.map(p => ({
          period: `${p.startDate.toISOString().split('T')[0]} to ${p.endDate.toISOString().split('T')[0]}`,
          score: p.calculated.performanceScore,
          grade: p.calculated.performanceGrade,
          cardsCompleted: p.metrics.cardsCompleted,
          onTimeRate: p.calculated.onTimeDeliveryRate
        })),
        trends: this.calculateTrends(history),
        recommendations: this.generateRecommendations(performance)
      };
    } catch (error) {
      logger.error('Failed to generate member report:', error);
      throw error;
    }
  }

  // Calculate performance trends
  calculateTrends(history) {
    if (history.length < 2) {
      return { insufficient_data: true };
    }

    const recent = history[0];
    const previous = history[1];

    return {
      performanceScore: {
        current: recent.calculated.performanceScore,
        previous: previous.calculated.performanceScore,
        change: (recent.calculated.performanceScore - previous.calculated.performanceScore).toFixed(1),
        trend: recent.calculated.performanceScore > previous.calculated.performanceScore ? 'improving' : 'declining'
      },
      cardsCompleted: {
        current: recent.metrics.cardsCompleted,
        previous: previous.metrics.cardsCompleted,
        change: recent.metrics.cardsCompleted - previous.metrics.cardsCompleted,
        trend: recent.metrics.cardsCompleted > previous.metrics.cardsCompleted ? 'increasing' : 'decreasing'
      },
      onTimeRate: {
        current: recent.calculated.onTimeDeliveryRate,
        previous: previous.calculated.onTimeDeliveryRate,
        change: (recent.calculated.onTimeDeliveryRate - previous.calculated.onTimeDeliveryRate).toFixed(1),
        trend: recent.calculated.onTimeDeliveryRate > previous.calculated.onTimeDeliveryRate ? 'improving' : 'declining'
      }
    };
  }

  // Generate recommendations based on performance
  generateRecommendations(performance) {
    const recommendations = [];

    // Low completion rate
    if (parseFloat(performance.calculated.completionRate) < 70) {
      recommendations.push({
        type: 'improvement',
        priority: 'high',
        message: 'Focus on completing assigned tasks. Consider breaking down large tasks into smaller, manageable pieces.'
      });
    }

    // Low on-time delivery
    if (parseFloat(performance.calculated.onTimeDeliveryRate) < 70) {
      recommendations.push({
        type: 'improvement',
        priority: 'high',
        message: 'Improve time management. Set realistic deadlines and communicate early if delays are expected.'
      });
    }

    // Low response rate
    if (parseFloat(performance.calculated.responseRate) < 70) {
      recommendations.push({
        type: 'improvement',
        priority: 'medium',
        message: 'Respond promptly to comments and follow-ups. Good communication is essential for team success.'
      });
    }

    // Overloaded
    if (performance.calculated.workloadLevel === 'overloaded') {
      recommendations.push({
        type: 'action',
        priority: 'high',
        message: 'You appear overloaded. Consider requesting workload rebalancing or delegating tasks.'
      });
    }

    // High performer
    if (parseFloat(performance.calculated.performanceScore) >= 90) {
      recommendations.push({
        type: 'recognition',
        priority: 'low',
        message: 'Excellent performance! Consider mentoring team members or taking on more challenging tasks.'
      });
    }

    // No recommendations
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'status',
        priority: 'low',
        message: 'You\'re performing well. Keep up the good work!'
      });
    }

    return recommendations;
  }

  // Generate "who's not pulling weight" report
  async generateAccountabilityReport(boardId, period = 'weekly', options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const performances = await Performance.getTeamPerformance(boardId, period, workspaceId);
      
      const underperformers = performances.filter(p => 
        parseFloat(p.calculated.performanceScore) < 60
      );

      const nonResponsive = performances.filter(p =>
        parseFloat(p.calculated.responseRate) < 50
      );

      const consistentlyLate = performances.filter(p =>
        parseFloat(p.calculated.onTimeDeliveryRate) < 70
      );

      return {
        summary: {
          totalMembers: performances.length,
          underperformers: underperformers.length,
          nonResponsive: nonResponsive.length,
          consistentlyLate: consistentlyLate.length
        },
        underperformers: underperformers.map(p => ({
          member: p.memberId,
          performanceScore: p.calculated.performanceScore,
          grade: p.calculated.performanceGrade,
          cardsCompleted: p.metrics.cardsCompleted,
          issues: p.flags.map(f => f.description)
        })),
        nonResponsive: nonResponsive.map(p => ({
          member: p.memberId,
          responseRate: p.calculated.responseRate,
          interventionsIgnored: p.metrics.interventionsIgnored,
          escalationsReceived: p.metrics.escalationsReceived
        })),
        consistentlyLate: consistentlyLate.map(p => ({
          member: p.memberId,
          onTimeRate: p.calculated.onTimeDeliveryRate,
          cardsLate: p.metrics.cardsLate,
          cardsOverdue: p.metrics.cardsOverdue
        }))
      };
    } catch (error) {
      logger.error('Failed to generate accountability report:', error);
      throw error;
    }
  }
}

const performanceTracker = new PerformanceTracker();

module.exports = performanceTracker;
module.exports.PerformanceTracker = PerformanceTracker;
