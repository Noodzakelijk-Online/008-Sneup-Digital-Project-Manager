const { TrelloClient } = require('trello.js');
const logger = require('../utils/logger');

let trelloClient = null;

// Initialize Trello client
const initTrelloClient = () => {
  try {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    
    if (!apiKey || !apiToken) {
      throw new Error('Trello API credentials not found in environment variables');
    }
    
    trelloClient = new TrelloClient({
      key: apiKey,
      token: apiToken
    });
    
    logger.info('Trello client initialized successfully');
    return trelloClient;
  } catch (error) {
    logger.error('Failed to initialize Trello client:', error);
    throw error;
  }
};

// Get Trello client instance
const getTrelloClient = () => {
  if (!trelloClient) {
    return initTrelloClient();
  }
  return trelloClient;
};

// Board API methods
const boardApi = {
  // Get all boards for the authenticated user
  async getBoards() {
    try {
      const client = getTrelloClient();
      const member = await client.members.getMember({ id: 'me' });
      const boards = await client.members.getMemberBoards({ id: member.id });
      logger.info(`Retrieved ${boards.length} boards from Trello`);
      return boards;
    } catch (error) {
      logger.error('Failed to get boards:', error);
      throw error;
    }
  },
  
  // Get a specific board
  async getBoard(boardId) {
    try {
      const client = getTrelloClient();
      const board = await client.boards.getBoard({ id: boardId });
      return board;
    } catch (error) {
      logger.error(`Failed to get board ${boardId}:`, error);
      throw error;
    }
  },
  
  // Get lists for a board
  async getLists(boardId) {
    try {
      const client = getTrelloClient();
      const lists = await client.boards.getBoardLists({ id: boardId });
      return lists;
    } catch (error) {
      logger.error(`Failed to get lists for board ${boardId}:`, error);
      throw error;
    }
  },
  
  // Get cards for a board
  async getCards(boardId) {
    try {
      const client = getTrelloClient();
      const cards = await client.boards.getBoardCards({
        id: boardId,
        attachments: 'true',
        checklists: 'all',
        members: 'true'
      });
      return cards;
    } catch (error) {
      logger.error(`Failed to get cards for board ${boardId}:`, error);
      throw error;
    }
  },
  
  // Get members for a board
  async getMembers(boardId) {
    try {
      const client = getTrelloClient();
      const members = await client.boards.getBoardMembers({ id: boardId });
      return members;
    } catch (error) {
      logger.error(`Failed to get members for board ${boardId}:`, error);
      throw error;
    }
  }
};

// List API methods
const listApi = {
  // Get a specific list
  async getList(listId) {
    try {
      const client = getTrelloClient();
      const list = await client.lists.getList({ id: listId });
      return list;
    } catch (error) {
      logger.error(`Failed to get list ${listId}:`, error);
      throw error;
    }
  },
  
  // Get cards in a list
  async getCards(listId) {
    try {
      const client = getTrelloClient();
      const cards = await client.lists.getListCards({ id: listId });
      return cards;
    } catch (error) {
      logger.error(`Failed to get cards for list ${listId}:`, error);
      throw error;
    }
  }
};

