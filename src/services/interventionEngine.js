const logger = require('../utils/logger');
const Intervention = require('../models/Intervention');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Board = require('../models/Board');
const trelloClient = require('./trelloClient');

class InterventionEngine {
  constructor() {
    this.interventionRules = this.defineInterventionRules();
  }

  // Define intervention rules and thresholds
  defineInterventionRules() {
    return {
      card_stuck: {
        threshold: 2, // 2x expected time
        severity: 'high',
        actions: ['comment', 'follow_up', 'escalate']
      },
      no_activity: {
        threshold: 5, // 5 days
        severity: 'medium',
        actions: ['comment', 'follow_up']
      },
      overdue: {
        threshold: 0, // immediate
        severity: 'high',
        actions: ['comment', 'escalate']
      },
      member_overloaded: {
        threshold: 1.5, // 1.5x team average
        severity: 'medium',
        actions: ['reassign', 'comment']
      },
      blocking_others: {
        threshold: 2, // blocking 2+ cards
        severity: 'critical',
        actions: ['comment', 'escalate']
      },
      no_response_to_followup: {
        threshold: 24, // 24 hours
        severity: 'high',
        actions: ['escalate']
      }
    };
  }

  // Main intervention detection and execution
  async processInterventions(boardId) {
    try {
      logger.info(`Processing interventions for board ${boardId}`);

      const board = await Board.findById(boardId).populate('members');
      if (!board) {
        logger.error(`Board ${boardId} not found`);
        return;
      }

      const cards = await Card.find({ boardId, closed: false });
      const interventions = [];

      // Check each card for intervention triggers
      for (const card of cards) {
        const cardInterventions = await this.checkCardForInterventions(card, board);
        interventions.push(...cardInterventions);
      }

      // Check team-level interventions
      const teamInterventions = await this.checkTeamInterventions(board);
      interventions.push(...teamInterventions);

      // Execute interventions
      for (const intervention of interventions) {
        await this.executeIntervention(intervention);
      }

      logger.info(`Processed ${interventions.length} interventions for board ${boardId}`);
      return interventions;
    } catch (error) {
      logger.error('Failed to process interventions:', error);
      throw error;
    }
  }

  // Check individual card for intervention needs
  async checkCardForInterventions(card, board) {
    const interventions = [];

    // Check if card is stuck
    if (await this.isCardStuck(card)) {
      interventions.push(await this.createIntervention({
        boardId: board._id,
        cardId: card._id,
        memberId: card.members[0],
        type: 'comment',
        trigger: 'card_stuck',
        severity: 'high',
        action: 'Request status update on stuck card',
        message: this.generateStuckCardMessage(card)
      }));
    }

    // Check if card has no activity
    if (await this.hasNoRecentActivity(card)) {
      interventions.push(await this.createIntervention({
        boardId: board._id,
        cardId: card._id,
        memberId: card.members[0],
        type: 'comment',
        trigger: 'no_activity',
        severity: 'medium',
        action: 'Request activity update',
        message: this.generateNoActivityMessage(card)
      }));
    }

    // Check if card is overdue
    if (card.isOverdue()) {
      interventions.push(await this.createIntervention({
        boardId: board._id,
        cardId: card._id,
        memberId: card.members[0],
        type: 'comment',
        trigger: 'overdue',
        severity: 'high',
        action: 'Alert about overdue card',
        message: this.generateOverdueMessage(card)
      }));
    }

    // Check if card is blocking others
    const blockingCount = await this.getBlockingCount(card);
    if (blockingCount >= 2) {
      interventions.push(await this.createIntervention({
        boardId: board._id,
        cardId: card._id,
        memberId: card.members[0],
        type: 'comment',
        trigger: 'blocking_others',
        severity: 'critical',
        action: 'Alert about blocking other cards',
        message: this.generateBlockingMessage(card, blockingCount)
      }));
    }

    return interventions;
  }

  // Check team-level interventions
  async checkTeamInterventions(board) {
    const interventions = [];
    const members = await Member.find({ boardId: board._id });

    // Calculate team average workload
    const totalCards = members.reduce((sum, m) => sum + (m.assignedCards || 0), 0);
    const teamAverage = totalCards / members.length;

    for (const member of members) {
      // Check if member is overloaded
      if (member.assignedCards > teamAverage * 1.5) {
        interventions.push(await this.createIntervention({
          boardId: board._id,
          cardId: null,
          memberId: member._id,
          type: 'reassign',
          trigger: 'member_overloaded',
          severity: 'medium',
          action: 'Rebalance workload',
          message: this.generateOverloadedMessage(member, teamAverage),
          metadata: { teamAverage, memberCards: member.assignedCards }
        }));
      }
    }

    return interventions;
  }

