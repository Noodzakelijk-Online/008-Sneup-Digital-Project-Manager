const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { safeExternalSourceUrl } = require('../utils/externalSourceUrl');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Analytics = require('../models/Analytics');
const Intervention = require('../models/Intervention');
const analyticsService = require('./analyticsService');
const interventionEngine = require('./interventionEngine');
const operationsLedgerService = require('./operationsLedgerService');
const trelloSync = require('./trelloSync');
const workGraphService = require('./workGraphService');
const forecastService = require('./forecastService');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const HOURS_PER_DAY = 24;
const MAX_COMMAND_QUEUE = 12;
const MISSION_FORECAST_TTL_MS = 15000;
const MAX_MISSION_FORECAST_CACHE_ENTRIES = 50;

class AutopilotService {
  constructor() {
    this.missionForecastCache = new Map();
  }

  isDemoMode() {
    return process.env.SNEUP_DEMO_MODE === 'true' || mongoose.connection.readyState !== 1;
  }

  async getMissionControl(options = {}) {
    if (this.isDemoMode()) {
      return this.getDemoMissionControl();
    }

    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId);
      const [boards, cards, members, interventions, graphDecisionResult, forecast] = await Promise.all([
        Board.find({ workspaceId, closed: false })
          .select('_id trelloId name url lastSync updatedAt')
          .sort({ name: 1 })
          .lean(),
        Card.find({ workspaceId, closed: false })
          .select('_id trelloId name boardId listId members due dueComplete closed riskLevel riskFactors labels checklists lastActivity updatedAt createdAt')
          .populate({ path: 'boardId', select: '_id trelloId name url' })
          .populate({ path: 'listId', select: '_id name' })
          .populate({ path: 'members', select: '_id username fullName' })
          .sort({ due: 1, riskLevel: -1 })
          .lean(),
        Member.find({ workspaceId })
          .select('_id trelloId username fullName workloadLevel specialties updatedAt')
          .sort({ username: 1 })
          .lean(),
        Intervention.find({ workspaceId, status: { $in: ['pending', 'failed'] } })
          .select('_id boardId cardId memberId type severity action status updatedAt createdAt')
          .populate({ path: 'boardId', select: '_id name' })
          .populate({ path: 'memberId', select: '_id username' })
          .sort({ severity: -1, createdAt: 1 })
          .limit(25)
          .lean(),
        workGraphService.listDecisionCandidates({ workspaceId, limit: 25 }),
        this.getMissionControlForecast(workspaceId)
      ]);
      const graphCandidates = graphDecisionResult.candidates || [];

      const analyticsByBoard = await this.getLatestAnalyticsByBoard(boards, { workspaceId });
      const listsByBoard = await this.getListsByBoard(boards, { workspaceId });
      const cardIndex = this.buildCardIndex(cards);
      const boardSummaries = this.buildBoardSummaries(boards, cardIndex, analyticsByBoard, listsByBoard);
      const teamLoad = this.mergeForecastCapacity(this.buildTeamLoad(members, cardIndex), forecast);
      const focus = this.buildFocusQueue(cards);
      const risks = this.buildRiskRadar(cards, analyticsByBoard, graphCandidates, teamLoad);
      const commandQueue = this.buildCommandQueue({
        cards,
        boardSummaries,
        teamLoad,
        interventions,
        graphCandidates,
        forecast
      });
      const dailyPlan = this.buildDailyPlan(focus, commandQueue, risks);