// Card API methods
const cardApi = {
  // Get a specific card
  async getCard(cardId) {
    try {
      const client = getTrelloClient();
      const card = await client.cards.getCard({
        id: cardId,
        attachments: 'true',
        checklists: 'all',
        members: 'true'
      });
      return card;
    } catch (error) {
      logger.error(`Failed to get card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Get comments (actions) for a card
  async getComments(cardId) {
    try {
      const client = getTrelloClient();
      const actions = await client.cards.getCardActions({
        id: cardId,
        filter: 'commentCard'
      });
      return actions;
    } catch (error) {
      logger.error(`Failed to get comments for card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Add a comment to a card
  async addComment(cardId, text) {
    try {
      const client = getTrelloClient();
      const comment = await client.cards.createCardComment({
        id: cardId,
        text
      });
      logger.info(`Added comment to card ${cardId}`);
      return comment;
    } catch (error) {
      logger.error(`Failed to add comment to card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Update a card
  async updateCard(cardId, updates) {
    try {
      const client = getTrelloClient();
      const card = await client.cards.updateCard({
        id: cardId,
        ...updates
      });
      logger.info(`Updated card ${cardId}`);
      return card;
    } catch (error) {
      logger.error(`Failed to update card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Move a card to a different list
  async moveCard(cardId, listId) {
    try {
      const client = getTrelloClient();
      const card = await client.cards.updateCard({
        id: cardId,
        idList: listId
      });
      logger.info(`Moved card ${cardId} to list ${listId}`);
      return card;
    } catch (error) {
      logger.error(`Failed to move card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Add a member to a card
  async addMember(cardId, memberId) {
    try {
      const client = getTrelloClient();
      await client.cards.createCardMember({
        id: cardId,
        value: memberId
      });
      logger.info(`Added member ${memberId} to card ${cardId}`);
    } catch (error) {
      logger.error(`Failed to add member to card ${cardId}:`, error);
      throw error;
    }
  },
  
  // Remove a member from a card
  async removeMember(cardId, memberId) {
    try {
      const client = getTrelloClient();
      await client.cards.deleteCardMember({
        id: cardId,
        idMember: memberId
      });
      logger.info(`Removed member ${memberId} from card ${cardId}`);
    } catch (error) {
      logger.error(`Failed to remove member from card ${cardId}:`, error);
      throw error;
    }
  }
};

// Member API methods
const memberApi = {
  // Get authenticated member
  async getMe() {
    try {
      const client = getTrelloClient();
      const member = await client.members.getMember({ id: 'me' });
      return member;
    } catch (error) {
      logger.error('Failed to get authenticated member:', error);
      throw error;
    }
  },
  
  // Get a specific member
  async getMember(memberId) {
    try {
      const client = getTrelloClient();
      const member = await client.members.getMember({ id: memberId });
      return member;
    } catch (error) {
      logger.error(`Failed to get member ${memberId}:`, error);
      throw error;
    }
  }
};

// Webhook API methods
const webhookApi = {
  // Create a webhook
  async createWebhook(callbackUrl, idModel, description = 'Sneup webhook') {
    try {
      const client = getTrelloClient();
      const webhook = await client.webhooks.createWebhook({
        callbackURL: callbackUrl,
        idModel,
        description
      });
      logger.info(`Created webhook for model ${idModel}`);
      return webhook;
    } catch (error) {
      logger.error(`Failed to create webhook for model ${idModel}:`, error);
      throw error;
    }
  },
  
  // Get all webhooks
  async getWebhooks() {
    try {
      const client = getTrelloClient();
      const token = process.env.TRELLO_API_TOKEN;
      const webhooks = await client.tokens.getTokenWebhooks({ token });
      return webhooks;
    } catch (error) {
      logger.error('Failed to get webhooks:', error);
      throw error;
    }
  },
  
  // Delete a webhook
  async deleteWebhook(webhookId) {
    try {
      const client = getTrelloClient();
      await client.webhooks.deleteWebhook({ id: webhookId });
      logger.info(`Deleted webhook ${webhookId}`);
    } catch (error) {
      logger.error(`Failed to delete webhook ${webhookId}:`, error);
      throw error;
    }
  },
  
  // Update a webhook
  async updateWebhook(webhookId, updates) {
    try {
      const client = getTrelloClient();
      const webhook = await client.webhooks.updateWebhook({
        id: webhookId,
        ...updates
      });
      logger.info(`Updated webhook ${webhookId}`);
      return webhook;
    } catch (error) {
      logger.error(`Failed to update webhook ${webhookId}:`, error);
      throw error;
    }
  }
};

module.exports = {
  initTrelloClient,
  getTrelloClient,
  boardApi,
  listApi,
  cardApi,
  memberApi,
  webhookApi
};