  // Execute an intervention
  async executeIntervention(intervention) {
    try {
      const saved = await intervention.save();

      switch (intervention.type) {
        case 'comment':
          await this.executeComment(saved);
          break;
        case 'reassign':
          await this.executeReassignment(saved);
          break;
        case 'escalate':
          await this.executeEscalation(saved);
          break;
        case 'move_card':
          await this.executeMoveCard(saved);
          break;
        case 'add_label':
          await this.executeAddLabel(saved);
          break;
        default:
          logger.warn(`Unknown intervention type: ${intervention.type}`);
      }

      await saved.markExecuted();
      logger.info(`Executed intervention ${saved._id}: ${saved.action}`);
    } catch (error) {
      logger.error(`Failed to execute intervention ${intervention._id}:`, error);
      await intervention.markFailed(error);
    }
  }

  // Execute comment intervention
  async executeComment(intervention) {
    const card = await Card.findById(intervention.cardId);
    const member = await Member.findById(intervention.memberId);

    if (!card || !member) {
      throw new Error('Card or member not found');
    }

    // Post comment to Trello
    const commentText = `@${member.username} ${intervention.message}`;
    await trelloClient.addCommentToCard(card.trelloId, commentText);

    logger.info(`Posted comment to card ${card.trelloId}: ${commentText}`);
  }

  // Execute reassignment intervention
  async executeReassignment(intervention) {
    const card = await Card.findById(intervention.cardId);
    const member = await Member.findById(intervention.memberId);

    if (!card || !member) {
      throw new Error('Card or member not found');
    }

    // Find best member to reassign to
    const targetMember = await this.findBestReassignmentTarget(card, member);

    if (!targetMember) {
      logger.warn(`No suitable reassignment target found for card ${card._id}`);
      return;
    }

    // Reassign in Trello
    await trelloClient.removeMemberFromCard(card.trelloId, member.trelloId);
    await trelloClient.addMemberToCard(card.trelloId, targetMember.trelloId);

    // Post comment explaining reassignment
    const commentText = `@${member.username} I've reassigned this card to @${targetMember.username} due to workload balancing. You currently have ${member.assignedCards} cards (team avg: ${intervention.metadata.teamAverage.toFixed(1)}).`;
    await trelloClient.addCommentToCard(card.trelloId, commentText);

    // Update local database
    card.members = card.members.filter(m => m.toString() !== member._id.toString());
    card.members.push(targetMember._id);
    await card.save();

    logger.info(`Reassigned card ${card._id} from ${member.username} to ${targetMember.username}`);
  }

  // Execute escalation intervention
  async executeEscalation(intervention) {
    const card = await Card.findById(intervention.cardId);
    const member = await Member.findById(intervention.memberId);
    const board = await Board.findById(intervention.boardId);

    if (!card || !board) {
      throw new Error('Card or board not found');
    }

    // Find team lead (member with role 'admin' or 'lead')
    const teamLead = await Member.findOne({
      boardId: board._id,
      role: { $in: ['admin', 'lead'] }
    });

    if (!teamLead) {
      logger.warn(`No team lead found for board ${board._id}`);
      return;
    }

    // Post escalation comment
    const commentText = `@${teamLead.username} ESCALATION: ${intervention.message} ${member ? `@${member.username} ` : ''}has not responded to previous follow-ups. Please review.`;
    await trelloClient.addCommentToCard(card.trelloId, commentText);

    // Add ESCALATED label
    await trelloClient.addLabelToCard(card.trelloId, 'ESCALATED');

    // Record escalation
    await intervention.escalate(teamLead._id, intervention.message);

    logger.info(`Escalated card ${card._id} to ${teamLead.username}`);
  }

  // Execute move card intervention
  async executeMoveCard(intervention) {
    const card = await Card.findById(intervention.cardId);
    
    if (!card) {
      throw new Error('Card not found');
    }

    const targetListId = intervention.metadata.targetListId;
    await trelloClient.moveCardToList(card.trelloId, targetListId);

    logger.info(`Moved card ${card._id} to list ${targetListId}`);
  }

  // Execute add label intervention
  async executeAddLabel(intervention) {
    const card = await Card.findById(intervention.cardId);
    
    if (!card) {
      throw new Error('Card not found');
    }

    const labelName = intervention.metadata.labelName;
    await trelloClient.addLabelToCard(card.trelloId, labelName);

    logger.info(`Added label ${labelName} to card ${card._id}`);
  }

  // Helper: Check if card is stuck
  async isCardStuck(card) {
    if (!card.currentList || !card.enteredCurrentListAt) {
      return false;
    }

    const timeInList = (Date.now() - card.enteredCurrentListAt.getTime()) / (1000 * 60 * 60 * 24);
    const expectedTime = card.currentList.averageTimeInList || 2;

    return timeInList > expectedTime * 2;
  }

