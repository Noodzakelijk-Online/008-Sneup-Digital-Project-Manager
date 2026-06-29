const logger = require('../utils/logger');
const Card = require('../models/Card');
const Member = require('../models/Member');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

class PriorityEngine {
  // Calculate priority score for a card
  calculatePriorityScore(card) {
    let score = 0;

    // Risk level (0-40 points)
    const riskScores = {
      critical: 40,
      high: 30,
      medium: 20,
      low: 10
    };
    score += riskScores[card.riskLevel] || 10;

    // Due date urgency (0-30 points)
    if (card.due) {
      const daysUntilDue = (card.due - Date.now()) / (1000 * 60 * 60 * 24);
      
      if (daysUntilDue < 0) {
        score += 30; // Overdue
      } else if (daysUntilDue < 1) {
        score += 25; // Due today
      } else if (daysUntilDue < 3) {
        score += 20; // Due within 3 days
      } else if (daysUntilDue < 7) {
        score += 15; // Due within a week
      } else {
        score += 5; // Due later
      }
    }

    // Blocking other cards (0-20 points)
    if (card.metadata && card.metadata.blockingCount) {
      score += Math.min(card.metadata.blockingCount * 5, 20);
    }

    // Time stuck in current list (0-10 points)
    if (card.enteredCurrentListAt) {
      const daysInList = (Date.now() - card.enteredCurrentListAt) / (1000 * 60 * 60 * 24);
      const expectedTime = card.currentList?.averageTimeInList || 2;
      
      if (daysInList > expectedTime * 2) {
        score += 10;
      } else if (daysInList > expectedTime) {
        score += 5;
      }
    }

    return score;
  }

