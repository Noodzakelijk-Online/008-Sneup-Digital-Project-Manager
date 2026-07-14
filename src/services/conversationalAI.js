const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const { safeExternalSourceUrl } = require('../utils/externalSourceUrl');
const Conversation = require('../models/Conversation');
const Member = require('../models/Member');
const Card = require('../models/Card');
const Performance = require('../models/Performance');
const performanceTracker = require('./performanceTracker');
const teamManager = require('./teamManager');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

class ConversationalAI {
  constructor() {
    this.openai = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
    this.systemPrompt = this.getSystemPrompt();
  }

  // Get system prompt for Sneup AI
  getSystemPrompt() {
    return `You are Sneup, an autonomous AI-powered digital project manager for Trello. You help team members understand their priorities, get clarity on tasks, and improve their performance.

Your personality:
- Professional but friendly
- Direct and action-oriented
- Data-driven and factual
- Supportive and encouraging
- Proactive in identifying issues

Your capabilities:
- Provide prioritized task lists
- Explain why tasks are assigned
- Help with blockers and obstacles
- Provide performance feedback
- Reassign tasks when needed
- Escalate issues to team leads
- Track accountability

When responding:
- Be concise and clear
- Use emojis sparingly for emphasis (🔴🟡🟢✅⚠️🚨)
- Always provide actionable next steps
- Reference specific cards by number
- Show empathy when workers are struggling
- Be firm but fair about accountability

Remember: You're here to help workers succeed while ensuring projects stay on track.`;
  }