      return {
        mode: 'live',
        generatedAt: new Date(),
        autonomy: this.getAutonomyState(false),
        signals: this.buildSignals(boardSummaries, cards, teamLoad, risks, graphCandidates),
        boardSummaries,
        focus,
        commandQueue,
        dailyPlan,
        teamLoad,
        risks,
        brief: this.buildBrief(boardSummaries, focus, commandQueue, risks)
      };
    } catch (error) {
      logger.error('Failed to build mission control snapshot:', error);
      throw error;
    }
  }

  async getMissionControlForecast(workspaceId) {
    const cacheKey = String(workspaceId);
    const cached = this.missionForecastCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < MISSION_FORECAST_TTL_MS) return cached.forecast;

    try {
      const forecast = await forecastService.getForecast({ workspaceId });
      this.missionForecastCache.set(cacheKey, { forecast, generatedAt: Date.now() });
      while (this.missionForecastCache.size > MAX_MISSION_FORECAST_CACHE_ENTRIES) {
        this.missionForecastCache.delete(this.missionForecastCache.keys().next().value);
      }
      return forecast;
    } catch (error) {
      logger.warn('Capacity forecast was unavailable for mission control; continuing without capacity commands.', { workspaceId });
      return null;
    }
  }

  invalidateMissionControlForecast(workspaceId) {
    this.missionForecastCache.delete(String(workspaceId));
  }

  async runAutopilot(options = {}) {
    const execute = options.execute === true || process.env.AUTOPILOT_MODE === 'control';
    const sync = options.sync === true;

    if (this.isDemoMode()) {
      const snapshot = this.getDemoMissionControl();
      return {
        success: true,
        mode: 'demo',
        dryRun: true,
        generatedAt: new Date(),
        executed: [],
        skipped: snapshot.commandQueue,
        snapshot
      };
    }

    const run = {
      success: true,
      mode: execute ? 'control' : 'advisory',
      dryRun: !execute,
      generatedAt: new Date(),
      syncedBoards: [],
      analyticsGenerated: [],
      executed: [],
      skipped: []
    };

    try {
      const workspaceId = normalizeWorkspaceObjectId(options.workspaceId);
      const boards = await Board.find({ workspaceId, closed: false }).sort({ name: 1 });

      for (const board of boards) {
        if (sync) {
          try {
            await trelloSync.syncBoard(board.trelloId, { workspaceId });
            run.syncedBoards.push({ id: board._id, name: board.name });
          } catch (error) {
            run.success = false;
            run.skipped.push({
              type: 'sync_failed',
              boardId: board._id,
              boardName: board.name,
              reason: error.message
            });
          }
        }

        try {
          const analytics = await analyticsService.generateBoardAnalytics(board._id, { workspaceId });
          if (analytics) {
            run.analyticsGenerated.push({ id: board._id, name: board.name });
          }
        } catch (error) {
          run.success = false;
          run.skipped.push({
            type: 'analytics_failed',
            boardId: board._id,
            boardName: board.name,
            reason: error.message
          });
        }

        if (execute) {
          try {
            const interventions = await interventionEngine.processInterventions(board._id, { workspaceId });
            run.executed.push({
              boardId: board._id,
              boardName: board.name,
              count: interventions ? interventions.length : 0
            });
          } catch (error) {
            run.success = false;
            run.skipped.push({
              type: 'intervention_failed',
              boardId: board._id,
              boardName: board.name,
              reason: error.message
            });
          }
        }
      }

      const snapshot = await this.getMissionControl({ workspaceId: options.workspaceId });
      run.snapshot = snapshot;
      if (!execute) {
        run.skipped.push(...snapshot.commandQueue);
      }

      return run;
    } catch (error) {
      logger.error('Autopilot run failed:', error);
      throw error;
    }
  }

  async queueCommandForApproval(command, options = {}) {
    return operationsLedgerService.createRecommendationFromAutopilotCommand(command, {
      actor: options.actor || 'robert',
      workspaceId: options.workspaceId
    });
  }

  async queueMissionControlCommands(options = {}) {
    if (this.isDemoMode()) {
      const error = new Error('Live MongoDB data is required before autopilot commands can be queued for approval');
      error.statusCode = 503;
      throw error;
    }

    const snapshot = await this.getMissionControl({ workspaceId: options.workspaceId });
    const commands = (snapshot.commandQueue || []).slice(0, options.limit || MAX_COMMAND_QUEUE);
    const queued = [];

    for (const command of commands) {
      queued.push(await this.queueCommandForApproval(command, options));
    }

    return {
      snapshotGeneratedAt: snapshot.generatedAt,
      count: queued.length,
      queued
    };
  }

  async getLatestAnalyticsByBoard(boards, options = {}) {
    const analyticsByBoard = {};
    const boardIds = boards.map(board => board._id);
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || boards[0]?.workspaceId);

    if (boardIds.length === 0) return analyticsByBoard;

    const analyticsRecords = await Analytics.find({ workspaceId, boardId: { $in: boardIds } })
      .select('_id boardId date updatedAt createdAt velocity projectHealth bottlenecks')
      .sort({ boardId: 1, date: -1 })
      .lean();

    for (const analytics of analyticsRecords) {
      const boardId = analytics.boardId.toString();
      if (!analyticsByBoard[boardId]) {
        analyticsByBoard[boardId] = analytics;
      }
    }

    return analyticsByBoard;
  }

  async getListsByBoard(boards, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || boards[0]?.workspaceId);
    if (boards.length === 0) return {};

    const lists = await List.find({
      workspaceId,
      boardId: { $in: boards.map(board => board._id) },
      closed: false
    })
      .select('_id boardId name position averageTimeInList')
      .sort({ position: 1 })
      .lean();

    return lists.reduce((grouped, list) => {
      const boardId = list.boardId.toString();
      if (!grouped[boardId]) {
        grouped[boardId] = [];
      }
      grouped[boardId].push(list);
      return grouped;
    }, {});
  }

  buildCardIndex(cards) {
    const index = {
      byBoard: new Map(),
      byList: new Map(),
      byMember: new Map()
    };

    for (const card of cards) {
      this.pushIndexed(index.byBoard, this.toId(card.boardId), card);
      this.pushIndexed(index.byList, this.toId(card.listId), card);

      for (const member of card.members || []) {
        this.pushIndexed(index.byMember, this.toId(member), card);
      }
    }

    return index;
  }

  pushIndexed(map, key, value) {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(value);
  }

  buildBoardSummaries(boards, cardIndex, analyticsByBoard, listsByBoard) {
    return boards.map(board => {
      const boardId = board._id.toString();
      const boardCards = cardIndex.byBoard.get(boardId) || [];
      const overdueCards = boardCards.filter(card => this.isCardOverdue(card));
      const unassignedCards = boardCards.filter(card => !card.members || card.members.length === 0);
      const highRiskCards = boardCards.filter(card => ['high', 'critical'].includes(card.riskLevel));
      const blockedCards = boardCards.filter(card => this.hasLabel(card, 'blocked'));
      const analytics = analyticsByBoard[boardId];
      const lists = listsByBoard[boardId] || [];
      const health = analytics?.projectHealth?.overall || this.estimateBoardHealth(boardCards, overdueCards, highRiskCards);

      return {
        id: board._id,
        name: board.name,
        url: board.url,
        health,
        activeCards: boardCards.length,
        overdueCards: overdueCards.length,
        highRiskCards: highRiskCards.length,
        blockedCards: blockedCards.length,
        unassignedCards: unassignedCards.length,
        flow: this.buildFlow(lists, cardIndex),
        velocity: {
          cardsPerWeek: analytics?.velocity?.cardsPerWeek || 0,
          cardsPerDay: Number((analytics?.velocity?.cardsPerDay || 0).toFixed(2))
        },
        riskFactors: analytics?.projectHealth?.riskFactors || [],
        sourceEvidence: this.buildBoardEvidence(board, 'Board health, flow, and risk summary')
      };
    });
  }

  buildFlow(lists, cardIndex) {
    return lists.map(list => ({
      id: list._id,
      name: list.name,
      count: (cardIndex.byList.get(list._id.toString()) || []).length,
      averageTimeInList: Number((list.averageTimeInList || 0).toFixed(1)),
      done: this.isDoneList(list)
    }));
  }

  buildTeamLoad(members, cardIndex) {
    return members.map(member => {
      const assignedCards = cardIndex.byMember.get(member._id.toString()) || [];
      const urgentCards = assignedCards.filter(card => this.calculatePriorityScore(card) >= 75);
      const overdueCards = assignedCards.filter(card => this.isCardOverdue(card));
      const score = assignedCards.length + overdueCards.length * 2 + urgentCards.length;

      return {
        id: member._id,
        username: member.username,
        fullName: member.fullName,
        workloadLevel: member.workloadLevel,
        assignedCards: assignedCards.length,
        urgentCards: urgentCards.length,
        overdueCards: overdueCards.length,
        specialties: member.specialties || [],
        loadScore: score,
        capacityState: this.getCapacityState(score)
      };
    }).sort((a, b) => b.loadScore - a.loadScore);
  }

  mergeForecastCapacity(teamLoad, forecast) {
    const byMemberId = new Map((forecast?.memberCapacity || []).map(member => [String(member.memberId), member]));
    return teamLoad.map(member => {
      const capacity = byMemberId.get(String(member.id));
      return capacity ? {
        ...member,
        weeklyAvailableHours: capacity.weeklyAvailableHours,
        scheduledAllocationWeeklyHours: capacity.scheduledAllocationWeeklyHours,
        scheduledAllocationProvidersNext28Days: capacity.scheduledAllocationProvidersNext28Days || []
      } : member;
    });
  }

  buildFocusQueue(cards) {
    return cards
      .map(card => ({
        id: card._id,
        name: card.name,
        boardName: card.boardId?.name || 'Unknown board',
        listName: card.listId?.name || 'Unknown list',
        members: (card.members || []).map(member => member.username || member.fullName),
        due: card.due,
        riskLevel: card.riskLevel || 'none',
        priorityScore: this.calculatePriorityScore(card),
        reasons: this.getPriorityReasons(card),
        sourceEvidence: this.buildCardEvidence(card, 'Priority score and focus queue position')
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10);
  }

  buildRiskRadar(cards, analyticsByBoard, graphCandidates = [], teamLoad = []) {
    const cardRisks = cards
      .flatMap(card => this.getCardRisks(card))
      .sort((a, b) => b.score - a.score);

    const boardRisks = Object.values(analyticsByBoard).flatMap(analytics =>
      (analytics.bottlenecks || []).map(bottleneck => ({
        id: `bottleneck-${analytics.boardId}-${bottleneck.listId}`,
        type: 'flow_bottleneck',
        severity: bottleneck.severity || 'medium',
        title: `Bottleneck in ${bottleneck.listName}`,
        boardId: analytics.boardId,
        score: bottleneck.severity === 'high' ? 90 : 65,
        detail: `${bottleneck.cardCount || 0} cards averaging ${Math.round(bottleneck.averageTimeInList || 0)} hours`,
        sourceEvidence: this.buildEvidenceRefs([{
          type: 'analytics',
          entityId: analytics._id,
          label: `Bottleneck in ${bottleneck.listName}`,
          observedAt: analytics.date || analytics.updatedAt || analytics.createdAt,
          data: {
            reason: 'Analytics bottleneck detection',
            boardId: analytics.boardId,
            listId: bottleneck.listId,
            cardCount: bottleneck.cardCount,
            averageTimeInList: bottleneck.averageTimeInList
          }
        }])
      }))
    );

    const graphRisks = graphCandidates.map(candidate => ({
      id: `graph-${candidate.workItemId || candidate.actionPayload?.externalId || candidate.title}`,
      type: candidate.findingType,
      severity: candidate.riskLevel,
      title: candidate.title,
      boardName: candidate.sourceProvider || candidate.actionPayload?.sourceProvider || 'Work graph',
      score: candidate.graphScore || this.severityScore(candidate.riskLevel) * 20,
      detail: candidate.description,
      sourceEvidence: candidate.sourceEvidence || []
    }));

    const capacityRisks = teamLoad.map(member => {
      const risk = this.getScheduledCapacityRisk(member);
      if (!risk) return null;
      return {
        id: `scheduled-capacity-${member.id}`,
        type: 'scheduled_capacity_risk',
        severity: risk.ratio > 1.5 ? 'critical' : 'high',
        title: `${member.fullName || member.username || 'Team member'} has overbooked scheduled capacity`,
        boardName: 'Capacity forecast',
        score: Math.min(99, Math.round(70 + risk.ratio * 15)),
        detail: `${risk.scheduledHours}h/week scheduled against ${risk.availableHours}h/week available`,
        sourceEvidence: this.buildCapacityEvidence(member, risk)
      };
    }).filter(Boolean);

    return [...cardRisks, ...boardRisks, ...graphRisks, ...capacityRisks].sort((a, b) => b.score - a.score).slice(0, 12);
  }

  buildCommandQueue({ cards, boardSummaries, teamLoad, interventions, graphCandidates = [], forecast = null }) {
    const commands = [];

    for (const card of cards) {
      const score = this.calculatePriorityScore(card);
      const primaryMember = card.members && card.members[0];

      if (this.isCardOverdue(card)) {
        commands.push(this.createCommand({
          type: 'escalate_overdue',
          severity: 'critical',
          title: `Recover overdue card: ${card.name}`,
          target: card.boardId?.name || 'Unknown board',
          owner: primaryMember?.username || 'Unassigned',
          reason: 'Due date passed and work is still open',
          automatable: true,
          sourceEvidence: this.buildCardEvidence(card, 'Overdue open card'),
          payload: { cardId: card._id, trelloId: card.trelloId }
        }));
      }

      if (!card.members || card.members.length === 0) {
        commands.push(this.createCommand({
          type: 'assign_owner',
          severity: 'high',
          title: `Assign an owner: ${card.name}`,
          target: card.boardId?.name || 'Unknown board',
          owner: 'Sneup',
          reason: 'Unowned work has no accountable path to completion',
          automatable: true,
          sourceEvidence: this.buildCardEvidence(card, 'Card has no assigned owner'),
          payload: { cardId: card._id, trelloId: card.trelloId }
        }));
      }

      if (score >= 75 && !this.isCardOverdue(card)) {
        commands.push(this.createCommand({
          type: 'focus_now',
          severity: 'high',
          title: `Move into today's focus: ${card.name}`,
          target: card.boardId?.name || 'Unknown board',
          owner: primaryMember?.username || 'Unassigned',
          reason: this.getPriorityReasons(card).join(', '),
          automatable: false,
          sourceEvidence: this.buildCardEvidence(card, 'High priority focus candidate'),
          payload: { cardId: card._id, trelloId: card.trelloId }
        }));
      }

      if (this.daysSince(card.lastActivity) > 5) {
        commands.push(this.createCommand({
          type: 'request_update',
          severity: 'medium',
          title: `Request a crisp update: ${card.name}`,
          target: card.boardId?.name || 'Unknown board',
          owner: primaryMember?.username || 'Unassigned',
          reason: `No activity for ${this.daysSince(card.lastActivity)} days`,
          automatable: true,
          sourceEvidence: this.buildCardEvidence(card, 'Stale card activity'),
          payload: { cardId: card._id, trelloId: card.trelloId }
        }));
      }
    }

    for (const member of teamLoad) {
      const scheduledCapacityRisk = this.getScheduledCapacityRisk(member);
      if (scheduledCapacityRisk) {
        commands.push(this.createCommand({
          type: 'review_scheduled_capacity',
          severity: scheduledCapacityRisk.ratio > 1.5 ? 'critical' : 'high',
          title: `Review ${member.username || member.fullName || 'team member'}'s scheduled capacity`,
          target: member.fullName || member.username || 'Team member',
          owner: 'Sneup',
          reason: `Mapped schedules reserve ${scheduledCapacityRisk.scheduledHours}h/week against ${scheduledCapacityRisk.availableHours}h/week available (${scheduledCapacityRisk.percent}% of capacity).`,
          automatable: false,
          sourceEvidence: this.buildCapacityEvidence(member, scheduledCapacityRisk),
          payload: {
            memberId: member.id,
            scheduledAllocationWeeklyHours: scheduledCapacityRisk.scheduledHours,
            weeklyAvailableHours: scheduledCapacityRisk.availableHours,
            scheduledAllocationProviders: member.scheduledAllocationProvidersNext28Days || [],
            forecastGeneratedAt: forecast?.generatedAt || null
          }
        }));
      }
      if (member.capacityState === 'overloaded' && !scheduledCapacityRisk) {
        commands.push(this.createCommand({
          type: 'rebalance_workload',
          severity: 'high',
          title: `Rebalance ${member.username}'s workload`,
          target: member.fullName || member.username,
          owner: 'Sneup',
          reason: `${member.assignedCards} active cards with ${member.urgentCards} urgent`,
          automatable: true,
          sourceEvidence: this.buildMemberEvidence(member, 'Overloaded member workload'),
          payload: { memberId: member.id }
        }));
      }
    }

    for (const board of boardSummaries) {
      if (board.health === 'critical' || board.health === 'at_risk') {
        commands.push(this.createCommand({
          type: 'board_recovery',
          severity: board.health === 'critical' ? 'critical' : 'high',
          title: `Run recovery plan for ${board.name}`,
          target: board.name,
          owner: 'Sneup',
          reason: board.riskFactors.length > 0 ? board.riskFactors.join(', ') : 'Board health is degraded',
          automatable: false,
          sourceEvidence: board.sourceEvidence || this.buildBoardEvidence(board, 'Board recovery command'),
          payload: { boardId: board.id }
        }));
      }
    }

    for (const intervention of interventions) {
      commands.push(this.createCommand({
        type: 'retry_intervention',
        severity: intervention.severity,
        title: intervention.action,
        target: intervention.boardId?.name || 'Unknown board',
        owner: intervention.memberId?.username || 'Sneup',
        reason: intervention.status === 'failed' ? 'Prior automation failed' : 'Pending automation waiting',
        automatable: true,
        sourceEvidence: this.buildInterventionEvidence(intervention, 'Pending or failed intervention'),
        payload: { interventionId: intervention._id }
      }));
    }

    for (const candidate of graphCandidates) {
      commands.push(this.createGraphDecisionCommand(candidate));
    }

    return commands
      .sort((a, b) => this.commandScore(b) - this.commandScore(a))
      .slice(0, MAX_COMMAND_QUEUE);
  }

  createGraphDecisionCommand(candidate) {
    const dependencySummary = candidate.dependencySummary || candidate.actionPayload?.dependencySummary || {};
    const dependencyReason = dependencySummary.blockingCount
      ? `Blocking ${dependencySummary.blockingCount} downstream graph item${dependencySummary.blockingCount === 1 ? '' : 's'}`
      : dependencySummary.blockedByCount
        ? `Blocked by ${dependencySummary.blockedByCount} graph dependenc${dependencySummary.blockedByCount === 1 ? 'y' : 'ies'}`
        : 'Graph decision candidate';

    return this.createCommand({
      type: 'graph_decision',
      severity: candidate.riskLevel || 'medium',
      title: candidate.title,
      target: candidate.sourceProvider || candidate.actionPayload?.sourceProvider || 'Work graph',
      owner: candidate.ownerType || 'team',
      reason: `${candidate.description || candidate.recommendedAction || dependencyReason} ${dependencyReason}.`.trim(),
      automatable: false,
      graphScore: candidate.graphScore || 0,
      sourceEvidence: candidate.sourceEvidence || [],
      payload: {
        source: 'work_graph',
        workItemId: candidate.workItemId,
        findingType: candidate.findingType,
        ownerType: candidate.ownerType,
        recommendedAction: candidate.recommendedAction,
        actionType: candidate.actionType,
        confidence: candidate.confidence,
        sourceProvider: candidate.sourceProvider || candidate.actionPayload?.sourceProvider,
        externalId: candidate.externalId || candidate.actionPayload?.externalId,
        canonicalKey: candidate.canonicalKey || candidate.actionPayload?.canonicalKey,
        providerUrl: candidate.providerUrl || candidate.actionPayload?.providerUrl,
        dependencySummary,
        actionPayload: {
          ...(candidate.actionPayload || {}),
          externalProviderWriteBlocked: true,
          executable: false,
          draftOnly: true
        },
        sourceEvidence: candidate.sourceEvidence || []
      }
    });
  }

  buildDailyPlan(focus, commands, risks) {
    const now = new Date();
    const criticalCommands = commands.filter(command => command.severity === 'critical');
    const automatableCommands = commands.filter(command => command.automatable);

    return {
      date: now,
      firstHour: [
        criticalCommands.length > 0 ? `Resolve ${criticalCommands.length} critical command${criticalCommands.length === 1 ? '' : 's'}` : 'Confirm no critical command is waiting',
        focus[0] ? `Protect focus for ${focus[0].name}` : 'Load work from Trello and generate the first focus queue',
        risks.length > 0 ? `Remove the top risk: ${risks[0].title}` : 'Keep the risk radar clean'
      ],
      standup: focus.slice(0, 5).map(item => ({
        cardId: item.id,
        cardName: item.name,
        boardName: item.boardName,
        owner: item.members.length > 0 ? item.members.join(', ') : 'Unassigned',
        ask: item.reasons[0] || 'Confirm next step',
        sourceEvidence: item.sourceEvidence || []
      })),
      automation: {
        ready: automatableCommands.length,
        reviewRequired: commands.length - automatableCommands.length,
        nextRun: 'Every 15 minutes for sync, hourly for analytics, continuous for webhook events'
      }
    };
  }

  buildSignals(boardSummaries, cards, teamLoad, risks, graphCandidates = []) {
    return {
      boards: boardSummaries.length,
      activeCards: cards.length,
      overdueCards: cards.filter(card => this.isCardOverdue(card)).length,
      highRiskCards: cards.filter(card => ['high', 'critical'].includes(card.riskLevel)).length,
      unassignedCards: cards.filter(card => !card.members || card.members.length === 0).length,
      overloadedMembers: teamLoad.filter(member => member.capacityState === 'overloaded').length,
      scheduledCapacityRisks: teamLoad.filter(member => this.getScheduledCapacityRisk(member)).length,
      activeRisks: risks.length,
      graphDecisions: graphCandidates.length
    };
  }

  buildBrief(boardSummaries, focus, commands, risks) {
    const criticalBoards = boardSummaries.filter(board => board.health === 'critical');
    const atRiskBoards = boardSummaries.filter(board => board.health === 'at_risk');
    const firstFocus = focus[0]?.name || 'No active focus item';
    const criticalCommands = commands.filter(command => command.severity === 'critical').length;

    return {
      headline: criticalBoards.length > 0
        ? `${criticalBoards.length} board${criticalBoards.length === 1 ? ' needs' : 's need'} recovery`
        : atRiskBoards.length > 0
          ? `${atRiskBoards.length} board${atRiskBoards.length === 1 ? ' needs' : 's need'} attention`
          : 'Portfolio is under control',
      narrative: `Top focus is "${firstFocus}". ${criticalCommands} critical command${criticalCommands === 1 ? '' : 's'} and ${risks.length} active risk${risks.length === 1 ? '' : 's'} are on the radar.`,
      decision: commands[0]?.title || 'Keep monitoring and refresh the plan after the next sync',
      confidence: this.calculateConfidence(boardSummaries, focus, commands)
    };
  }

  calculateConfidence(boardSummaries, focus, commands) {
    if (boardSummaries.length === 0) return 0;
    let confidence = 82;
    confidence -= commands.filter(command => command.severity === 'critical').length * 8;
    confidence -= commands.filter(command => command.severity === 'high').length * 3;
    confidence += Math.min(focus.length, 5);
    return Math.max(20, Math.min(98, confidence));
  }

  createCommand(command) {
    return {
      id: `${command.type}-${command.payload.cardId || command.payload.memberId || command.payload.boardId || command.payload.interventionId || command.payload.workItemId || command.payload.externalId || command.payload.canonicalKey || Math.random().toString(36).slice(2)}`,
      status: command.automatable ? 'ready' : 'review',
      minutesSaved: command.automatable ? this.estimateMinutesSaved(command.type) : 0,
      ...command
    };
  }

  commandScore(command) {
    return this.severityScore(command.severity) * 100 + (command.graphScore || 0);
  }

  getPriorityReasons(card) {
    const reasons = [];

    if (this.isCardOverdue(card)) {
      reasons.push('overdue');
    }

    const daysUntilDue = this.daysUntil(card.due);
    if (daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 2) {
      reasons.push(daysUntilDue === 0 ? 'due today' : `due in ${daysUntilDue} days`);
    }

    if (card.riskLevel && card.riskLevel !== 'none') {
      reasons.push(`${card.riskLevel} risk`);
    }

    if (!card.members || card.members.length === 0) {
      reasons.push('unassigned');
    }

    if (this.hasLabel(card, 'blocked')) {
      reasons.push('blocked');
    }

    const daysInactive = this.daysSince(card.lastActivity);
    if (daysInactive > 5) {
      reasons.push(`${daysInactive} days inactive`);
    }

    return reasons.length > 0 ? reasons : ['highest available leverage'];
  }

  getCardRisks(card) {
    const risks = [];

    if (this.isCardOverdue(card)) {
      risks.push({
        id: `overdue-${card._id}`,
        type: 'overdue',
        severity: 'critical',
        title: card.name,
        boardName: card.boardId?.name || 'Unknown board',
        score: 100,
        detail: `Overdue by ${Math.abs(this.daysUntil(card.due))} day${Math.abs(this.daysUntil(card.due)) === 1 ? '' : 's'}`,
        sourceEvidence: this.buildCardEvidence(card, 'Overdue risk')
      });
    }

    if (card.riskLevel === 'critical' || card.riskLevel === 'high') {
      risks.push({
        id: `risk-${card._id}`,
        type: 'delivery_risk',
        severity: card.riskLevel,
        title: card.name,
        boardName: card.boardId?.name || 'Unknown board',
        score: card.riskLevel === 'critical' ? 95 : 78,
        detail: (card.riskFactors || []).join(', ') || 'High delivery risk',
        sourceEvidence: this.buildCardEvidence(card, 'High delivery risk')
      });
    }

    if (!card.members || card.members.length === 0) {
      risks.push({
        id: `unassigned-${card._id}`,
        type: 'ownership_gap',
        severity: 'high',
        title: card.name,
        boardName: card.boardId?.name || 'Unknown board',
        score: 74,
        detail: 'No owner assigned',
        sourceEvidence: this.buildCardEvidence(card, 'Ownership gap risk')
      });
    }

    return risks;
  }

  calculatePriorityScore(card) {
    let score = 10;

    const riskScores = {
      critical: 38,
      high: 28,
      medium: 16,
      low: 8,
      none: 0
    };
    score += riskScores[card.riskLevel] || 0;

    const daysUntilDue = this.daysUntil(card.due);
    if (daysUntilDue !== null) {
      if (daysUntilDue < 0) score += 34;
      else if (daysUntilDue === 0) score += 28;
      else if (daysUntilDue <= 2) score += 22;
      else if (daysUntilDue <= 7) score += 12;
      else score += 4;
    }

    if (!card.members || card.members.length === 0) score += 18;
    if (this.hasLabel(card, 'blocked')) score += 18;
    if (this.daysSince(card.lastActivity) > 5) score += 8;
    const completionPercentage = this.getChecklistCompletionPercentage(card);
    if (completionPercentage !== null) {
      score += completionPercentage > 80 ? 8 : 0;
    }

    return Math.min(score, 100);
  }

  estimateBoardHealth(cards, overdueCards, highRiskCards) {
    if (cards.length === 0) return 'healthy';

    const overdueRatio = overdueCards.length / cards.length;
    const riskRatio = highRiskCards.length / cards.length;

    if (overdueRatio > 0.25 || riskRatio > 0.35) return 'critical';
    if (overdueRatio > 0.1 || riskRatio > 0.2) return 'at_risk';
    return 'healthy';
  }

  isDoneList(list = {}) {
    if (typeof list.isDoneList === 'function') return list.isDoneList();
    const name = String(list.name || '').toLowerCase();
    return ['done', 'complete', 'finished', 'closed', 'archive'].some(keyword => name.includes(keyword));
  }

  getChecklistCompletionPercentage(card = {}) {
    if (typeof card.completionPercentage === 'number') return card.completionPercentage;
    if (!Array.isArray(card.checklists) || card.checklists.length === 0) return null;

    let total = 0;
    let completed = 0;
    for (const checklist of card.checklists) {
      const items = Array.isArray(checklist?.items) ? checklist.items : [];
      total += items.length;
      completed += items.filter(item => item?.complete).length;
    }
    return total > 0 ? Math.round((completed / total) * 100) : null;
  }

  getAutonomyState(isControl) {
    return {
      level: isControl || process.env.AUTOPILOT_MODE === 'control' ? 'control' : 'advisory',
      canComment: true,
      canAssign: true,
      canEscalate: true,
      canMoveCards: process.env.AUTOPILOT_MODE === 'control',
      guardrails: [
        'Runs in advisory mode unless control mode is explicitly enabled',
        'Every automated action is returned in the command queue',
        'High-impact board recovery stays in review mode'
      ]
    };
  }

  getCapacityState(score) {
    if (score >= 10) return 'overloaded';
    if (score >= 6) return 'heavy';
    if (score <= 2) return 'light';
    return 'balanced';
  }

  estimateMinutesSaved(type) {
    const map = {
      escalate_overdue: 18,
      assign_owner: 12,
      request_update: 8,
      rebalance_workload: 25,
      retry_intervention: 10
    };
    return map[type] || 5;
  }

  severityScore(severity) {
    return {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    }[severity] || 0;
  }

  buildCardEvidence(card, reason) {
    if (!card) return [];
    return this.buildEvidenceRefs([{
      type: 'card',
      entityId: card._id,
      label: card.name || 'Trello card',
      url: card.url || card.shortUrl,
      observedAt: card.lastActivity || card.updatedAt || card.createdAt,
      data: {
        reason,
        trelloId: card.trelloId,
        boardId: this.toId(card.boardId),
        boardName: card.boardId?.name,
        listId: this.toId(card.listId),
        listName: card.listId?.name,
        due: card.due,
        riskLevel: card.riskLevel,
        members: (card.members || []).map(member => member.username || member.fullName || this.toId(member)).filter(Boolean)
      }
    }]);
  }

  buildBoardEvidence(board, reason) {
    if (!board) return [];
    return this.buildEvidenceRefs([{
      type: 'board',
      entityId: board._id || board.id,
      label: board.name || 'Trello board',
      url: board.url,
      observedAt: board.updatedAt || board.lastSync || new Date(),
      data: {
        reason,
        trelloId: board.trelloId,
        health: board.health,
        activeCards: board.activeCards,
        overdueCards: board.overdueCards,
        highRiskCards: board.highRiskCards,
        riskFactors: board.riskFactors || []
      }
    }]);
  }

  buildMemberEvidence(member, reason) {
    if (!member) return [];
    return this.buildEvidenceRefs([{
      type: 'member',
      entityId: member._id || member.id,
      label: member.fullName || member.username || 'Team member',
      observedAt: member.updatedAt || new Date(),
      data: {
        reason,
        trelloId: member.trelloId,
        username: member.username,
        assignedCards: member.assignedCards,
        urgentCards: member.urgentCards,
        overdueCards: member.overdueCards,
        capacityState: member.capacityState,
        workloadLevel: member.workloadLevel
      }
    }]);
  }

  getScheduledCapacityRisk(member = {}) {
    const scheduledHours = Number(member.scheduledAllocationWeeklyHours);
    const availableHours = Number(member.weeklyAvailableHours);
    if (!Number.isFinite(scheduledHours) || !Number.isFinite(availableHours) || scheduledHours <= 0 || availableHours <= 0) return null;
    const ratio = scheduledHours / availableHours;
    if (ratio <= 1.1) return null;
    return {
      scheduledHours: Number(scheduledHours.toFixed(1)),
      availableHours: Number(availableHours.toFixed(1)),
      ratio,
      percent: Math.round(ratio * 100)
    };
  }

  buildCapacityEvidence(member, risk) {
    return this.buildEvidenceRefs([{
      type: 'member',
      entityId: member._id || member.id,
      label: member.fullName || member.username || 'Team member',
      data: {
        reason: 'Mapped scheduled capacity exceeds declared availability',
        scheduledAllocationWeeklyHours: risk.scheduledHours,
        weeklyAvailableHours: risk.availableHours,
        scheduledCapacityPercent: risk.percent,
        providers: member.scheduledAllocationProvidersNext28Days || []
      }
    }]);
  }

  buildInterventionEvidence(intervention, reason) {
    if (!intervention) return [];
    return this.buildEvidenceRefs([{
      type: 'intervention',
      entityId: intervention._id,
      label: intervention.action || intervention.type || 'Intervention',
      observedAt: intervention.updatedAt || intervention.createdAt,
      data: {
        reason,
        status: intervention.status,
        severity: intervention.severity,
        boardId: this.toId(intervention.boardId),
        cardId: this.toId(intervention.cardId),
        memberId: this.toId(intervention.memberId)
      }
    }]);
  }

  buildEvidenceRefs(refs = []) {
    return refs
      .filter(ref => ref && (ref.entityId || ref.label))
      .map(ref => ({
        type: ref.type || 'system',
        entityId: ref.entityId,
        label: ref.label || ref.type || 'Evidence',
        url: safeExternalSourceUrl(ref.url),
        observedAt: ref.observedAt || new Date(),
        data: ref.data || {}
      }));
  }

  daysUntil(date) {
    if (!date) return null;
    return Math.ceil((new Date(date) - Date.now()) / (HOURS_PER_DAY * 60 * 60 * 1000));
  }

  daysSince(date) {
    if (!date) return 999;
    return Math.floor((Date.now() - new Date(date)) / (HOURS_PER_DAY * 60 * 60 * 1000));
  }

  isCardOverdue(card) {
    if (!card.due || card.dueComplete || card.closed) {
      return false;
    }
    return new Date(card.due) < new Date();
  }

  hasLabel(card, labelName) {
    return (card.labels || []).some(label =>
      (label.name || '').toLowerCase().includes(labelName.toLowerCase())
    );
  }

  idEquals(value, expected) {
    if (!value || !expected) return false;
    const actualId = value._id || value;
    const expectedId = expected._id || expected;
    return actualId.toString() === expectedId.toString();
  }

  toId(value) {
    if (!value) return null;
    return (value._id || value).toString();
  }

  getDemoMissionControl() {
    const now = new Date();
    const dueToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const demoEvidence = (type, label, reason) => ({
      type,
      label,
      observedAt: now,
      data: { reason, demo: true }
    });

    const boardSummaries = [
      {
        id: 'demo-board-1',
        name: 'Client Launches',
        url: '#',
        health: 'at_risk',
        activeCards: 42,
        overdueCards: 3,
        highRiskCards: 6,
        blockedCards: 2,
        unassignedCards: 4,
        velocity: { cardsPerWeek: 11, cardsPerDay: 1.57 },
        riskFactors: ['Launch QA queue is congested', 'Two approvals are late'],
        flow: [
          { id: 'l1', name: 'Intake', count: 8, averageTimeInList: 16, done: false },
          { id: 'l2', name: 'Build', count: 17, averageTimeInList: 38, done: false },
          { id: 'l3', name: 'Review', count: 10, averageTimeInList: 44, done: false },
          { id: 'l4', name: 'Done', count: 7, averageTimeInList: 6, done: true }
        ]
      },
      {
        id: 'demo-board-2',
        name: 'Internal Operations',
        url: '#',
        health: 'healthy',
        activeCards: 28,
        overdueCards: 0,
        highRiskCards: 1,
        blockedCards: 0,
        unassignedCards: 1,
        velocity: { cardsPerWeek: 18, cardsPerDay: 2.57 },
        riskFactors: [],
        flow: [
          { id: 'l5', name: 'Ready', count: 6, averageTimeInList: 10, done: false },
          { id: 'l6', name: 'Doing', count: 9, averageTimeInList: 22, done: false },
          { id: 'l7', name: 'Done', count: 13, averageTimeInList: 4, done: true }
        ]
      },
      {
        id: 'demo-board-3',
        name: 'Growth Experiments',
        url: '#',
        health: 'critical',
        activeCards: 19,
        overdueCards: 5,
        highRiskCards: 8,
        blockedCards: 3,
        unassignedCards: 2,
        velocity: { cardsPerWeek: 4, cardsPerDay: 0.57 },
        riskFactors: ['Campaign dependencies are blocked', 'Owner capacity is overloaded'],
        flow: [
          { id: 'l8', name: 'Ideas', count: 5, averageTimeInList: 30, done: false },
          { id: 'l9', name: 'Production', count: 11, averageTimeInList: 72, done: false },
          { id: 'l10', name: 'Live', count: 3, averageTimeInList: 5, done: true }
        ]
      }
    ];

    const focus = [
      {
        id: 'demo-card-1',
        name: 'Approve launch checklist for Sneup onboarding',
        boardName: 'Client Launches',
        listName: 'Review',
        members: ['nina'],
        due: dueToday,
        riskLevel: 'critical',
        priorityScore: 96,
        reasons: ['due today', 'critical risk', 'blocked'],
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Priority score and focus queue position')]
      },
      {
        id: 'demo-card-2',
        name: 'Assign owner for analytics webhook rollout',
        boardName: 'Growth Experiments',
        listName: 'Production',
        members: [],
        due: tomorrow,
        riskLevel: 'high',
        priorityScore: 88,
        reasons: ['unassigned', 'due in 1 day', 'high risk'],
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Ownership and due-date signals')]
      },
      {
        id: 'demo-card-3',
        name: 'Clear copy approvals for paid campaign',
        boardName: 'Growth Experiments',
        listName: 'Production',
        members: ['milan'],
        due: inThreeDays,
        riskLevel: 'high',
        priorityScore: 79,
        reasons: ['high risk', '3 days inactive'],
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Risk and activity signals')]
      }
    ];

    const commandQueue = [
      this.createCommand({
        type: 'board_recovery',
        severity: 'critical',
        title: 'Run recovery plan for Growth Experiments',
        target: 'Growth Experiments',
        owner: 'Sneup',
        reason: 'Campaign dependencies are blocked, owner capacity is overloaded',
        automatable: false,
        sourceEvidence: [demoEvidence('board', 'Demo board snapshot', 'Board flow and risk summary')],
        payload: { boardId: 'demo-board-3' }
      }),
      this.createCommand({
        type: 'escalate_overdue',
        severity: 'critical',
        title: 'Recover overdue card: Approve launch checklist for Sneup onboarding',
        target: 'Client Launches',
        owner: 'nina',
        reason: 'Due date passed and work is still open',
        automatable: true,
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Overdue open card')],
        payload: { cardId: 'demo-card-1' }
      }),
      this.createCommand({
        type: 'assign_owner',
        severity: 'high',
        title: 'Assign an owner: Analytics webhook rollout',
        target: 'Growth Experiments',
        owner: 'Sneup',
        reason: 'Unowned work has no accountable path to completion',
        automatable: true,
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Card has no assigned owner')],
        payload: { cardId: 'demo-card-2' }
      }),
      this.createCommand({
        type: 'review_scheduled_capacity',
        severity: 'high',
        title: 'Review nina\'s scheduled capacity',
        target: 'Nina Jacobs',
        owner: 'Sneup',
        reason: 'Mapped schedules reserve 26h/week against 20h/week available (130% of capacity).',
        automatable: false,
        sourceEvidence: [demoEvidence('member', 'Demo capacity forecast', 'Mapped scheduled capacity exceeds declared availability')],
        payload: { memberId: 'demo-member-1', scheduledAllocationWeeklyHours: 26, weeklyAvailableHours: 20, scheduledAllocationProviders: ['motion'] }
      }),
      this.createCommand({
        type: 'request_update',
        severity: 'medium',
        title: 'Request a crisp update: Clear copy approvals for paid campaign',
        target: 'Growth Experiments',
        owner: 'milan',
        reason: 'No activity for 6 days',
        automatable: true,
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Stale card activity')],
        payload: { cardId: 'demo-card-3' }
      })
    ];

    const teamLoad = [
      {
        id: 'demo-member-1',
        username: 'nina',
        fullName: 'Nina Jacobs',
        workloadLevel: 'overloaded',
        assignedCards: 12,
        urgentCards: 4,
        overdueCards: 2,
        specialties: ['launch', 'qa'],
        loadScore: 18,
        capacityState: 'overloaded',
        weeklyAvailableHours: 20,
        scheduledAllocationWeeklyHours: 26,
        scheduledAllocationProvidersNext28Days: ['motion']
      },
      {
        id: 'demo-member-2',
        username: 'milan',
        fullName: 'Milan de Vries',
        workloadLevel: 'heavy',
        assignedCards: 8,
        urgentCards: 2,
        overdueCards: 1,
        specialties: ['copy', 'growth'],
        loadScore: 12,
        capacityState: 'overloaded'
      },
      {
        id: 'demo-member-3',
        username: 'sara',
        fullName: 'Sara Visser',
        workloadLevel: 'normal',
        assignedCards: 4,
        urgentCards: 0,
        overdueCards: 0,
        specialties: ['operations', 'automation'],
        loadScore: 4,
        capacityState: 'balanced'
      },
      {
        id: 'demo-member-4',
        username: 'joost',
        fullName: 'Joost Bakker',
        workloadLevel: 'light',
        assignedCards: 2,
        urgentCards: 0,
        overdueCards: 0,
        specialties: ['web', 'analytics'],
        loadScore: 2,
        capacityState: 'light'
      }
    ];

    const risks = [
      {
        id: 'demo-risk-1',
        type: 'flow_bottleneck',
        severity: 'critical',
        title: 'Production queue is saturated',
        boardName: 'Growth Experiments',
        score: 96,
        detail: '11 cards averaging 72 hours',
        sourceEvidence: [demoEvidence('board', 'Demo board snapshot', 'Flow bottleneck risk')]
      },
      {
        id: 'demo-risk-2',
        type: 'ownership_gap',
        severity: 'high',
        title: 'Analytics webhook rollout',
        boardName: 'Growth Experiments',
        score: 82,
        detail: 'No owner assigned',
        sourceEvidence: [demoEvidence('card', 'Demo card snapshot', 'Ownership gap risk')]
      },
      {
        id: 'demo-risk-3',
        type: 'delivery_risk',
        severity: 'high',
        title: 'Launch QA queue',
        boardName: 'Client Launches',
        score: 78,
        detail: 'Review cycle exceeds target by 2.3x',
        sourceEvidence: [demoEvidence('board', 'Demo board snapshot', 'Delivery risk')]
      }
    ];

    return {
      mode: 'demo',
      generatedAt: now,
      autonomy: this.getAutonomyState(false),
      signals: {
        boards: 3,
        activeCards: 89,
        overdueCards: 8,
        highRiskCards: 15,
        unassignedCards: 7,
        overloadedMembers: 2,
        scheduledCapacityRisks: 1,
        activeRisks: risks.length
      },
      boardSummaries,
      focus,
      commandQueue,
      dailyPlan: this.buildDailyPlan(focus, commandQueue, risks),
      teamLoad,
      risks,
      brief: this.buildBrief(boardSummaries, focus, commandQueue, risks)
    };
  }
}

module.exports = new AutopilotService();
