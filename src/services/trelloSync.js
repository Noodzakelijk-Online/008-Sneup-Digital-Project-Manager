const logger = require('../utils/logger');
const trelloClient = require('./trelloClient');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Comment = require('../models/Comment');
const schedule = require('node-schedule');
const jobObservabilityService = require('./jobObservabilityService');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const DEFAULT_BOARD_SYNC_CONCURRENCY = 2;
const MAX_BOARD_SYNC_CONCURRENCY = 4;
const boardSyncQueues = new Map();
const memberSyncQueues = new Map();

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length || 1);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
};

const getBoardSyncConcurrency = (value = process.env.SNEUP_TRELLO_BOARD_SYNC_CONCURRENCY) =>
  clampInteger(value, DEFAULT_BOARD_SYNC_CONCURRENCY, 1, MAX_BOARD_SYNC_CONCURRENCY);

const runSerialized = async (queues, key, callback) => {
  const previous = queues.get(key) || Promise.resolve();
  const queued = previous.catch(() => undefined).then(callback);
  queues.set(key, queued);

  try {
    return await queued;
  } finally {
    if (queues.get(key) === queued) queues.delete(key);
  }
};

/**
 * Trello Synchronization Service
 * Handles syncing data from Trello to local database
 */

// Initialize synchronization
const initSync = async () => {
  try {
    logger.info('Initializing Trello synchronization...');
    const workspaceId = normalizeWorkspaceObjectId(getDefaultWorkspaceObjectId());
    
    // Initialize Trello client
    trelloClient.initTrelloClient();
    
    // Perform initial full sync
    await jobObservabilityService.trackJob({
      jobName: 'trello.full_sync',
      jobType: 'sync',
      triggerType: 'startup',
      workspaceId
    }, () => syncAllBoards({ workspaceId }));
    
    // Schedule regular syncs
    scheduleSync(workspaceId);
    
    // Set up webhooks for real-time updates
    await setupWebhooks(workspaceId);
    
    logger.info('Trello synchronization initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Trello synchronization:', error);
    throw error;
  }
};

// Schedule regular synchronization jobs
const scheduleSync = (workspaceId = normalizeWorkspaceObjectId(getDefaultWorkspaceObjectId())) => {
  // Full sync daily at 1 AM
  const fullSyncCron = process.env.FULL_SYNC_CRON || '0 1 * * *';
  schedule.scheduleJob(fullSyncCron, async () => {
    logger.info('Running scheduled full sync');
    await jobObservabilityService.trackJob({
      jobName: 'trello.full_sync',
      jobType: 'sync',
      triggerType: 'scheduled',
      workspaceId
    }, () => syncAllBoards({ workspaceId }));
  });
  
  // Incremental sync every 15 minutes
  const incrementalSyncCron = process.env.INCREMENTAL_SYNC_CRON || '*/15 * * * *';
  schedule.scheduleJob(incrementalSyncCron, async () => {
    logger.info('Running scheduled incremental sync');
    await jobObservabilityService.trackJob({
      jobName: 'trello.incremental_sync',
      jobType: 'sync',
      triggerType: 'scheduled',
      workspaceId
    }, () => syncRecentActivity({ workspaceId }));
  });
  
  logger.info('Sync schedules configured');
};

// Sync all boards
const syncAllBoards = async (options = {}) => {
  try {
    logger.info('Starting full sync of all boards');
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    // Get all boards from Trello
    const trelloBoards = await trelloClient.boardApi.getBoards();
    logger.info(`Found ${trelloBoards.length} boards in Trello`);
    
    // Keep a small board pool so large workspaces finish promptly without flooding Trello.
    const boardSyncConcurrency = getBoardSyncConcurrency(options.concurrency);
    const syncOneBoard = options.syncBoard || syncBoard;
    const outcomes = await mapWithConcurrency(trelloBoards, boardSyncConcurrency, async (trelloBoard) => {
      try {
        await syncOneBoard(trelloBoard.id, { workspaceId });
        return { succeeded: true };
      } catch (error) {
        logger.error(`Failed to sync board ${trelloBoard.id}:`, error);
        // Continue with other boards
        return { succeeded: false };
      }
    });
    const successCount = outcomes.filter(outcome => outcome.succeeded).length;
    const failureCount = outcomes.length - successCount;
    
    logger.info('Full sync completed');
    return {
      processedCount: trelloBoards.length,
      successCount,
      failureCount,
      metadata: {
        trelloBoardCount: trelloBoards.length,
        boardSyncConcurrency,
        workspaceId: String(workspaceId)
      }
    };
  } catch (error) {
    logger.error('Failed to sync all boards:', error);
    throw error;
  }
};

