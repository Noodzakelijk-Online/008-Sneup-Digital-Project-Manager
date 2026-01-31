const logger = require('../utils/logger');
const Performance = require('../models/Performance');
const Member = require('../models/Member');
const Card = require('../models/Card');
const Intervention = require('../models/Intervention');
const Comment = require('../models/Comment');

class PerformanceTracker {
  // Calculate performance for a member
  async calculateMemberPerformance(memberId, period = 'weekly') {
    try {
      const { startDate, endDate } = this.getPeriodDates(period);
      
      const member = await Member.findById(memberId).populate('boardId');
      if (!member) {
        throw new Error('Member not found');
      }

      logger.info(`Calculating ${period} performance for member ${member.username}`);

      // Get all cards for this member in the period
      const cards = await Card.find({
        members: memberId,
        createdAt: { $lte: endDate }
      });

      // Get completed cards in this period
      const completedCards = cards.filter(card => 
        card.closed && card.closedAt >= startDate && card.closedAt <= endDate
      );

      // Get interventions for this member
      const interventions = await Intervention.find({
        memberId,
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Get comments by this member
      const comments = await Comment.find({
        memberId,
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Calculate metrics
      const metrics = {
        cardsAssigned: cards.filter(c => !c.closed).length,
        cardsCompleted: completedCards.length,
        cardsOnTime: completedCards.filter(c => !c.due || c.closedAt <= c.due).length,
        cardsLate: completedCards.filter(c => c.due && c.closedAt > c.due).length,
        cardsOverdue: cards.filter(c => !c.closed && c.isOverdue()).length,
        averageCycleTime: this.calculateAverageCycleTime(completedCards),
        interventionsReceived: interventions.length,
        interventionsResponded: interventions.filter(i => i.response && i.response.respondedAt).length,
        interventionsIgnored: interventions.filter(i => !i.response || !i.response.respondedAt).length,
        escalationsReceived: interventions.filter(i => i.escalation && i.escalation.escalated).length,
        commentsPosted: comments.length,
        averageResponseTime: await this.calculateAverageResponseTime(memberId, startDate, endDate)
      };

      // Get team averages for comparison
      const teamAverage = await this.calculateTeamAverage(member.boardId, startDate, endDate);

      // Create or update performance record
      let performance = await Performance.findOne({
        memberId,
        period,
        startDate
      });

      if (!performance) {
        performance = new Performance({
          memberId,
          boardId: member.boardId,
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

      // Calculate percentile and rank
      await this.calculateRankAndPercentile(performance);

      await performance.save();

      logger.info(`Performance calculated for ${member.username}: Score ${performance.calculated.performanceScore}`);

      return performance;
    } catch (error) {
      logger.error('Failed to calculate member performance:', error);
      throw error;
    }
  }

  // Calculate performance for all members on a board
  async calculateBoardPerformance(boardId, period = 'weekly') {
    try {
      const members = await Member.find({ boardId });
      const performances = [];

      for (const member of members) {
        const performance = await this.calculateMemberPerformance(member._id, period);
        performances.push(performance);
      }

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
  async calculateAverageResponseTime(memberId, startDate, endDate) {
    try {
      const interventions = await Intervention.find({
        memberId,
        type: { $in: ['comment', 'follow_up'] },
        'response.respondedAt': { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      if (interventions.length === 0) return 0;

      const responseTimes = interventions.map(i => 
        (i.response.respondedAt - i.createdAt) / (1000 * 60 * 60) // hours
      );

      return responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    } catch (error) {
      logger.error('Failed to calculate average response time:', error);
      return 0;
    }
  }

  // Calculate team average metrics
  async calculateTeamAverage(boardId, startDate, endDate) {
    try {
      const members = await Member.find({ boardId });
      
      if (members.length === 0) {
        return { cardsCompleted: 0, cycleTime: 0, onTimeRate: 0 };
      }

      let totalCompleted = 0;
      let totalCycleTime = 0;
      let totalOnTime = 0;
      let totalWithDueDate = 0;

      for (const member of members) {
        const cards = await Card.find({
          members: member._id,
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
  async generateMemberReport(memberId, period = 'weekly') {
    try {
      const performance = await Performance.getLatest(memberId, period);
      
      if (!performance) {
        throw new Error('No performance data found');
      }

      const history = await Performance.getHistory(memberId, period, 12);
      
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
  async generateAccountabilityReport(boardId, period = 'weekly') {
    try {
      const performances = await Performance.getTeamPerformance(boardId, period);
      
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

module.exports = new PerformanceTracker();