  // Get prioritized cards for a member
  async getPrioritizedCards(memberId, options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const cards = await Card.find({
        members: memberId,
        workspaceId,
        closed: false
      }).populate('currentList');

      // Calculate priority score for each card
      const cardsWithScores = cards.map(card => ({
        card,
        priorityScore: this.calculatePriorityScore(card),
        urgencyLevel: this.getUrgencyLevel(card)
      }));

      // Sort by priority score
      cardsWithScores.sort((a, b) => b.priorityScore - a.priorityScore);

      return {
        urgent: cardsWithScores.filter(c => c.urgencyLevel === 'urgent'),
        high: cardsWithScores.filter(c => c.urgencyLevel === 'high'),
        normal: cardsWithScores.filter(c => c.urgencyLevel === 'normal'),
        low: cardsWithScores.filter(c => c.urgencyLevel === 'low'),
        all: cardsWithScores
      };
    } catch (error) {
      logger.error('Failed to get prioritized cards:', error);
      throw error;
    }
  }

  // Get urgency level for a card
  getUrgencyLevel(card) {
    const score = this.calculatePriorityScore(card);

    if (score >= 70) return 'urgent';
    if (score >= 50) return 'high';
    if (score >= 30) return 'normal';
    return 'low';
  }

  // Get "what to work on right now" recommendation
  async getImmediatePriority(memberId, options = {}) {
    try {
      const prioritized = await this.getPrioritizedCards(memberId, options);

      if (prioritized.all.length === 0) {
        return {
          recommendation: 'no_tasks',
          message: 'You have no active tasks assigned. Great job!',
          card: null
        };
      }

      // Get highest priority card
      const topCard = prioritized.all[0];

      let message = '';
      let reasoning = [];

      if (topCard.card.isOverdue()) {
        message = `🔴 URGENT: Work on "${topCard.card.name}" immediately - it's overdue!`;
        reasoning.push('Card is overdue');
      } else if (topCard.urgencyLevel === 'urgent') {
        message = `🔴 URGENT: Work on "${topCard.card.name}" right now.`;
        
        if (topCard.card.due) {
          const hoursUntilDue = (topCard.card.due - Date.now()) / (1000 * 60 * 60);
          if (hoursUntilDue < 24) {
            reasoning.push(`Due in ${Math.round(hoursUntilDue)} hours`);
          }
        }
        
        if (topCard.card.riskLevel === 'critical') {
          reasoning.push('Critical risk level');
        }
        
        if (topCard.card.metadata?.blockingCount > 0) {
          reasoning.push(`Blocking ${topCard.card.metadata.blockingCount} other cards`);
        }
      } else if (topCard.urgencyLevel === 'high') {
        message = `🟡 HIGH PRIORITY: Focus on "${topCard.card.name}".`;
        
        if (topCard.card.due) {
          const daysUntilDue = (topCard.card.due - Date.now()) / (1000 * 60 * 60 * 24);
          reasoning.push(`Due in ${Math.round(daysUntilDue)} days`);
        }
      } else {
        message = `🟢 Work on "${topCard.card.name}".`;
      }

      return {
        recommendation: 'work_on_card',
        message,
        card: {
          id: topCard.card._id,
          name: topCard.card.name,
          description: topCard.card.description,
          due: topCard.card.due,
          riskLevel: topCard.card.riskLevel,
          priorityScore: topCard.priorityScore,
          urgencyLevel: topCard.urgencyLevel
        },
        reasoning,
        alternativeCards: prioritized.all.slice(1, 4).map(c => ({
          id: c.card._id,
          name: c.card.name,
          urgencyLevel: c.urgencyLevel
        }))
      };
    } catch (error) {
      logger.error('Failed to get immediate priority:', error);
      throw error;
    }
  }

  // Get daily priorities for a member
  async getDailyPriorities(memberId, options = {}) {
    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
      const prioritized = await this.getPrioritizedCards(memberId, { workspaceId });
      const member = await Member.findOne({ _id: memberId, workspaceId });

      const dailyCapacity = this.estimateDailyCapacity(member);

      return {
        member: {
          id: member._id,
          username: member.username,
          workloadLevel: member.workloadLevel
        },
        today: {
          urgent: prioritized.urgent.map(c => this.formatCardForDisplay(c)),
          high: prioritized.high.slice(0, dailyCapacity - prioritized.urgent.length).map(c => this.formatCardForDisplay(c)),
          estimatedCapacity: dailyCapacity,
          totalAssigned: prioritized.all.length
        },
        upcoming: {
          tomorrow: this.getCardsDueTomorrow(prioritized.all),
          thisWeek: this.getCardsDueThisWeek(prioritized.all)
        },
        summary: {
          urgent: prioritized.urgent.length,
          high: prioritized.high.length,
          normal: prioritized.normal.length,
          low: prioritized.low.length,
          total: prioritized.all.length
        }
      };
    } catch (error) {
      logger.error('Failed to get daily priorities:', error);
      throw error;
    }
  }

  // Estimate daily capacity based on member workload
  estimateDailyCapacity(member) {
    switch (member.workloadLevel) {
      case 'light':
        return 5;
      case 'normal':
        return 3;
      case 'heavy':
        return 2;
      case 'overloaded':
        return 1;
      default:
        return 3;
    }
  }

  // Format card for display
  formatCardForDisplay(cardWithScore) {
    return {
      id: cardWithScore.card._id,
      name: cardWithScore.card.name,
      due: cardWithScore.card.due,
      riskLevel: cardWithScore.card.riskLevel,
      urgencyLevel: cardWithScore.urgencyLevel,
      priorityScore: cardWithScore.priorityScore,
      isOverdue: cardWithScore.card.isOverdue()
    };
  }

  // Get cards due tomorrow
  getCardsDueTomorrow(cardsWithScores) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    return cardsWithScores
      .filter(c => c.card.due && c.card.due > today && c.card.due <= tomorrow)
      .map(c => this.formatCardForDisplay(c));
  }

  // Get cards due this week
  getCardsDueThisWeek(cardsWithScores) {
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    return cardsWithScores
      .filter(c => c.card.due && c.card.due > tomorrow && c.card.due <= endOfWeek)
      .map(c => this.formatCardForDisplay(c));
  }

  // Re-prioritize after a card is completed
  async reprioritizeAfterCompletion(memberId, completedCardId) {
    try {
      logger.info(`Re-prioritizing for member ${memberId} after completing card ${completedCardId}`);

      // Get new priorities
      const priorities = await this.getImmediatePriority(memberId);

      return priorities;
    } catch (error) {
      logger.error('Failed to reprioritize:', error);
      throw error;
    }
  }
}

module.exports = new PriorityEngine();
