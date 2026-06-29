const logger = require('../utils/logger');
const trelloClient = require('./trelloClient');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Comment = require('../models/Comment');
const schedule = require('node-schedule');
const jobObservabilityService = require('./jobObservabilityService');
const { defaultWorkspaceQuery, getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

/**
 * Trello Synchronization Service
 * Handles syncing data from Trello to local database
 */

// Initialize synchronization
const initSync = async () => {
  try {
    logger.info('Initializing Trello synchronization...');
    
    // Initialize Trello client
    trelloClient.initTrelloClient();
    
    // Perform initial full sync
    await jobObservabilityService.trackJob({
      jobName: 'trello.full_sync',
      jobType: 'sync',
      triggerType: 'startup'
    }, () => syncAllBoards());
    
    // Schedule regular syncs
    scheduleSync();
    
    // Set up webhooks for real-time updates
    await setupWebhooks();
    
    logger.info('Trello synchronization initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Trello synchronization:', error);
    throw error;
  }
};

// Schedule regular synchronization jobs
const scheduleSync = () => {
  // Full sync daily at 1 AM
  const fullSyncCron = process.env.FULL_SYNC_CRON || '0 1 * * *';
  schedule.scheduleJob(fullSyncCron, async () => {
    logger.info('Running scheduled full sync');
    await jobObservabilityService.trackJob({
      jobName: 'trello.full_sync',
      jobType: 'sync',
      triggerType: 'scheduled'
    }, () => syncAllBoards());
  });
  
  // Incremental sync every 15 minutes
  const incrementalSyncCron = process.env.INCREMENTAL_SYNC_CRON || '*/15 * * * *';
  schedule.scheduleJob(incrementalSyncCron, async () => {
    logger.info('Running scheduled incremental sync');
    await jobObservabilityService.trackJob({
      jobName: 'trello.incremental_sync',
      jobType: 'sync',
      triggerType: 'scheduled'
    }, () => syncRecentActivity());
  });
  
  logger.info('Sync schedules configured');
};

// Sync all boards
const syncAllBoards = async () => {
  try {
    logger.info('Starting full sync of all boards');
    
    // Get all boards from Trello
    const trelloBoards = await trelloClient.boardApi.getBoards();
    logger.info(`Found ${trelloBoards.length} boards in Trello`);
    
    // Sync each board
    let successCount = 0;
    let failureCount = 0;

    for (const trelloBoard of trelloBoards) {
      try {
        await syncBoard(trelloBoard.id);
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        logger.error(`Failed to sync board ${trelloBoard.id}:`, error);
        // Continue with other boards
      }
    }
    
    logger.info('Full sync completed');
    return {
      processedCount: trelloBoards.length,
      successCount,
      failureCount,
      metadata: { trelloBoardCount: trelloBoards.length }
    };
  } catch (error) {
    logger.error('Failed to sync all boards:', error);
    throw error;
  }
};

// Sync a specific board
const syncBoard = async (boardId, options = {}) => {
  try {
    logger.info(`Syncing board: ${boardId}`);
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    // Get board data from Trello
    const trelloBoard = await trelloClient.boardApi.getBoard(boardId);
    
    // Find or create board in database
    let board = await Board.findOne({
      trelloId: boardId,
      $or: [
        { workspaceId },
        { workspaceId: { $exists: false } },
        { workspaceId: null }
      ]
    });
    
    if (!board) {
      logger.info(`Creating new board: ${trelloBoard.name}`);
      board = new Board({
        trelloId: trelloBoard.id,
        name: trelloBoard.name,
        url: trelloBoard.url,
        description: trelloBoard.desc || '',
        closed: trelloBoard.closed,
        workspaceId
      });
    } else {
      logger.info(`Updating existing board: ${trelloBoard.name}`);
      board.name = trelloBoard.name;
      board.url = trelloBoard.url;
      board.description = trelloBoard.desc || '';
      board.closed = trelloBoard.closed;
      board.workspaceId = board.workspaceId || workspaceId;
    }
    
    board.lastSync = new Date();
    await board.save();
    
    // Sync lists
    await syncLists(board);
    
    // Sync members
    await syncMembers(board);
    
    // Sync cards (which also syncs comments)
    await syncCards(board);
    
    logger.info(`Board sync completed: ${board.name}`);
    return board;
  } catch (error) {
    logger.error(`Failed to sync board ${boardId}:`, error);
    throw error;
  }
};

// Sync lists for a board
const syncLists = async (board) => {
  try {
    logger.info(`Syncing lists for board: ${board.name}`);
    
    // Get lists from Trello
    const trelloLists = await trelloClient.boardApi.getLists(board.trelloId);
    
    const processedListIds = [];
    
    // Process each list
    for (const trelloList of trelloLists) {
      let list = await List.findOne({ trelloId: trelloList.id, workspaceId: board.workspaceId });
      
      if (!list) {
        list = new List({
          trelloId: trelloList.id,
          name: trelloList.name,
          boardId: board._id,
          workspaceId: board.workspaceId,
          position: trelloList.pos,
          closed: trelloList.closed
        });
      } else {
        list.name = trelloList.name;
        list.boardId = board._id;
        list.workspaceId = board.workspaceId;
        list.position = trelloList.pos;
        list.closed = trelloList.closed;
      }
      
      list.lastSync = new Date();
      await list.save();
      
      processedListIds.push(list.trelloId);
    }
    
    // Mark deleted lists as closed
    const dbLists = await List.find({ boardId: board._id, workspaceId: board.workspaceId });
    for (const dbList of dbLists) {
      if (!processedListIds.includes(dbList.trelloId)) {
        dbList.closed = true;
        dbList.lastSync = new Date();
        await dbList.save();
      }
    }
    
    logger.info(`Lists sync completed for board: ${board.name}`);
  } catch (error) {
    logger.error(`Failed to sync lists for board ${board.name}:`, error);
    throw error;
  }
};

// Sync members for a board
const syncMembers = async (board) => {
  try {
    logger.info(`Syncing members for board: ${board.name}`);
    
    // Get members from Trello
    const trelloMembers = await trelloClient.boardApi.getMembers(board.trelloId);
    
    const processedMemberIds = [];
    
    // Process each member
    for (const trelloMember of trelloMembers) {
      let member = await Member.findOne({ trelloId: trelloMember.id, workspaceId: board.workspaceId });
      
      if (!member) {
        member = new Member({
          trelloId: trelloMember.id,
          username: trelloMember.username,
          fullName: trelloMember.fullName,
          avatarUrl: trelloMember.avatarUrl,
          email: trelloMember.email,
          workspaceId: board.workspaceId,
          boards: [board._id]
        });
      } else {
        member.username = trelloMember.username;
        member.fullName = trelloMember.fullName;
        member.avatarUrl = trelloMember.avatarUrl;
        member.workspaceId = board.workspaceId;
        
        // Add board if not already present
        if (!member.boards.some(existingBoard => existingBoard.toString() === board._id.toString())) {
          member.boards.push(board._id);
        }
      }
      
      member.lastSync = new Date();
      await member.save();
      
      processedMemberIds.push(member.trelloId);
    }
    
    // Update board's members
    const boardMembers = await Member.find({ trelloId: { $in: processedMemberIds }, workspaceId: board.workspaceId });
    board.members = boardMembers.map(member => member._id);
    await board.save();
    
    logger.info(`Members sync completed for board: ${board.name}`);
  } catch (error) {
    logger.error(`Failed to sync members for board ${board.name}:`, error);
    throw error;
  }
};

// Sync cards for a board
const syncCards = async (board) => {
  try {
    logger.info(`Syncing cards for board: ${board.name}`);
    
    // Get cards from Trello
    const trelloCards = await trelloClient.boardApi.getCards(board.trelloId);
    
    // Get all lists for this board
    const lists = await List.find({ boardId: board._id, workspaceId: board.workspaceId });
    const listsByTrelloId = {};
    lists.forEach(list => {
      listsByTrelloId[list.trelloId] = list;
    });
    
    // Get all members
    const members = await Member.find({ boards: board._id, workspaceId: board.workspaceId });
    const membersByTrelloId = {};
    members.forEach(member => {
      membersByTrelloId[member.trelloId] = member;
    });
    
    const processedCardIds = [];
    
    // Process each card
    for (const trelloCard of trelloCards) {
      const list = listsByTrelloId[trelloCard.idList];
      if (!list) {
        logger.warn(`List not found for card: ${trelloCard.name}`);
        continue;
      }
      
      let card = await Card.findOne({ trelloId: trelloCard.id, workspaceId: board.workspaceId });
      
      if (!card) {
        card = new Card({
          trelloId: trelloCard.id,
          name: trelloCard.name,
          description: trelloCard.desc || '',
          boardId: board._id,
          listId: list._id,
          position: trelloCard.pos,
          closed: trelloCard.closed,
          workspaceId: board.workspaceId,
          due: trelloCard.due,
          dueComplete: trelloCard.dueComplete,
          labels: trelloCard.labels.map(label => ({
            id: label.id,
            name: label.name,
            color: label.color
          })),
          attachments: (trelloCard.attachments || []).map(att => ({
            id: att.id,
            name: att.name,
            url: att.url
          })),
          checklists: (trelloCard.checklists || []).map(checklist => ({
            id: checklist.id,
            name: checklist.name,
            items: (checklist.checkItems || []).map(item => ({
              id: item.id,
              name: item.name,
              complete: item.state === 'complete'
            }))
          })),
          history: [{
            listId: list._id,
            listName: list.name,
            enteredAt: new Date(),
            exitedAt: null
          }]
        });
      } else {
        // Check if card moved to a new list
        if (card.listId.toString() !== list._id.toString()) {
          // Update exit time of previous list
          if (card.history.length > 0) {
            const lastEntry = card.history[card.history.length - 1];
            if (!lastEntry.exitedAt) {
              lastEntry.exitedAt = new Date();
            }
          }
          
          // Add new history entry
          card.history.push({
            listId: list._id,
            listName: list.name,
            enteredAt: new Date(),
            exitedAt: null
          });
          
          card.timeInCurrentList = 0;
        } else if (card.history.length > 0) {
          // Update time in current list
          const lastEntry = card.history[card.history.length - 1];
          if (!lastEntry.exitedAt) {
            const enteredAt = new Date(lastEntry.enteredAt);
            const now = new Date();
            card.timeInCurrentList = (now - enteredAt) / (1000 * 60 * 60); // hours
          }
        }
        
        // Update card properties
        card.name = trelloCard.name;
        card.description = trelloCard.desc || '';
        card.boardId = board._id;
        card.listId = list._id;
        card.position = trelloCard.pos;
        card.closed = trelloCard.closed;
        card.workspaceId = board.workspaceId;
        card.due = trelloCard.due;
        card.dueComplete = trelloCard.dueComplete;
        card.labels = trelloCard.labels.map(label => ({
          id: label.id,
          name: label.name,
          color: label.color
        }));
        card.attachments = (trelloCard.attachments || []).map(att => ({
          id: att.id,
          name: att.name,
          url: att.url
        }));
        card.checklists = (trelloCard.checklists || []).map(checklist => ({
          id: checklist.id,
          name: checklist.name,
          items: (checklist.checkItems || []).map(item => ({
            id: item.id,
            name: item.name,
            complete: item.state === 'complete'
          }))
        }));
      }
      
      // Process card members
      const cardMemberIds = [];
      if (trelloCard.idMembers && trelloCard.idMembers.length > 0) {
        for (const trelloMemberId of trelloCard.idMembers) {
          const member = membersByTrelloId[trelloMemberId];
          if (member) {
            cardMemberIds.push(member._id);
            
            // Add card to member's assigned cards
            if (!member.assignedCards.some(existingCard => existingCard.toString() === card._id.toString())) {
              member.assignedCards.push(card._id);
              await member.save();
            }
          }
        }
      }
      card.members = cardMemberIds;
      
      card.lastActivity = new Date();
      card.lastSync = new Date();
      await card.save();
      
      // Sync comments for this card
      await syncComments(card);
      
      processedCardIds.push(card.trelloId);
      
      // Update list's cards
      if (!list.cards.some(existingCard => existingCard.toString() === card._id.toString())) {
        list.cards.push(card._id);
        list.cardCount = list.cards.length;
        await list.save();
      }
    }
    
    // Mark deleted cards as closed
    const dbCards = await Card.find({ boardId: board._id, workspaceId: board.workspaceId });
    for (const dbCard of dbCards) {
      if (!processedCardIds.includes(dbCard.trelloId)) {
        dbCard.closed = true;
        dbCard.lastSync = new Date();
        await dbCard.save();
      }
    }
    
    // Update card counts for lists
    for (const list of lists) {
      const cardCount = await Card.countDocuments({ listId: list._id, workspaceId: board.workspaceId, closed: false });
      list.cardCount = cardCount;
      await list.save();
    }
    
    logger.info(`Cards sync completed for board: ${board.name}`);
  } catch (error) {
    logger.error(`Failed to sync cards for board ${board.name}:`, error);
    throw error;
  }
};

// Sync comments for a card
const syncComments = async (card) => {
  try {
    // Get comments from Trello
    const trelloComments = await trelloClient.cardApi.getComments(card.trelloId);
    
    const processedCommentIds = [];
    
    // Process each comment
    for (const trelloComment of trelloComments) {
      let comment = await Comment.findOne({ trelloId: trelloComment.id, workspaceId: card.workspaceId });
      
      // Find the member who made the comment
      let member = await Member.findOne({ trelloId: trelloComment.idMemberCreator, workspaceId: card.workspaceId });
      
      if (!comment) {
        comment = new Comment({
          trelloId: trelloComment.id,
          cardId: card._id,
          memberId: member ? member._id : null,
          workspaceId: card.workspaceId,
          text: trelloComment.data.text,
          createdAt: new Date(trelloComment.date)
        });
      } else {
        comment.cardId = card._id;
        comment.memberId = member ? member._id : null;
        comment.workspaceId = card.workspaceId;
        comment.text = trelloComment.data.text;
        comment.createdAt = new Date(trelloComment.date);
      }
      
      comment.lastSync = new Date();
      await comment.save();
      
      processedCommentIds.push(comment.trelloId);
      
      // Add comment to card's comments
      if (!card.comments.some(existingComment => existingComment.toString() === comment._id.toString())) {
        card.comments.push(comment._id);
        await card.save();
      }
    }
  } catch (error) {
    logger.error(`Failed to sync comments for card ${card.name}:`, error);
    // Continue even if comment sync fails
  }
};

// Sync recent activity (incremental sync)
const syncRecentActivity = async () => {
  try {
    logger.info('Starting incremental sync');
    
    // Get all boards
    const boards = await Board.find(defaultWorkspaceQuery({ closed: false }));
    
    // Sync each board's recent activity
    let successCount = 0;
    let failureCount = 0;

    for (const board of boards) {
      try {
        // For simplicity, sync all cards
        // In production, you would use Trello's activity endpoints
        await syncCards(board);
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        logger.error(`Failed to sync recent activity for board ${board.name}:`, error);
        // Continue with other boards
      }
    }
    
    logger.info('Incremental sync completed');
    return {
      processedCount: boards.length,
      successCount,
      failureCount
    };
  } catch (error) {
    logger.error('Failed to sync recent activity:', error);
    throw error;
  }
};

// Set up webhooks for real-time updates
const setupWebhooks = async () => {
  try {
    const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;
    if (!callbackUrl) {
      logger.warn('Webhook callback URL not configured, skipping webhook setup');
      return;
    }
    
    logger.info('Setting up webhooks...');
    
    // Get existing webhooks
    const existingWebhooks = await trelloClient.webhookApi.getWebhooks();
    logger.info(`Found ${existingWebhooks.length} existing webhooks`);
    
    // Get all boards
    const boards = await Board.find(defaultWorkspaceQuery({ closed: false }));
    
    // Set up webhooks for each board
    for (const board of boards) {
      // Check if webhook already exists
      const webhookExists = existingWebhooks.some(webhook => 
        webhook.idModel === board.trelloId
      );
      
      if (!webhookExists) {
        try {
          await trelloClient.webhookApi.createWebhook(
            callbackUrl,
            board.trelloId,
            `Sneup webhook for board: ${board.name}`
          );
          logger.info(`Created webhook for board: ${board.name}`);
        } catch (error) {
          logger.error(`Failed to create webhook for board ${board.name}:`, error);
        }
      }
    }
    
    logger.info('Webhooks setup completed');
  } catch (error) {
    logger.error('Failed to set up webhooks:', error);
  }
};

// Handle webhook events
const handleWebhookEvent = async (event) => jobObservabilityService.trackJob({
  jobName: 'trello.webhook_event',
  jobType: 'webhook',
  triggerType: 'webhook',
  metadata: {
    actionType: event?.action?.type,
    modelId: event?.model?.id
  }
}, async () => {
  try {
    logger.info(`Received webhook event: ${event.action.type}`);
    
    // Determine the board affected by this event
    const boardId = event.model.id;
    
    // Find the board in database
    const board = await Board.findOne({ trelloId: boardId });
    
    if (!board) {
      logger.warn(`Board not found for webhook event: ${boardId}`);
      return {
        processedCount: 1,
        successCount: 0,
        failureCount: 1,
        metadata: { skippedReason: 'board_not_found' }
      };
    }
    
    // Sync the board to capture changes
    await syncBoard(boardId, { workspaceId: board.workspaceId });
    
    logger.info(`Webhook event processed for board: ${board.name}`);
    return {
      processedCount: 1,
      successCount: 1,
      failureCount: 0,
      metadata: { boardId: board._id }
    };
  } catch (error) {
    logger.error('Failed to handle webhook event:', error);
    throw error;
  }
});

module.exports = {
  initSync,
  syncAllBoards,
  syncBoard,
  syncRecentActivity,
  handleWebhookEvent
};
