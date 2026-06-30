const mongoose = require('mongoose');
const Recommendation = require('../models/Recommendation');
const Approval = require('../models/Approval');
const TrelloActionAttempt = require('../models/TrelloActionAttempt');
const AuditEvent = require('../models/AuditEvent');
const DecisionQueueItem = require('../models/DecisionQueueItem');
const FollowUpPlan = require('../models/FollowUpPlan');
const WorkerResponse = require('../models/WorkerResponse');
const Intervention = require('../models/Intervention');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const Card = require('../models/Card');
const Member = require('../models/Member');
const WorkItem = require('../models/WorkItem');
const trelloClient = require('./trelloClient');
const interventionPolicy = require('./interventionPolicy');
const workGraphService = require('./workGraphService');
const logger = require('../utils/logger');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const HOURS = 60 * 60 * 1000;

class OperationsLedgerService {
  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required for the operations ledger');
      error.statusCode = 503;
      throw error;
    }
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId);
  }

  workspaceQuery(filters = {}, query = {}) {
    return {
      ...query,
      workspaceId: this.resolveWorkspaceId(filters.workspaceId)
    };
  }

  async createRecommendationFromIntervention(intervention, policy = null) {
    this.requireDatabase();

    const savedIntervention = intervention.isNew === false ? intervention : await intervention.save();
    const resolvedPolicy = policy || interventionPolicy.classifyIntervention(savedIntervention);
    const workspaceId = this.resolveWorkspaceId(policy?.workspaceId || savedIntervention.workspaceId);
    const card = savedIntervention.cardId
      ? await Card.findOne({ _id: savedIntervention.cardId, workspaceId })
      : null;
    const member = savedIntervention.memberId
      ? await Member.findOne({ _id: savedIntervention.memberId, workspaceId })
      : null;

    const existing = await Recommendation.findOne({
      workspaceId,
      interventionId: savedIntervention._id,
      status: { $in: ['pending', 'approved', 'executing'] }
    });

    if (existing) {
      return existing;
    }
    const actionPayload = this.buildActionPayload(savedIntervention, card, member);
    const recommendation = await Recommendation.create({
      workspaceId,
      boardId: savedIntervention.boardId,
      cardId: savedIntervention.cardId,
      memberId: savedIntervention.memberId,
      interventionId: savedIntervention._id,
      findingType: savedIntervention.trigger,
      title: savedIntervention.action,
      description: savedIntervention.message,
      recommendedAction: this.describeAction(savedIntervention, actionPayload),
      actionType: savedIntervention.type,
      actionPayload,
      riskLevel: resolvedPolicy.riskLevel,
      confidence: this.confidenceForIntervention(savedIntervention),
      requiresApproval: resolvedPolicy.requiresApproval,
      approvalReason: resolvedPolicy.approvalReason,
      ownerType: resolvedPolicy.ownerType,
      sourceEvidence: this.buildSourceEvidence(savedIntervention, card, member)
    });

    await DecisionQueueItem.create({
      workspaceId,
      recommendationId: recommendation._id,
      ownerType: resolvedPolicy.ownerType,
      boardId: savedIntervention.boardId,
      cardId: savedIntervention.cardId,
      title: recommendation.title,
      question: this.buildDecisionQuestion(recommendation),
      recommendedAnswer: 'yes',
      options: ['yes', 'no', 'change'],
      riskLevel: recommendation.riskLevel,
      reason: recommendation.approvalReason,
      sourceEvidence: recommendation.sourceEvidence,
      dueAt: this.defaultDecisionDueAt(recommendation.riskLevel)
    });

    savedIntervention.status = 'awaiting_approval';
    savedIntervention.metadata = {
      ...(savedIntervention.metadata || {}),
      recommendationId: recommendation._id,
      requiresApproval: resolvedPolicy.requiresApproval,
      approvalReason: resolvedPolicy.approvalReason,
      actionPayload
    };
    await savedIntervention.save();

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'recommendation_created',
      actor: 'sneup',
      source: 'worker',
      riskLevel: recommendation.riskLevel,
      recommendationId: recommendation._id,
      afterState: recommendation.toObject()
    });

    return recommendation;
  }

  async createRecommendationFromFinding(finding, actionSpec = {}) {
    this.requireDatabase();

    const savedFinding = finding.isNew === false ? finding : await finding.save();
    const workspaceId = this.resolveWorkspaceId(actionSpec.workspaceId || savedFinding.workspaceId);
    const actionType = actionSpec.actionType || this.defaultActionTypeForFinding(savedFinding);
    const policy = interventionPolicy.classifyAction(actionType, {
      severity: savedFinding.severity
    });

    const existing = await Recommendation.findOne({
      workspaceId,
      findingType: savedFinding.findingType,
      cardId: savedFinding.cardId,
      status: { $in: ['pending', 'approved', 'executing'] },
      'sourceEvidence.entityId': savedFinding._id
    });

    if (existing) {
      return existing;
    }

    const actionPayload = {
      findingId: savedFinding._id,
      boardId: savedFinding.boardId,
      cardId: savedFinding.cardId,
      memberId: savedFinding.memberId,
      draftOnly: true,
      ...actionSpec.actionPayload
    };
    const card = savedFinding.cardId
      ? await Card.findOne({ _id: savedFinding.cardId, workspaceId })
      : null;
    if (card?.trelloId) {
      actionPayload.cardTrelloId = card.trelloId;
    }
    if (['comment', 'follow_up', 'escalate'].includes(actionType) && !actionPayload.commentText) {
      actionPayload.commentText = actionSpec.recommendedAction || savedFinding.recommendedAction;
    }
    if (actionType === 'add_checklist') {
      actionPayload.checklistName = actionPayload.checklistName || 'Next actions';
      actionPayload.checkItems = actionPayload.checkItems || [savedFinding.recommendedAction || 'Define the next concrete action'];
    }

    const recommendation = await Recommendation.create({
      workspaceId,
      boardId: savedFinding.boardId,
      cardId: savedFinding.cardId,
      memberId: savedFinding.memberId,
      findingType: savedFinding.findingType,
      title: actionSpec.title || savedFinding.title,
      description: savedFinding.description,
      recommendedAction: actionSpec.recommendedAction || savedFinding.recommendedAction,
      actionType,
      actionPayload,
      riskLevel: policy.riskLevel,
      confidence: actionSpec.confidence || this.confidenceForFinding(savedFinding),
      requiresApproval: policy.requiresApproval,
      approvalReason: policy.approvalReason,
      ownerType: actionSpec.ownerType || savedFinding.waitingOn || policy.ownerType,
      sourceEvidence: [
        {
          type: 'analytics',
          entityId: savedFinding._id,
          label: savedFinding.findingType,
          observedAt: savedFinding.lastObservedAt,
          data: {
            severity: savedFinding.severity,
            signalScore: savedFinding.signalScore
          }
        },
        ...(savedFinding.sourceEvidence || [])
      ]
    });

    await DecisionQueueItem.create({
      workspaceId,
      recommendationId: recommendation._id,
      ownerType: recommendation.ownerType,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      title: recommendation.title,
      question: this.buildDecisionQuestion(recommendation),
      recommendedAnswer: 'yes',
      options: ['yes', 'no', 'change'],
      riskLevel: recommendation.riskLevel,
      reason: recommendation.approvalReason,
      sourceEvidence: recommendation.sourceEvidence,
      dueAt: this.defaultDecisionDueAt(recommendation.riskLevel)
    });

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      action: 'recommendation_created_from_finding',
      actor: 'sneup',
      source: 'worker',
      riskLevel: recommendation.riskLevel,
      recommendationId: recommendation._id,
      afterState: recommendation.toObject()
    });

    return recommendation;
  }

  async createRecommendationFromAutopilotCommand(command, options = {}) {
    this.requireDatabase();

    const normalized = this.normalizeAutopilotCommand(command);
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const { card, member, boardId, cardId, memberId } = await this.resolveAutopilotCommandRefs(normalized, { workspaceId });
    const actionSpec = this.buildAutopilotActionSpec(normalized, card, member);
    const policy = interventionPolicy.classifyAction(actionSpec.actionType, {
      severity: normalized.severity
    });
    const riskLevel = normalized.severity === 'critical' ? 'critical' : actionSpec.riskLevel || policy.riskLevel;
    const requiresApproval = actionSpec.requiresApproval !== undefined
      ? actionSpec.requiresApproval
      : policy.requiresApproval;
    const ownerType = actionSpec.ownerType || (riskLevel === 'critical' || riskLevel === 'high' ? 'robert' : policy.ownerType);

    const existing = await Recommendation.findOne({
      workspaceId,
      findingType: `autopilot_${normalized.type}`,
      status: { $in: ['pending', 'approved', 'executing', 'change_requested'] },
      'actionPayload.commandId': normalized.id
    });

    if (existing) {
      const existingDecision = await DecisionQueueItem.findOne({
        workspaceId,
        recommendationId: existing._id,
        status: 'open'
      });
      return {
        recommendation: existing,
        decisionQueueItem: existingDecision,
        created: false
      };
    }

    const recommendation = await Recommendation.create({
      workspaceId,
      boardId,
      cardId,
      memberId,
      findingType: `autopilot_${normalized.type}`,
      title: normalized.title,
      description: normalized.reason,
      recommendedAction: actionSpec.recommendedAction,
      actionType: actionSpec.actionType,
      actionPayload: actionSpec.actionPayload,
      riskLevel,
      confidence: actionSpec.confidence,
      requiresApproval,
      approvalReason: actionSpec.approvalReason || policy.approvalReason,
      ownerType,
      sourceEvidence: this.buildAutopilotSourceEvidence(normalized, card, member)
    });

    const decisionQueueItem = await DecisionQueueItem.create({
      workspaceId,
      recommendationId: recommendation._id,
      ownerType,
      boardId,
      cardId,
      title: recommendation.title,
      question: this.buildDecisionQuestion(recommendation),
      recommendedAnswer: 'yes',
      options: ['yes', 'no', 'change'],
      riskLevel,
      reason: recommendation.approvalReason,
      sourceEvidence: recommendation.sourceEvidence,
      dueAt: this.defaultDecisionDueAt(riskLevel)
    });

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      boardId,
      cardId,
      action: 'autopilot_command_queued',
      actor: options.actor || 'sneup',
      source: 'api',
      riskLevel,
      recommendationId: recommendation._id,
      afterState: {
        command: normalized,
        recommendation: recommendation.toObject()
      }
    });

    return {
      recommendation,
      decisionQueueItem,
      created: true
    };
  }

  async createRecommendationFromWorkItem(workItemOrId, options = {}) {
    this.requireDatabase();

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const workItem = typeof workItemOrId === 'object' && workItemOrId._id
      ? workItemOrId
      : await WorkItem.findOne({ _id: workItemOrId, workspaceId });

    if (!workItem) {
      const error = new Error('Work item not found');
      error.statusCode = 404;
      throw error;
    }

    const candidate = workGraphService.buildDecisionCandidate(workItem);
    if (!candidate) {
      const error = new Error('Work item does not currently need a decision queue item');
      error.statusCode = 400;
      throw error;
    }

    const existing = await Recommendation.findOne({
      workspaceId,
      findingType: candidate.findingType,
      status: { $in: ['pending', 'approved', 'executing', 'change_requested'] },
      'actionPayload.workItemId': String(workItem._id)
    });

    if (existing) {
      const existingDecision = await DecisionQueueItem.findOne({
        workspaceId,
        recommendationId: existing._id,
        status: 'open'
      });
      return {
        recommendation: existing,
        decisionQueueItem: existingDecision,
        candidate,
        created: false
      };
    }

    const policy = interventionPolicy.classifyAction(candidate.actionType, {
      severity: candidate.riskLevel
    });
    const recommendation = await Recommendation.create({
      workspaceId,
      findingType: candidate.findingType,
      title: candidate.title,
      description: candidate.description,
      recommendedAction: candidate.recommendedAction,
      actionType: candidate.actionType,
      actionPayload: candidate.actionPayload,
      riskLevel: candidate.riskLevel || policy.riskLevel,
      confidence: candidate.confidence,
      requiresApproval: candidate.requiresApproval,
      approvalReason: candidate.approvalReason || policy.approvalReason,
      ownerType: candidate.ownerType || policy.ownerType,
      sourceEvidence: candidate.sourceEvidence
    });

    const decisionQueueItem = await DecisionQueueItem.create({
      workspaceId,
      recommendationId: recommendation._id,
      ownerType: recommendation.ownerType,
      title: recommendation.title,
      question: this.buildDecisionQuestion(recommendation),
      recommendedAnswer: 'yes',
      options: ['yes', 'no', 'change'],
      riskLevel: recommendation.riskLevel,
      reason: recommendation.approvalReason,
      sourceEvidence: recommendation.sourceEvidence,
      dueAt: this.defaultDecisionDueAt(recommendation.riskLevel)
    });

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'work_graph_recommendation_queued',
      actor: options.actor || 'sneup',
      source: 'worker',
      riskLevel: recommendation.riskLevel,
      recommendationId: recommendation._id,
      afterState: {
        workItem: workGraphService.sanitizeItem(workItem),
        recommendation: recommendation.toObject()
      }
    });

    return {
      recommendation,
      decisionQueueItem,
      candidate,
      created: true
    };
  }

  async listRecommendations(filters = {}) {
    this.requireDatabase();
    const query = this.workspaceQuery(filters);
    if (filters.status) query.status = filters.status;
    if (filters.boardId) query.boardId = filters.boardId;
    if (filters.cardId) query.cardId = filters.cardId;
    if (filters.ownerType) query.ownerType = filters.ownerType;

    return Recommendation.find(query)
      .sort({ riskLevel: -1, createdAt: -1 })
      .populate('boardId cardId memberId interventionId')
      .limit(filters.limit || 100);
  }

  async getRecommendation(recommendationId, filters = {}) {
    this.requireDatabase();
    return Recommendation.findOne(this.workspaceQuery(filters, { _id: recommendationId }))
      .populate('boardId cardId memberId interventionId');
  }

  async getRecommendationEvidence(recommendationId, filters = {}) {
    this.requireDatabase();
    const recommendation = await this.getRecommendation(recommendationId, filters);
    if (!recommendation) return null;

    const workspaceId = this.resolveWorkspaceId(recommendation.workspaceId);
    const recommendationQuery = { workspaceId, recommendationId: recommendation._id };
    const [
      decisions,
      approvals,
      trelloActions,
      auditEvents,
      followUps,
      workerResponses,
      relatedFindings
    ] = await Promise.all([
      DecisionQueueItem.find(recommendationQuery).sort({ createdAt: -1 }).limit(25),
      Approval.find(recommendationQuery).sort({ decidedAt: -1 }).limit(25),
      TrelloActionAttempt.find(recommendationQuery).sort({ createdAt: -1 }).limit(25),
      AuditEvent.find({
        workspaceId,
        $or: [
          { recommendationId: recommendation._id },
          { entityType: 'recommendation', entityId: recommendation._id }
        ]
      }).sort({ createdAt: -1 }).limit(50),
      FollowUpPlan.find(recommendationQuery).sort({ dueAt: 1, createdAt: -1 }).limit(25),
      WorkerResponse.find(recommendationQuery).sort({ receivedAt: -1, createdAt: -1 }).limit(25),
      recommendation.cardId
        ? CardFinding.find({ workspaceId, cardId: recommendation.cardId, status: 'open' }).sort({ severity: -1, lastObservedAt: -1 }).limit(25)
        : []
    ]);

    const sourceEvidence = this.normalizeEvidenceRefs(recommendation.sourceEvidence || []);
    const allDates = [
      recommendation.createdAt,
      recommendation.updatedAt,
      ...sourceEvidence.map(item => item.observedAt),
      ...decisions.map(item => item.updatedAt || item.createdAt),
      ...approvals.map(item => item.decidedAt || item.createdAt),
      ...trelloActions.map(item => item.finishedAt || item.startedAt || item.createdAt),
      ...auditEvents.map(item => item.createdAt),
      ...followUps.map(item => item.updatedAt || item.dueAt || item.createdAt),
      ...workerResponses.map(item => item.receivedAt || item.createdAt),
      ...relatedFindings.map(item => item.lastObservedAt || item.updatedAt || item.createdAt)
    ].filter(Boolean).map(value => new Date(value)).filter(date => !Number.isNaN(date.getTime()));

    return {
      recommendation,
      summary: {
        sourceEvidenceCount: sourceEvidence.length,
        decisionCount: decisions.length,
        approvalCount: approvals.length,
        trelloActionCount: trelloActions.length,
        failedActionCount: trelloActions.filter(item => item.status === 'failed').length,
        auditEventCount: auditEvents.length,
        followUpCount: followUps.length,
        workerResponseCount: workerResponses.length,
        relatedFindingCount: relatedFindings.length,
        newestEvidenceAt: allDates.length > 0
          ? new Date(Math.max(...allDates.map(date => date.getTime())))
          : null
      },
      sourceEvidence,
      decisions,
      approvals,
      trelloActions,
      auditEvents,
      followUps,
      workerResponses,
      relatedFindings
    };
  }

  async approveRecommendation(recommendationId, body = {}) {
    this.requireDatabase();
    const recommendation = await Recommendation.findOne(this.workspaceQuery(body, { _id: recommendationId }));
    if (!recommendation) {
      const error = new Error('Recommendation not found');
      error.statusCode = 404;
      throw error;
    }

    const approval = await Approval.create({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      interventionId: recommendation.interventionId,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      requestedAction: recommendation.recommendedAction,
      decision: 'approved',
      decidedBy: body.decidedBy || 'robert',
      decisionReason: body.decisionReason || '',
      approvedPayloadSnapshot: body.approvedPayloadSnapshot || recommendation.actionPayload
    });

    recommendation.status = 'approved';
    recommendation.approvedAt = approval.decidedAt;
    recommendation.actionPayload = approval.approvedPayloadSnapshot;
    await recommendation.save();

    await DecisionQueueItem.updateMany(
      this.workspaceQuery({ workspaceId: recommendation.workspaceId }, { recommendationId: recommendation._id, status: 'open' }),
      {
        status: 'approved',
        resolvedAt: new Date(),
        resolvedBy: approval.decidedBy,
        resolutionNote: approval.decisionReason
      }
    );

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'recommendation_approved',
      actor: approval.decidedBy,
      source: 'approval',
      riskLevel: recommendation.riskLevel,
      approvalId: approval._id,
      recommendationId: recommendation._id,
      afterState: approval.toObject()
    });

    return { recommendation, approval };
  }

  async rejectRecommendation(recommendationId, body = {}) {
    this.requireDatabase();
    const recommendation = await Recommendation.findOne(this.workspaceQuery(body, { _id: recommendationId }));
    if (!recommendation) {
      const error = new Error('Recommendation not found');
      error.statusCode = 404;
      throw error;
    }

    const approval = await Approval.create({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      interventionId: recommendation.interventionId,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      requestedAction: recommendation.recommendedAction,
      decision: 'rejected',
      decidedBy: body.decidedBy || 'robert',
      decisionReason: body.decisionReason || 'Rejected',
      approvedPayloadSnapshot: recommendation.actionPayload
    });

    recommendation.status = 'rejected';
    recommendation.rejectedAt = approval.decidedAt;
    await recommendation.save();

    await DecisionQueueItem.updateMany(
      this.workspaceQuery({ workspaceId: recommendation.workspaceId }, { recommendationId: recommendation._id, status: 'open' }),
      {
        status: 'rejected',
        resolvedAt: new Date(),
        resolvedBy: approval.decidedBy,
        resolutionNote: approval.decisionReason
      }
    );

    if (recommendation.interventionId) {
      await Intervention.findOneAndUpdate(
        { _id: recommendation.interventionId, workspaceId: recommendation.workspaceId },
        { status: 'cancelled' }
      );
    }

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'recommendation_rejected',
      actor: approval.decidedBy,
      source: 'approval',
      riskLevel: recommendation.riskLevel,
      approvalId: approval._id,
      recommendationId: recommendation._id,
      afterState: approval.toObject()
    });

    return { recommendation, approval };
  }

  async requestRecommendationChange(recommendationId, body = {}) {
    this.requireDatabase();
    const recommendation = await Recommendation.findOne(this.workspaceQuery(body, { _id: recommendationId }));
    if (!recommendation) {
      const error = new Error('Recommendation not found');
      error.statusCode = 404;
      throw error;
    }

    const approval = await Approval.create({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      interventionId: recommendation.interventionId,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      requestedAction: recommendation.recommendedAction,
      decision: 'change_requested',
      decidedBy: body.decidedBy || 'robert',
      decisionReason: body.decisionReason || 'Change requested',
      approvedPayloadSnapshot: body.proposedPayload || recommendation.actionPayload
    });

    recommendation.status = 'change_requested';
    await recommendation.save();

    await DecisionQueueItem.updateMany(
      this.workspaceQuery({ workspaceId: recommendation.workspaceId }, { recommendationId: recommendation._id, status: 'open' }),
      {
        status: 'change_requested',
        resolvedAt: new Date(),
        resolvedBy: approval.decidedBy,
        resolutionNote: approval.decisionReason
      }
    );

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'recommendation_change_requested',
      actor: approval.decidedBy,
      source: 'approval',
      riskLevel: recommendation.riskLevel,
      approvalId: approval._id,
      recommendationId: recommendation._id,
      afterState: approval.toObject()
    });

    return { recommendation, approval };
  }
  async updateRecommendationPayload(recommendationId, body = {}) {
    this.requireDatabase();
    const recommendation = await Recommendation.findOne(this.workspaceQuery(body, { _id: recommendationId }));
    if (!recommendation) {
      const error = new Error('Recommendation not found');
      error.statusCode = 404;
      throw error;
    }

    if (!body.actionPayload || typeof body.actionPayload !== 'object' || Array.isArray(body.actionPayload)) {
      const error = new Error('actionPayload object is required');
      error.statusCode = 400;
      throw error;
    }

    const beforeState = recommendation.toObject();
    recommendation.actionPayload = body.replace === true
      ? body.actionPayload
      : { ...(recommendation.actionPayload || {}), ...body.actionPayload };
    if (body.actionType) recommendation.actionType = body.actionType;
    if (body.recommendedAction) recommendation.recommendedAction = body.recommendedAction;
    recommendation.status = 'pending';
    recommendation.failureReason = undefined;
    await recommendation.save();

    await this.recordAudit({
      entityType: 'recommendation',
      entityId: recommendation._id,
      action: 'recommendation_payload_updated',
      actor: body.updatedBy || 'robert',
      source: 'api',
      riskLevel: recommendation.riskLevel,
      recommendationId: recommendation._id,
      beforeState,
      afterState: recommendation.toObject()
    });

    return recommendation;
  }
  async executeApprovedRecommendation(recommendationId, options = {}) {
    this.requireDatabase();

    const recommendation = await Recommendation.findOne(this.workspaceQuery(options, { _id: recommendationId }));
    if (!recommendation) {
      const error = new Error('Recommendation not found');
      error.statusCode = 404;
      throw error;
    }

    if (recommendation.requiresApproval && recommendation.status !== 'approved') {
      const error = new Error('Recommendation must be approved before execution');
      error.statusCode = 409;
      throw error;
    }

    const approval = await Approval.findOne({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      decision: 'approved'
    }).sort({ decidedAt: -1 });

    if (recommendation.requiresApproval && !approval) {
      const error = new Error('Approved payload snapshot not found');
      error.statusCode = 409;
      throw error;
    }

    if (!this.isExecutableRecommendation(recommendation)) {
      const error = new Error('Approved recommendation needs an executable Trello payload before it can run');
      error.statusCode = 409;
      throw error;
    }

    recommendation.status = 'executing';
    await recommendation.save();

    const attempt = await TrelloActionAttempt.create({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      interventionId: recommendation.interventionId,
      approvalId: approval?._id,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      actionType: recommendation.actionType,
      payload: recommendation.actionPayload,
      status: 'in_progress',
      startedAt: new Date()
    });

    try {
      const trelloResponse = await this.performTrelloAction(recommendation);
      attempt.status = 'succeeded';
      attempt.finishedAt = new Date();
      attempt.trelloResponse = trelloResponse;
      await attempt.save();

      recommendation.status = 'executed';
      recommendation.executedAt = attempt.finishedAt;
      await recommendation.save();

      if (recommendation.interventionId) {
        const intervention = await Intervention.findOne({
          _id: recommendation.interventionId,
          workspaceId: recommendation.workspaceId
        });
        if (intervention) {
          await intervention.markExecuted({
            recommendationId: recommendation._id,
            trelloActionAttemptId: attempt._id
          });
        }
      }

      await this.scheduleFollowUp(recommendation);
      await this.recordAudit({
        entityType: 'trello_action_attempt',
        entityId: attempt._id,
        action: 'trello_action_succeeded',
        actor: options.actor || approval?.decidedBy || 'sneup',
        source: 'trello',
        riskLevel: recommendation.riskLevel,
        approvalId: approval?._id,
        recommendationId: recommendation._id,
        trelloActionAttemptId: attempt._id,
        afterState: attempt.toObject()
      });

      return { recommendation, attempt };
    } catch (error) {
      attempt.status = 'failed';
      attempt.finishedAt = new Date();
      attempt.errorMessage = error.message;
      await attempt.save();

      recommendation.status = 'failed';
      recommendation.failureReason = error.message;
      await recommendation.save();

      if (recommendation.interventionId) {
        const intervention = await Intervention.findOne({
          _id: recommendation.interventionId,
          workspaceId: recommendation.workspaceId
        });
        if (intervention) {
          await intervention.markFailed(error);
        }
      }

      await this.recordAudit({
        entityType: 'trello_action_attempt',
        entityId: attempt._id,
        action: 'trello_action_failed',
        actor: options.actor || approval?.decidedBy || 'sneup',
        source: 'trello',
        riskLevel: recommendation.riskLevel,
        approvalId: approval?._id,
        recommendationId: recommendation._id,
        trelloActionAttemptId: attempt._id,
        afterState: attempt.toObject()
      });

      throw error;
    }
  }

  async performTrelloAction(recommendation) {
    const payload = recommendation.actionPayload || {};

    switch (recommendation.actionType) {
      case 'comment':
      case 'follow_up':
      case 'performance_notification':
        this.requirePayload(payload, ['cardTrelloId', 'commentText']);
        return trelloClient.cardApi.addComment(payload.cardTrelloId, payload.commentText);
      case 'move_card':
        this.requirePayload(payload, ['cardTrelloId', 'targetListId']);
        return trelloClient.cardApi.moveCard(payload.cardTrelloId, payload.targetListId);
      case 'reassign':
        this.requirePayload(payload, ['cardTrelloId', 'fromMemberTrelloId', 'toMemberTrelloId']);
        await trelloClient.cardApi.removeMember(payload.cardTrelloId, payload.fromMemberTrelloId);
        await trelloClient.cardApi.addMember(payload.cardTrelloId, payload.toMemberTrelloId);
        if (payload.commentText) {
          await trelloClient.cardApi.addComment(payload.cardTrelloId, payload.commentText);
        }
        if (payload.cardId && payload.fromMemberId && payload.toMemberId) {
          await Card.findOneAndUpdate(
            { _id: payload.cardId, workspaceId: recommendation.workspaceId },
            { $pull: { members: payload.fromMemberId } }
          );
          await Card.findOneAndUpdate(
            { _id: payload.cardId, workspaceId: recommendation.workspaceId },
            { $addToSet: { members: payload.toMemberId } }
          );
        }
        return { reassigned: true };
      case 'escalate':
        this.requirePayload(payload, ['cardTrelloId', 'commentText']);
        await trelloClient.cardApi.addComment(payload.cardTrelloId, payload.commentText);
        return { escalated: true };
      case 'add_label':
        this.requirePayload(payload, ['cardTrelloId', 'labelName']);
        return trelloClient.cardApi.addLabel(payload.cardTrelloId, payload.labelName, payload.labelColor || 'red');
      case 'set_due_date':
        this.requirePayload(payload, ['cardTrelloId', 'due']);
        return trelloClient.cardApi.updateCard(payload.cardTrelloId, {
          due: payload.due
        });
      case 'add_checklist':
        this.requirePayload(payload, ['cardTrelloId', 'checklistName', 'checkItems']);
        return trelloClient.cardApi.addChecklist(payload.cardTrelloId, payload.checklistName, payload.checkItems);
      default:
        throw new Error(`Unsupported approved Trello action: ${recommendation.actionType}`);
    }
  }

  requirePayload(payload, fields) {
    const missing = fields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
    if (missing.length > 0) {
      throw new Error(`Approved Trello action is missing required payload field(s): ${missing.join(', ')}`);
    }
  }

  isExecutableRecommendation(recommendation) {
    const payload = recommendation.actionPayload || {};
    if (payload.executable === false || payload.draftOnly === true) return false;
    return ['comment', 'follow_up', 'performance_notification', 'move_card', 'reassign', 'escalate', 'add_label', 'set_due_date', 'add_checklist']
      .includes(recommendation.actionType);
  }

  async listDecisionQueue(filters = {}) {
    this.requireDatabase();
    const query = this.workspaceQuery(filters);
    if (filters.status) query.status = filters.status;
    if (filters.ownerType) query.ownerType = filters.ownerType;
    if (filters.boardId) query.boardId = filters.boardId;

    return DecisionQueueItem.find(query)
      .sort({ riskLevel: -1, dueAt: 1, createdAt: 1 })
      .populate('recommendationId boardId cardId')
      .limit(filters.limit || 100);
  }

  async resolveDecisionQueueItem(itemId, body = {}) {
    this.requireDatabase();
    const item = await DecisionQueueItem.findOne(this.workspaceQuery(body, { _id: itemId }));
    if (!item) {
      const error = new Error('Decision queue item not found');
      error.statusCode = 404;
      throw error;
    }

    item.status = body.status || 'resolved';
    item.resolvedAt = new Date();
    item.resolvedBy = body.resolvedBy || 'robert';
    item.resolutionNote = body.resolutionNote || '';
    await item.save();

    await this.recordAudit({
      entityType: 'decision_queue_item',
      entityId: item._id,
      action: 'decision_queue_item_resolved',
      actor: item.resolvedBy,
      source: 'api',
      riskLevel: item.riskLevel,
      recommendationId: item.recommendationId,
      afterState: item.toObject()
    });

    return item;
  }
  async snoozeDecisionQueueItem(itemId, body = {}) {
    this.requireDatabase();
    const item = await DecisionQueueItem.findOne(this.workspaceQuery(body, { _id: itemId }));
    if (!item) {
      const error = new Error('Decision queue item not found');
      error.statusCode = 404;
      throw error;
    }

    const snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : new Date(Date.now() + 24 * HOURS);
    if (Number.isNaN(snoozedUntil.getTime())) {
      const error = new Error('snoozedUntil must be a valid date');
      error.statusCode = 400;
      throw error;
    }

    const beforeState = item.toObject();
    item.status = 'snoozed';
    item.snoozedUntil = snoozedUntil;
    item.dueAt = snoozedUntil;
    item.resolvedAt = undefined;
    item.resolvedBy = body.snoozedBy || 'robert';
    item.resolutionNote = body.reason || 'Snoozed from Sneup command center';
    await item.save();

    if (item.recommendationId) {
      await Recommendation.findOneAndUpdate(this.workspaceQuery({ workspaceId: item.workspaceId }, { _id: item.recommendationId }), { status: 'snoozed' });
    }

    await this.recordAudit({
      entityType: 'decision_queue_item',
      entityId: item._id,
      action: 'decision_queue_item_snoozed',
      actor: item.resolvedBy,
      source: 'api',
      riskLevel: item.riskLevel,
      recommendationId: item.recommendationId,
      beforeState,
      afterState: item.toObject()
    });

    return item;
  }

  async delegateDecisionQueueItem(itemId, body = {}) {
    this.requireDatabase();
    const item = await DecisionQueueItem.findOne(this.workspaceQuery(body, { _id: itemId }));
    if (!item) {
      const error = new Error('Decision queue item not found');
      error.statusCode = 404;
      throw error;
    }

    const ownerType = body.ownerType || 'team';
    if (!['robert', 'va', 'team'].includes(ownerType)) {
      const error = new Error('ownerType must be robert, va, or team');
      error.statusCode = 400;
      throw error;
    }

    const beforeState = item.toObject();
    item.ownerType = ownerType;
    item.status = 'delegated';
    item.delegatedTo = body.delegatedTo || ownerType;
    item.delegatedBy = body.delegatedBy || 'robert';
    item.delegatedAt = new Date();
    item.resolutionNote = body.reason || `Delegated to ${ownerType}`;
    await item.save();

    if (item.recommendationId) {
      await Recommendation.findOneAndUpdate(this.workspaceQuery({ workspaceId: item.workspaceId }, { _id: item.recommendationId }), {
        ownerType,
        status: 'delegated'
      });
    }

    await this.recordAudit({
      entityType: 'decision_queue_item',
      entityId: item._id,
      action: 'decision_queue_item_delegated',
      actor: item.delegatedBy,
      source: 'api',
      riskLevel: item.riskLevel,
      recommendationId: item.recommendationId,
      beforeState,
      afterState: item.toObject()
    });

    return item;
  }
  async listTrelloActions(filters = {}) {
    this.requireDatabase();
    const query = this.workspaceQuery(filters);
    if (filters.status) query.status = filters.status;
    if (filters.boardId) query.boardId = filters.boardId;
    if (filters.cardId) query.cardId = filters.cardId;

    return TrelloActionAttempt.find(query)
      .sort({ createdAt: -1 })
      .populate('recommendationId interventionId approvalId boardId cardId')
      .limit(filters.limit || 100);
  }

  async listAuditEvents(filters = {}) {
    this.requireDatabase();
    const query = this.workspaceQuery(filters);
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.action) query.action = filters.action;
    if (filters.boardId) query.boardId = filters.boardId;
    if (filters.cardId) query.cardId = filters.cardId;

    return AuditEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 100);
  }

  async getBoardLedger(boardId, filters = {}) {
    this.requireDatabase();
    const [recommendations, decisions, actions, auditEvents, followUps, findings, healthSnapshots] = await Promise.all([
      this.listRecommendations({ ...filters, boardId, limit: 50 }),
      this.listDecisionQueue({ ...filters, boardId, limit: 50 }),
      this.listTrelloActions({ ...filters, boardId, limit: 50 }),
      this.listAuditEvents({ ...filters, boardId, limit: 50 }),
      this.listFollowUps({ ...filters, boardId, limit: 50 }),
      CardFinding.find(this.workspaceQuery(filters, { boardId, status: 'open' })).sort({ severity: -1, lastObservedAt: -1 }).limit(100),
      BoardHealthSnapshot.find(this.workspaceQuery(filters, { boardId })).sort({ generatedAt: -1 }).limit(10)
    ]);

    return { recommendations, decisions, actions, auditEvents, followUps, findings, healthSnapshots };
  }

  async getCardLedger(cardId, filters = {}) {
    this.requireDatabase();
    const [recommendations, actions, followUps, workerResponses, findings, auditEvents] = await Promise.all([
      this.listRecommendations({ ...filters, cardId, limit: 50 }),
      this.listTrelloActions({ ...filters, cardId, limit: 50 }),
      this.listFollowUps({ ...filters, cardId, limit: 50 }),
      WorkerResponse.find(this.workspaceQuery(filters, { cardId })).sort({ receivedAt: -1 }).limit(50),
      CardFinding.find(this.workspaceQuery(filters, { cardId, status: 'open' })).sort({ severity: -1, lastObservedAt: -1 }).limit(50),
      this.listAuditEvents({ ...filters, cardId, limit: 50 })
    ]);

    return { recommendations, actions, followUps, workerResponses, findings, auditEvents };
  }

  async listFollowUps(filters = {}) {
    this.requireDatabase();
    const query = this.workspaceQuery(filters);
    if (filters.status) query.status = filters.status;
    if (filters.boardId) query.boardId = filters.boardId;
    if (filters.cardId) query.cardId = filters.cardId;
    if (filters.dueOnly) {
      query.status = { $in: ['scheduled', 'due'] };
      query.dueAt = { $lte: new Date() };
    }

    return FollowUpPlan.find(query)
      .sort({ dueAt: 1 })
      .populate('recommendationId interventionId boardId cardId memberId')
      .limit(filters.limit || 100);
  }

  async resolveFollowUp(followUpId, body = {}) {
    this.requireDatabase();
    const followUp = await FollowUpPlan.findOne(this.workspaceQuery(body, { _id: followUpId }));
    if (!followUp) {
      const error = new Error('Follow-up not found');
      error.statusCode = 404;
      throw error;
    }

    const allowedStatuses = new Set(['resolved', 'cancelled', 'escalated']);
    const nextStatus = body.status || 'resolved';
    if (!allowedStatuses.has(nextStatus)) {
      const error = new Error('Follow-up can only be resolved, cancelled, or escalated');
      error.statusCode = 400;
      throw error;
    }

    followUp.status = nextStatus;
    followUp.resolvedAt = new Date();
    followUp.resolvedBy = body.resolvedBy || 'sneup';
    followUp.resolutionNote = body.resolutionNote || '';
    followUp.outcome = body.outcome || (nextStatus === 'escalated' ? 'needs_attention' : 'manual');
    await followUp.save();

    await this.recordAudit({
      entityType: 'follow_up_plan',
      entityId: followUp._id,
      action: nextStatus === 'escalated' ? 'follow_up_escalated' : 'follow_up_resolved',
      actor: followUp.resolvedBy,
      source: 'api',
      riskLevel: nextStatus === 'escalated' ? 'medium' : 'low',
      recommendationId: followUp.recommendationId,
      afterState: followUp.toObject()
    });

    return followUp;
  }

  async recordWorkerResponse(body = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(body.workspaceId);
    const response = await WorkerResponse.create({
      workspaceId,
      recommendationId: body.recommendationId,
      interventionId: body.interventionId,
      boardId: body.boardId,
      cardId: body.cardId,
      memberId: body.memberId,
      responseText: body.responseText,
      responseType: body.responseType || 'other',
      source: body.source || 'api'
    });

    if (body.interventionId) {
      const intervention = await Intervention.findOne({ _id: body.interventionId, workspaceId });
      if (intervention && body.memberId) {
        await intervention.recordResponse(body.memberId, body.responseText, body.responseType || 'other');
      }
    }

    const followUpResolution = await this.resolveFollowUpsForWorkerResponse(response, body);

    await this.recordAudit({
      entityType: 'worker_response',
      entityId: response._id,
      action: 'worker_response_recorded',
      actor: body.actor || 'worker',
      source: response.source,
      riskLevel: 'low',
      recommendationId: response.recommendationId,
      afterState: {
        ...response.toObject(),
        followUpResolution
      }
    });

    if (followUpResolution.modifiedCount > 0) {
      await this.recordAudit({
        entityType: 'worker_response',
        entityId: response._id,
        action: 'follow_ups_resolved_from_worker_response',
        actor: body.actor || 'worker',
        source: response.source,
        riskLevel: followUpResolution.status === 'escalated' ? 'medium' : 'low',
        recommendationId: response.recommendationId,
        afterState: followUpResolution
      });
    }

    return response;
  }

  async resolveFollowUpsForWorkerResponse(response, body = {}) {
    const responseType = body.responseType || response.responseType || 'other';
    if (responseType === 'ignored') {
      return { matchedCount: 0, modifiedCount: 0, status: 'open' };
    }

    const workspaceId = this.resolveWorkspaceId(body.workspaceId || response.workspaceId);
    const matcher = {
      workspaceId,
      status: { $in: ['scheduled', 'due'] }
    };

    const or = [];
    if (response.recommendationId) or.push({ recommendationId: response.recommendationId });
    if (response.interventionId) or.push({ interventionId: response.interventionId });
    if (response.cardId && response.memberId) {
      or.push({
        cardId: response.cardId,
        memberId: response.memberId
      });
    } else if (response.cardId) {
      or.push({ cardId: response.cardId });
    }

    if (or.length === 0) {
      return { matchedCount: 0, modifiedCount: 0, status: 'unmatched' };
    }

    matcher.$or = or;

    const needsAttention = ['blocked', 'needs_help'].includes(responseType);
    const nextStatus = needsAttention ? 'escalated' : 'resolved';
    const outcome = responseType === 'completed'
      ? 'completed'
      : needsAttention
        ? 'needs_attention'
        : 'response_received';

    const result = await FollowUpPlan.updateMany(matcher, {
      $set: {
        status: nextStatus,
        resolvedAt: new Date(),
        resolvedBy: body.actor || 'worker',
        resolutionNote: `Worker response recorded: ${responseType}`,
        outcome
      }
    });

    return {
      matchedCount: result.matchedCount || result.n || 0,
      modifiedCount: result.modifiedCount || result.nModified || 0,
      status: nextStatus,
      outcome
    };
  }

  async scheduleFollowUp(recommendation) {
    if (!['comment', 'follow_up', 'escalate', 'performance_notification'].includes(recommendation.actionType)) {
      return null;
    }

    return FollowUpPlan.create({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation._id,
      interventionId: recommendation.interventionId,
      boardId: recommendation.boardId,
      cardId: recommendation.cardId,
      memberId: recommendation.memberId,
      reason: 'Verify whether the intervention received a useful response.',
      nextAction: 'Check worker response and escalate if no response arrives.',
      dueAt: new Date(Date.now() + 24 * HOURS),
      status: 'scheduled'
    });
  }

  async recordAudit(data) {
    if (!this.isDatabaseReady()) {
      logger.warn('Skipping audit event because database is not connected.');
      return null;
    }

    if (!data.boardId && data.afterState?.boardId) data.boardId = data.afterState.boardId;
    if (!data.cardId && data.afterState?.cardId) data.cardId = data.afterState.cardId;

    data.workspaceId = this.resolveWorkspaceId(data.workspaceId || data.afterState?.workspaceId || data.beforeState?.workspaceId);
    return AuditEvent.create(data);
  }

  buildActionPayload(intervention, card, member) {
    const payload = {
      interventionId: intervention._id,
      boardId: intervention.boardId,
      cardId: intervention.cardId,
      memberId: intervention.memberId,
      cardTrelloId: card?.trelloId,
      memberTrelloId: member?.trelloId,
      message: intervention.message,
      metadata: intervention.metadata || {}
    };

    if (['comment', 'follow_up', 'performance_notification'].includes(intervention.type)) {
      payload.commentText = member?.username
        ? `@${member.username} ${intervention.message}`
        : intervention.message;
    }

    if (intervention.type === 'escalate') {
      payload.commentText = `ESCALATION: ${intervention.message}`;
    }

    if (intervention.type === 'move_card') {
      payload.targetListId = intervention.metadata?.targetListId;
    }

    if (intervention.type === 'add_label') {
      payload.labelName = intervention.metadata?.labelName;
      payload.labelColor = intervention.metadata?.labelColor;
    }

    if (intervention.type === 'set_due_date') {
      payload.due = intervention.metadata?.due;
    }

    if (intervention.type === 'reassign') {
      payload.fromMemberId = intervention.metadata?.fromMemberId || intervention.memberId;
      payload.fromMemberTrelloId = intervention.metadata?.fromMemberTrelloId || member?.trelloId;
      payload.toMemberId = intervention.metadata?.toMemberId;
      payload.toMemberTrelloId = intervention.metadata?.toMemberTrelloId;
      payload.commentText = intervention.metadata?.commentText || intervention.message;
    }

    return payload;
  }

  describeAction(intervention, payload) {
    if (payload.commentText) {
      return `${intervention.action}: ${payload.commentText}`;
    }
    return intervention.action;
  }

  buildDecisionQuestion(recommendation) {
    return `${recommendation.recommendedAction} Approve: Yes/No.`;
  }

  defaultDecisionDueAt(riskLevel) {
    const hours = riskLevel === 'critical' ? 2 : riskLevel === 'high' ? 6 : 24;
    return new Date(Date.now() + hours * HOURS);
  }

  confidenceForIntervention(intervention) {
    if (intervention.severity === 'critical') return 0.85;
    if (intervention.severity === 'high') return 0.78;
    if (intervention.severity === 'medium') return 0.7;
    return 0.6;
  }

  confidenceForFinding(finding) {
    if (finding.severity === 'critical') return 0.86;
    if (finding.severity === 'high') return 0.78;
    if (finding.severity === 'medium') return 0.68;
    return 0.58;
  }

  defaultActionTypeForFinding(finding) {
    if (finding.findingType === 'unassigned') return 'reassign';
    if (finding.findingType === 'missing_next_action') return 'add_checklist';
    if (finding.findingType === 'blocked' || finding.findingType === 'robert_required') return 'escalate';
    return 'comment';
  }

  normalizeAutopilotCommand(command = {}) {
    if (!command || typeof command !== 'object') {
      const error = new Error('Autopilot command is required');
      error.statusCode = 400;
      throw error;
    }

    const type = String(command.type || '').trim();
    const title = String(command.title || '').trim();
    if (!type || !title) {
      const error = new Error('Autopilot command must include type and title');
      error.statusCode = 400;
      throw error;
    }

    return {
      id: String(command.id || `${type}-${Date.now()}`),
      type,
      status: command.status || 'review',
      severity: ['critical', 'high', 'medium', 'low'].includes(command.severity) ? command.severity : 'medium',
      title,
      target: command.target || '',
      owner: command.owner || 'Sneup',
      reason: command.reason || 'Autopilot recommended review.',
      automatable: command.automatable === true,
      minutesSaved: Number(command.minutesSaved) || 0,
      payload: command.payload && typeof command.payload === 'object' ? command.payload : {},
      sourceEvidence: Array.isArray(command.sourceEvidence) ? command.sourceEvidence : []
    };
  }

  async resolveAutopilotCommandRefs(command, options = {}) {
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const card = await this.findCardFromCommand(command, { workspaceId });
    const member = await this.findMemberFromCommand(command, { workspaceId });
    const boardId = this.objectIdOrNull(command.payload.boardId || card?.boardId);
    const cardId = this.objectIdOrNull(card?._id || command.payload.cardId);
    const memberId = this.objectIdOrNull(member?._id || command.payload.memberId);

    return { card, member, boardId, cardId, memberId };
  }

  async findCardFromCommand(command, options = {}) {
    const payload = command.payload || {};
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    if (this.objectIdOrNull(payload.cardId)) {
      const card = await Card.findOne({ _id: payload.cardId, workspaceId });
      if (card) return card;
    }
    if (payload.trelloId) {
      return Card.findOne({ trelloId: payload.trelloId, workspaceId });
    }
    return null;
  }

  async findMemberFromCommand(command, options = {}) {
    const payload = command.payload || {};
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    if (this.objectIdOrNull(payload.memberId)) {
      const member = await Member.findOne({ _id: payload.memberId, workspaceId });
      if (member) return member;
    }
    if (payload.memberTrelloId) {
      return Member.findOne({ trelloId: payload.memberTrelloId, workspaceId });
    }
    return null;
  }

  objectIdOrNull(value) {
    if (!value) return null;
    const candidate = value._id || value;
    return mongoose.Types.ObjectId.isValid(candidate) ? candidate : null;
  }

  buildAutopilotActionSpec(command, card = null, member = null) {
    const cardTrelloId = command.payload.trelloId || card?.trelloId;
    const basePayload = {
      commandId: command.id,
      commandType: command.type,
      source: 'autopilot',
      target: command.target,
      reason: command.reason,
      minutesSaved: command.minutesSaved,
      commandPayload: command.payload || {},
      cardId: this.objectIdOrNull(card?._id || command.payload.cardId),
      boardId: this.objectIdOrNull(command.payload.boardId || card?.boardId),
      memberId: this.objectIdOrNull(member?._id || command.payload.memberId),
      cardTrelloId
    };

    if (command.type === 'request_update') {
      const mention = command.owner && !['Sneup', 'Unassigned'].includes(command.owner)
        ? `@${command.owner} `
        : '';
      return {
        actionType: 'comment',
        recommendedAction: `Post a Trello status request for "${command.title}".`,
        actionPayload: {
          ...basePayload,
          executable: Boolean(cardTrelloId),
          draftOnly: !cardTrelloId,
          commentText: `${mention}Please post a crisp status update and the next concrete action today.`
        },
        confidence: 0.72
      };
    }

    if (command.type === 'escalate_overdue') {
      return {
        actionType: 'escalate',
        recommendedAction: `Escalate overdue work: ${command.title}.`,
        actionPayload: {
          ...basePayload,
          executable: Boolean(cardTrelloId),
          draftOnly: !cardTrelloId,
          commentText: `ESCALATION: This card is overdue and still open. Please confirm owner, blocker, and next action today.`
        },
        confidence: 0.82
      };
    }

    if (command.type === 'assign_owner') {
      return {
        actionType: 'reassign',
        recommendedAction: `Choose and assign an accountable owner for "${command.title}".`,
        approvalReason: 'Autopilot detected unowned work, but a human must choose the exact target owner before Trello can be changed.',
        actionPayload: {
          ...basePayload,
          executable: false,
          draftOnly: true,
          requiredChange: 'Select toMemberId and toMemberTrelloId before execution.'
        },
        ownerType: 'robert',
        confidence: 0.76
      };
    }

    if (command.type === 'retry_intervention') {
      return {
        actionType: 'follow_up',
        recommendedAction: `Review and retry prior intervention: ${command.title}.`,
        approvalReason: 'A prior intervention needs human review before retrying.',
        actionPayload: {
          ...basePayload,
          interventionId: command.payload.interventionId,
          executable: false,
          draftOnly: true,
          requiredChange: 'Open the linked intervention and approve the exact retry payload.'
        },
        confidence: 0.68
      };
    }

    if (command.type === 'graph_decision') {
      const graphPayload = command.payload || {};
      return {
        actionType: graphPayload.actionType || 'manual_review',
        recommendedAction: graphPayload.recommendedAction || `${command.title} Review: Yes/No.`,
        approvalReason: 'A normalized work graph decision needs human approval before any provider-specific action payload can be prepared.',
        actionPayload: {
          ...basePayload,
          ...(graphPayload.actionPayload || {}),
          source: 'work_graph',
          workItemId: graphPayload.workItemId,
          sourceProvider: graphPayload.sourceProvider,
          externalId: graphPayload.externalId,
          canonicalKey: graphPayload.canonicalKey,
          providerUrl: graphPayload.providerUrl,
          dependencySummary: graphPayload.dependencySummary || {},
          externalProviderWriteBlocked: true,
          executable: false,
          draftOnly: true,
          requiredChange: 'Approve the decision, then convert it into an exact provider-specific action payload before execution.'
        },
        requiresApproval: true,
        ownerType: graphPayload.ownerType || (command.severity === 'critical' || command.severity === 'high' ? 'robert' : 'team'),
        riskLevel: command.severity === 'critical' ? 'critical' : command.severity,
        confidence: graphPayload.confidence || 0.7
      };
    }

    return {
      actionType: 'manual_review',
      recommendedAction: `${command.title} Review: Yes/No.`,
      approvalReason: 'This autopilot command changes priorities or accountability and needs human confirmation before any Trello write is prepared.',
      actionPayload: {
        ...basePayload,
        executable: false,
        draftOnly: true,
        requiredChange: 'Convert this review decision into an exact Trello action payload before execution.'
      },
      requiresApproval: true,
      ownerType: command.severity === 'critical' || command.severity === 'high' ? 'robert' : 'team',
      riskLevel: command.severity === 'critical' ? 'critical' : command.severity,
      confidence: command.automatable ? 0.7 : 0.62
    };
  }

  buildAutopilotSourceEvidence(command, card, member) {
    return [
      {
        type: 'system',
        entityId: command.id,
        label: command.type,
        observedAt: new Date(),
        data: {
          title: command.title,
          target: command.target,
          owner: command.owner,
          reason: command.reason,
          automatable: command.automatable,
          minutesSaved: command.minutesSaved
        }
      },
      card ? {
        type: 'card',
        entityId: card._id,
        label: card.name,
        url: card.url,
        observedAt: card.updatedAt || card.lastActivity
      } : null,
      member ? {
        type: 'member',
        entityId: member._id,
        label: member.username || member.fullName
      } : null,
      ...(command.sourceEvidence || []),
      ...((command.payload && Array.isArray(command.payload.sourceEvidence)) ? command.payload.sourceEvidence : [])
    ].filter(Boolean);
  }

  buildSourceEvidence(intervention, card, member) {
    return [
      {
        type: 'intervention',
        entityId: intervention._id,
        label: intervention.trigger,
        observedAt: intervention.createdAt || new Date(),
        data: {
          action: intervention.action,
          severity: intervention.severity
        }
      },
      card ? {
        type: 'card',
        entityId: card._id,
        label: card.name,
        url: card.url,
        observedAt: card.updatedAt || card.lastActivity
      } : null,
      member ? {
        type: 'member',
        entityId: member._id,
        label: member.username || member.fullName
      } : null
    ].filter(Boolean);
  }

  normalizeEvidenceRefs(items = []) {
    return items.map((item = {}) => ({
      type: item.type || 'system',
      entityId: item.entityId,
      label: item.label || item.type || 'Evidence',
      url: item.url || null,
      observedAt: item.observedAt || null,
      data: item.data || {}
    }));
  }
}

module.exports = new OperationsLedgerService();