  // Helper: Check if card has no recent activity
  async hasNoRecentActivity(card) {
    if (!card.lastActivityAt) {
      return true;
    }

    const daysSinceActivity = (Date.now() - card.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActivity > 5;
  }

  // Helper: Get count of cards blocked by this card
  async getBlockingCount(card) {
    // Check comments and descriptions for mentions of this card blocking others
    // This is a simplified version - in production, you'd track dependencies explicitly
    const blockingCards = await Card.find({
      boardId: card.boardId,
      closed: false,
      'labels.name': 'BLOCKED',
      description: new RegExp(card.name, 'i')
    });

    return blockingCards.length;
  }

  // Helper: Find best member to reassign card to
  async findBestReassignmentTarget(card, currentMember) {
    const members = await Member.find({
      boardId: card.boardId,
      _id: { $ne: currentMember._id }
    }).sort({ assignedCards: 1 });

    // Find member with lowest workload and matching specialties
    for (const member of members) {
      if (member.assignedCards < currentMember.assignedCards * 0.8) {
        // Check if member has relevant specialties
        const hasRelevantSkill = card.labels.some(label =>
          member.specialties.includes(label.name.toLowerCase())
        );

        if (hasRelevantSkill || member.assignedCards < 5) {
          return member;
        }
      }
    }

    // Return member with lowest workload if no specialty match
    return members[0];
  }

  // Helper: Create intervention
  async createIntervention(data) {
    return new Intervention(data);
  }

  // Message generators
  generateStuckCardMessage(card) {
    const daysStuck = Math.floor((Date.now() - card.enteredCurrentListAt.getTime()) / (1000 * 60 * 60 * 24));
    return `This card has been in "${card.currentList?.name}" for ${daysStuck} days. Expected completion was ${card.currentList?.averageTimeInList || 2} days. Please provide a status update by end of day.`;
  }

  generateNoActivityMessage(card) {
    const daysSinceActivity = Math.floor((Date.now() - card.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24));
    return `No activity on this card for ${daysSinceActivity} days. Please provide an update. Do you need help?`;
  }

  generateOverdueMessage(card) {
    const daysOverdue = Math.floor((Date.now() - card.due.getTime()) / (1000 * 60 * 60 * 24));
    return `⚠️ This card is ${daysOverdue} day(s) overdue. Please complete ASAP or update the due date with a realistic timeline.`;
  }

  generateBlockingMessage(card, blockingCount) {
    return `🚨 URGENT: This card is blocking ${blockingCount} other cards. Please prioritize completion or provide ETA.`;
  }

  generateOverloadedMessage(member, teamAverage) {
    return `You currently have ${member.assignedCards} cards assigned (team average: ${teamAverage.toFixed(1)}). I'm rebalancing your workload to prevent burnout.`;
  }

  // Process follow-ups for interventions that didn't get responses
  async processFollowUps() {
    try {
      const needingFollowUp = await Intervention.getNeedingFollowUp();

      for (const intervention of needingFollowUp) {
        // Create follow-up intervention
        const followUp = await this.createIntervention({
          boardId: intervention.boardId,
          cardId: intervention.cardId,
          memberId: intervention.memberId,
          type: 'follow_up',
          trigger: 'no_response_to_followup',
          severity: 'high',
          action: 'Follow up on previous intervention',
          message: `Following up on my previous message. Please respond by noon or I'll escalate to your team lead.`,
          metadata: { originalInterventionId: intervention._id }
        });

        await this.executeIntervention(followUp);
        intervention.followUpInterventionId = followUp._id;
        await intervention.save();
      }

      logger.info(`Processed ${needingFollowUp.length} follow-ups`);
    } catch (error) {
      logger.error('Failed to process follow-ups:', error);
    }
  }

  // Process escalations for interventions that still didn't get responses
  async processEscalations() {
    try {
      const needingEscalation = await Intervention.getNeedingEscalation();

      for (const intervention of needingEscalation) {
        // Create escalation intervention
        const escalation = await this.createIntervention({
          boardId: intervention.boardId,
          cardId: intervention.cardId,
          memberId: intervention.memberId,
          type: 'escalate',
          trigger: 'no_response_to_followup',
          severity: 'critical',
          action: 'Escalate to team lead',
          message: `Card has been stuck for extended period with no response to multiple follow-ups.`,
          metadata: { originalInterventionId: intervention._id }
        });

        await this.executeIntervention(escalation);
      }

      logger.info(`Processed ${needingEscalation.length} escalations`);
    } catch (error) {
      logger.error('Failed to process escalations:', error);
    }
  }
}

module.exports = new InterventionEngine();