// Sync a specific board
const syncBoardNow = async (boardId, options = {}) => {
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

const syncBoard = async (boardId, options = {}) => {
  const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
  const key = `${workspaceId}:${String(boardId)}`;
  const syncOneBoard = options.syncBoardNow || syncBoardNow;
  return runSerialized(boardSyncQueues, key, () => syncOneBoard(boardId, { ...options, workspaceId }));
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
      const memberKey = `${board.workspaceId}:${trelloMember.id}`;
      const member = await runSerialized(memberSyncQueues, memberKey, async () => {
        let existing = await Member.findOne({ trelloId: trelloMember.id, workspaceId: board.workspaceId });

        if (!existing) {
          existing = new Member({
            trelloId: trelloMember.id,
            username: trelloMember.username,
            fullName: trelloMember.fullName,
            avatarUrl: trelloMember.avatarUrl,
            email: trelloMember.email,
            workspaceId: board.workspaceId,
            boards: [board._id]
          });
        } else {
          existing.username = trelloMember.username;
          existing.fullName = trelloMember.fullName;
          existing.avatarUrl = trelloMember.avatarUrl;
          existing.workspaceId = board.workspaceId;

          if (!existing.boards.some(existingBoard => existingBoard.toString() === board._id.toString())) {
            existing.boards.push(board._id);
          }
        }

        existing.lastSync = new Date();
        await existing.save();
        return existing;
      });
      
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
            
            // Atomic membership updates avoid lost assignments when two boards share a worker.
            await Member.updateOne(
              { _id: member._id, workspaceId: board.workspaceId },
              { $addToSet: { assignedCards: card._id } }
            );
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
const syncRecentActivity = async (options = {}) => {
  try {
    logger.info('Starting incremental sync');
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    // Get all boards
    const boards = await Board.find({ workspaceId, closed: false });
    
    const boardSyncConcurrency = getBoardSyncConcurrency(options.concurrency);
    const syncBoardCards = options.syncCards || syncCards;
    const outcomes = await mapWithConcurrency(boards, boardSyncConcurrency, async (board) => {
      try {
        // Incremental sync retains its existing card-only scope while sharing the bounded board pool.
        await syncBoardCards(board);
        return { succeeded: true };
      } catch (error) {
        logger.error(`Failed to sync recent activity for board ${board.name}:`, error);
        // Continue with other boards
        return { succeeded: false };
      }
    });
    const successCount = outcomes.filter(outcome => outcome.succeeded).length;
    const failureCount = outcomes.length - successCount;
    
    logger.info('Incremental sync completed');
    return {
      processedCount: boards.length,
      successCount,
      failureCount,
      metadata: {
        trelloBoardCount: boards.length,
        boardSyncConcurrency,
        workspaceId: String(workspaceId)
      }
    };
  } catch (error) {
    logger.error('Failed to sync recent activity:', error);
    throw error;
  }
};

// Set up webhooks for real-time updates
const setupWebhooks = async (workspaceId = normalizeWorkspaceObjectId(getDefaultWorkspaceObjectId())) => {
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
    const boards = await Board.find({ workspaceId, closed: false });
    
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
const handleWebhookEvent = async (event) => {
  const workspaceId = normalizeWorkspaceObjectId(getDefaultWorkspaceObjectId());
  return jobObservabilityService.trackJob({
    jobName: 'trello.webhook_event',
    jobType: 'webhook',
    triggerType: 'webhook',
    workspaceId,
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
    const board = await Board.findOne({ trelloId: boardId, workspaceId });
    
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
};

module.exports = {
  initSync,
  syncAllBoards,
  syncBoard,
  syncRecentActivity,
  handleWebhookEvent,
  getBoardSyncConcurrency,
  mapWithConcurrency,
  runSerialized
};