  // Process a message from a worker
  async processMessage(memberId, message, channel = 'trello_comment', cardId = null, options = {}) {
    try {
      logger.info('Processing worker chat message', {
        event: 'worker_chat_message_received',
        memberId: String(memberId),
        channel,
        hasCardContext: Boolean(cardId)
      });
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());

      const member = await Member.findOne({ _id: memberId, workspaceId }).populate('boards');
      if (!member) {
        throw new Error('Member not found');
      }

      // Get or create conversation
      let conversation = await this.getOrCreateConversation(memberId, channel, cardId, { workspaceId });

      // Add user message
      await conversation.addMessage('user', message);

      // Detect intent
      const intent = await this.detectIntent(message);
      if (!conversation.intent) {
        conversation.intent = intent;
        await conversation.save();
      }

      // Get context for response
      const context = await this.getResponseContext(member, cardId, { workspaceId });
      const sourceEvidence = this.buildResponseSourceEvidence(context, cardId);

      // Generate response
      const response = await this.generateResponse(conversation, context);

      // Add assistant message
      await conversation.addMessage('assistant', response);

      // Execute any actions if needed
      await this.executeActions(intent, member, response, cardId, { workspaceId });

      logger.info('Generated worker chat response', {
        event: 'worker_chat_response_generated',
        memberId: String(member._id),
        channel,
        hasCardContext: Boolean(cardId)
      });

      return {
        response,
        conversation: conversation._id,
        intent,
        sourceEvidence
      };
    } catch (error) {
      logger.error('Failed to process message:', error);
      throw error;
    }
  }

  // Get or create conversation
  async getOrCreateConversation(memberId, channel, cardId, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    // Check for recent unresolved conversation
    const recentConversation = await Conversation.findOne({
      memberId,
      workspaceId,
      resolved: false,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // within last hour
    }).sort({ createdAt: -1 });

    if (recentConversation) {
      return recentConversation;
    }

    // Create new conversation
    const member = await Member.findOne({ _id: memberId, workspaceId });
    const boardId = member?.boards?.[0]?._id || member?.boards?.[0];
    return new Conversation({
      memberId,
      boardId,
      cardId,
      workspaceId,
      channel
    });
  }

  // Detect intent from message
  async detectIntent(message) {
    const lowerMessage = message.toLowerCase();

    // Priority-related
    if (lowerMessage.includes('priority') || lowerMessage.includes('what should i work on') || 
        lowerMessage.includes('what to do') || lowerMessage.includes('next task')) {
      return 'get_priorities';
    }

    // Help-related
    if (lowerMessage.includes('help') || lowerMessage.includes('stuck') || 
        lowerMessage.includes('blocked') || lowerMessage.includes('issue')) {
      return 'ask_for_help';
    }

    // Reassignment
    if (lowerMessage.includes('reassign') || lowerMessage.includes('too much') || 
        lowerMessage.includes('overloaded') || lowerMessage.includes('can\'t handle')) {
      return 'request_reassignment';
    }

    // Blocker
    if (lowerMessage.includes('blocked by') || lowerMessage.includes('waiting for') || 
        lowerMessage.includes('depends on')) {
      return 'report_blocker';
    }

    // Performance
    if (lowerMessage.includes('how am i doing') || lowerMessage.includes('my performance') || 
        lowerMessage.includes('my stats')) {
      return 'check_performance';
    }

    // Update
    if (lowerMessage.includes('done') || lowerMessage.includes('completed') || 
        lowerMessage.includes('finished')) {
      return 'provide_update';
    }

    return 'ask_question';
  }

  // Get context for generating response
  async getResponseContext(member, cardId = null, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || member.workspaceId || getDefaultWorkspaceObjectId());
    const context = {
      member: {
        id: member._id,
        username: member.username,
        assignedCards: member.assignedCards,
        workloadLevel: member.workloadLevel
      }
    };

    // Get member's current cards
    const cards = await Card.find({
      members: member._id,
      workspaceId,
      closed: false
    })
      .populate('boardId')
      .populate('listId')
      .sort({ due: 1, riskLevel: -1 })
      .limit(10);

    context.cards = cards.map(c => ({
      id: c._id,
      trelloId: c.trelloId,
      name: c.name,
      boardId: c.boardId?._id || c.boardId,
      boardName: c.boardId?.name,
      boardUrl: c.boardId?.url,
      listId: c.listId?._id || c.listId,
      listName: c.listId?.name,
      due: c.due,
      riskLevel: c.riskLevel,
      isOverdue: c.isOverdue(),
      labels: c.labels,
      lastActivity: c.lastActivity,
      updatedAt: c.updatedAt
    }));

    // Get specific card if provided
    if (cardId) {
      const card = await Card.findOne({ _id: cardId, workspaceId }).populate('boardId').populate('listId');
      if (card) {
        context.currentCard = {
          id: card._id,
          trelloId: card.trelloId,
          name: card.name,
          description: card.description,
          boardId: card.boardId?._id || card.boardId,
          boardName: card.boardId?.name,
          boardUrl: card.boardId?.url,
          listId: card.listId?._id || card.listId,
          listName: card.listId?.name,
          due: card.due,
          riskLevel: card.riskLevel,
          members: card.members,
          lastActivity: card.lastActivity,
          updatedAt: card.updatedAt
        };
      }
    }

    // Get performance data
    const performance = await Performance.getLatest(member._id, 'weekly', workspaceId);
    if (performance) {
      context.performance = {
        score: performance.calculated.performanceScore,
        grade: performance.calculated.performanceGrade,
        completionRate: performance.calculated.completionRate,
        onTimeRate: performance.calculated.onTimeDeliveryRate,
        cardsCompleted: performance.metrics.cardsCompleted,
        flags: performance.flags.map(f => f.type)
      };
    }

    return context;
  }

  // Generate response using OpenAI
  async generateResponse(conversation, context) {
    try {
      if (!this.openai) {
        logger.warn('OPENAI_API_KEY is not configured. Using Sneup fallback response.');
        return this.generateFallbackResponse(conversation.intent, context);
      }

      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'system', content: `Context: ${JSON.stringify(context, null, 2)}` },
        ...conversation.messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      ];

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages,
        temperature: 0.7,
        max_tokens: 500
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error('Failed to generate AI response:', error);
      
      // Fallback to rule-based response
      return this.generateFallbackResponse(conversation.intent, context);
    }
  }

  // Generate fallback response if AI fails
  generateFallbackResponse(intent, context) {
    switch (intent) {
      case 'get_priorities':
        return this.generatePrioritiesResponse(context);
      
      case 'check_performance':
        return this.generatePerformanceResponse(context);
      
      case 'ask_for_help':
        return `I see you need help. Let me check what I can do to assist you. Could you provide more details about what you're stuck on?`;
      
      case 'request_reassignment':
        return `I understand you're feeling overloaded. Let me review your workload and see if we can rebalance some tasks.`;
      
      default:
        return `I'm here to help! You can ask me about your priorities, performance, or any issues you're facing with your tasks.`;
    }
  }

  // Generate priorities response
  generatePrioritiesResponse(context) {
    if (!context.cards || context.cards.length === 0) {
      return `You don't have any active cards assigned right now. Great job staying on top of your work! Check back later for new assignments.`;
    }

    let response = `Here are your current priorities:\n\n`;

    // Urgent cards (overdue or critical)
    const urgent = context.cards.filter(c => c.isOverdue || c.riskLevel === 'critical');
    if (urgent.length > 0) {
      response += `🔴 URGENT:\n`;
      urgent.forEach(c => {
        response += `• Card #${c.id}: ${c.name}${c.isOverdue ? ' (OVERDUE)' : ''}\n`;
      });
      response += `\n`;
    }

    // High priority (due soon or high risk)
    const high = context.cards.filter(c => 
      !c.isOverdue && c.riskLevel !== 'critical' && 
      (c.riskLevel === 'high' || (c.due && new Date(c.due) < new Date(Date.now() + 24 * 60 * 60 * 1000)))
    );
    if (high.length > 0) {
      response += `🟡 HIGH PRIORITY:\n`;
      high.slice(0, 3).forEach(c => {
        response += `• Card #${c.id}: ${c.name}\n`;
      });
      response += `\n`;
    }

    // Normal priority
    const normal = context.cards.filter(c => 
      !c.isOverdue && c.riskLevel !== 'critical' && c.riskLevel !== 'high'
    );
    if (normal.length > 0) {
      response += `🟢 NORMAL:\n`;
      normal.slice(0, 2).forEach(c => {
        response += `• Card #${c.id}: ${c.name}\n`;
      });
    }

    response += `\nYou have ${context.cards.length} total cards assigned.`;
    
    if (context.member.workloadLevel === 'overloaded') {
      response += ` You're currently overloaded. Let me know if you need help rebalancing.`;
    }

    return response;
  }

  buildResponseSourceEvidence(context = {}, cardId = null) {
    const refs = [];
    const cards = Array.isArray(context.cards) ? context.cards : [];
    const selectedCards = cardId && context.currentCard
      ? [context.currentCard]
      : cards.slice(0, 5);

    for (const card of selectedCards) {
      refs.push({
        type: 'card',
        entityId: card.id,
        label: card.name || 'Assigned card',
        url: safeExternalSourceUrl(card.url || card.shortUrl || card.boardUrl),
        observedAt: card.lastActivity || card.updatedAt || new Date(),
        data: {
          reason: cardId && context.currentCard ? 'Current conversation card' : 'Assigned card used for chat response',
          trelloId: card.trelloId,
          boardId: card.boardId,
          boardName: card.boardName,
          listId: card.listId,
          listName: card.listName,
          due: card.due,
          riskLevel: card.riskLevel,
          isOverdue: card.isOverdue
        }
      });
    }

    if (context.performance) {
      refs.push({
        type: 'analytics',
        label: 'Latest member performance snapshot',
        observedAt: new Date(),
        data: {
          reason: 'Performance context used for chat response',
          score: context.performance.score,
          grade: context.performance.grade,
          completionRate: context.performance.completionRate,
          onTimeRate: context.performance.onTimeRate,
          flags: context.performance.flags || []
        }
      });
    }

    return refs
      .filter(ref => ref.entityId || ref.label)
      .map(ref => ({
        type: ref.type || 'system',
        entityId: ref.entityId,
        label: ref.label || ref.type || 'Evidence',
        url: safeExternalSourceUrl(ref.url),
        observedAt: ref.observedAt || new Date(),
        data: ref.data || {}
      }));
  }

  // Generate performance response
  generatePerformanceResponse(context) {
    if (!context.performance) {
      return `I don't have enough performance data yet. Keep working on your tasks and check back in a few days!`;
    }

    const p = context.performance;
    let response = `Here's your performance summary:\n\n`;
    
    response += `📊 Overall Score: ${p.score}/100 (Grade: ${p.grade})\n`;
    response += `✅ Cards Completed: ${p.cardsCompleted} this week\n`;
    response += `⏱️ On-Time Delivery: ${p.onTimeRate}%\n`;
    response += `📈 Completion Rate: ${p.completionRate}%\n\n`;

    if (p.flags.includes('high_performer')) {
      response += `🌟 You're a high performer! Keep up the excellent work!\n`;
    } else if (p.flags.includes('underperforming')) {
      response += `⚠️ Your performance is below expectations. Let's work together to improve.\n`;
    } else {
      response += `You're performing well! Keep it up! 🚀\n`;
    }

    return response;
  }

  // Execute actions based on intent
  async executeActions(intent, member, response, cardId, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || member.workspaceId || getDefaultWorkspaceObjectId());
    try {
      switch (intent) {
        case 'request_reassignment':
          // Trigger workload analysis
          if (member.boards && member.boards.length > 0) {
            await teamManager.analyzeTeamWorkload(member.boards[0]._id || member.boards[0], { workspaceId });
          }
          break;
        
        case 'report_blocker':
          // Add BLOCKED label to card if specified
          if (cardId) {
            const card = await Card.findOne({ _id: cardId, workspaceId });
            if (card) {
              // This would be handled by intervention engine
              logger.info('Worker reported a blocker in chat', {
                event: 'worker_chat_blocker_reported',
                memberId: String(member._id),
                cardId: String(cardId)
              });
            }
          }
          break;
        
        case 'provide_update':
          // Mark any pending interventions as responded
          logger.info(`Member ${member.username} provided update`);
          break;
      }
    } catch (error) {
      logger.error('Failed to execute actions:', error);
    }
  }

  // Handle common queries with quick responses
  async handleQuickQuery(memberId, query, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    const member = await Member.findOne({ _id: memberId, workspaceId });
    if (!member) {
      return null;
    }
    const context = await this.getResponseContext(member, null, { workspaceId });

    const lowerQuery = query.toLowerCase();

    // What's next?
    if (lowerQuery.includes('what\'s next') || lowerQuery.includes('what now')) {
      if (context.cards.length > 0) {
        const nextCard = context.cards[0];
        return {
          response: `Your next priority is Card #${nextCard.id}: ${nextCard.name}${nextCard.isOverdue ? ' (OVERDUE!)' : ''}`,
          sourceEvidence: this.buildResponseSourceEvidence({ ...context, cards: [nextCard] })
        };
      }
      return {
        response: `You don't have any pending tasks. Great job!`,
        sourceEvidence: []
      };
    }

    // How many cards?
    if (lowerQuery.includes('how many')) {
      return {
        response: `You currently have ${context.cards.length} active cards assigned.`,
        sourceEvidence: this.buildResponseSourceEvidence(context)
      };
    }

    // Am I overdue?
    if (lowerQuery.includes('overdue')) {
      const overdue = context.cards.filter(c => c.isOverdue);
      if (overdue.length > 0) {
        return {
          response: `You have ${overdue.length} overdue card(s): ${overdue.map(c => c.name).join(', ')}`,
          sourceEvidence: this.buildResponseSourceEvidence({ ...context, cards: overdue })
        };
      }
      return {
        response: `You have no overdue cards. Good job staying on schedule!`,
        sourceEvidence: this.buildResponseSourceEvidence(context)
      };
    }

    // Default to full AI processing
    return null;
  }
}

module.exports = new ConversationalAI();
