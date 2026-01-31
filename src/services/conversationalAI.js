const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const Conversation = require('../models/Conversation');
const Member = require('../models/Member');
const Card = require('../models/Card');
const Performance = require('../models/Performance');
const performanceTracker = require('./performanceTracker');
const teamManager = require('./teamManager');

class ConversationalAI {
  constructor() {
    this.openai = new OpenAI();
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
  async processMessage(memberId, message, channel = 'trello_comment', cardId = null) {
    try {
      logger.info(`Processing message from member ${memberId}: ${message.substring(0, 50)}...`);

      const member = await Member.findById(memberId).populate('boardId');
      if (!member) {
        throw new Error('Member not found');
      }

      // Get or create conversation
      let conversation = await this.getOrCreateConversation(memberId, channel, cardId);

      // Add user message
      await conversation.addMessage('user', message);

      // Detect intent
      const intent = await this.detectIntent(message);
      if (!conversation.intent) {
        conversation.intent = intent;
        await conversation.save();
      }

      // Get context for response
      const context = await this.getResponseContext(member, cardId);

      // Generate response
      const response = await this.generateResponse(conversation, context);

      // Add assistant message
      await conversation.addMessage('assistant', response);

      // Execute any actions if needed
      await this.executeActions(intent, member, response, cardId);

      logger.info(`Generated response for ${member.username}`);

      return {
        response,
        conversation: conversation._id,
        intent
      };
    } catch (error) {
      logger.error('Failed to process message:', error);
      throw error;
    }
  }

  // Get or create conversation
  async getOrCreateConversation(memberId, channel, cardId) {
    // Check for recent unresolved conversation
    const recentConversation = await Conversation.findOne({
      memberId,
      resolved: false,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // within last hour
    }).sort({ createdAt: -1 });

    if (recentConversation) {
      return recentConversation;
    }

    // Create new conversation
    const member = await Member.findById(memberId);
    return new Conversation({
      memberId,
      boardId: member.boardId,
      cardId,
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
  async getResponseContext(member, cardId = null) {
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
      closed: false
    }).sort({ due: 1, riskLevel: -1 }).limit(10);

    context.cards = cards.map(c => ({
      id: c._id,
      name: c.name,
      due: c.due,
      riskLevel: c.riskLevel,
      isOverdue: c.isOverdue(),
      labels: c.labels
    }));

    // Get specific card if provided
    if (cardId) {
      const card = await Card.findById(cardId);
      if (card) {
        context.currentCard = {
          id: card._id,
          name: card.name,
          description: card.description,
          due: card.due,
          riskLevel: card.riskLevel,
          members: card.members
        };
      }
    }

    // Get performance data
    const performance = await Performance.getLatest(member._id, 'weekly');
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
  async executeActions(intent, member, response, cardId) {
    try {
      switch (intent) {
        case 'request_reassignment':
          // Trigger workload analysis
          await teamManager.analyzeTeamWorkload(member.boardId);
          break;
        
        case 'report_blocker':
          // Add BLOCKED label to card if specified
          if (cardId) {
            const card = await Card.findById(cardId);
            if (card) {
              // This would be handled by intervention engine
              logger.info(`Card ${cardId} reported as blocked by ${member.username}`);
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
  async handleQuickQuery(memberId, query) {
    const member = await Member.findById(memberId);
    const context = await this.getResponseContext(member);

    const lowerQuery = query.toLowerCase();

    // What's next?
    if (lowerQuery.includes('what\'s next') || lowerQuery.includes('what now')) {
      if (context.cards.length > 0) {
        const nextCard = context.cards[0];
        return `Your next priority is Card #${nextCard.id}: ${nextCard.name}${nextCard.isOverdue ? ' (OVERDUE!)' : ''}`;
      }
      return `You don't have any pending tasks. Great job!`;
    }

    // How many cards?
    if (lowerQuery.includes('how many')) {
      return `You currently have ${context.cards.length} active cards assigned.`;
    }

    // Am I overdue?
    if (lowerQuery.includes('overdue')) {
      const overdue = context.cards.filter(c => c.isOverdue);
      if (overdue.length > 0) {
        return `You have ${overdue.length} overdue card(s): ${overdue.map(c => c.name).join(', ')}`;
      }
      return `You have no overdue cards. Good job staying on schedule!`;
    }

    // Default to full AI processing
    return null;
  }
}

module.exports = new ConversationalAI();
