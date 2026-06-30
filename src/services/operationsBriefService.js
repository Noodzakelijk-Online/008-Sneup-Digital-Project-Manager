const mongoose = require('mongoose');
const DecisionQueueItem = require('../models/DecisionQueueItem');
const Recommendation = require('../models/Recommendation');
const TrelloActionAttempt = require('../models/TrelloActionAttempt');
const FollowUpPlan = require('../models/FollowUpPlan');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');
const workGraphService = require('./workGraphService');

const SEVERITY_SCORE = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

class OperationsBriefService {
  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  async getDailyBrief(options = {}) {
    if (!this.isDatabaseReady()) {
      return this.getDemoDailyBrief();
    }

    const limit = options.limit || 100;
    const now = new Date();
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId);

    const [
      decisions,
      recommendations,
      failedActions,
      dueFollowUps,
      findings,
      healthSnapshots,
      graphDecisionResult
    ] = await Promise.all([
      DecisionQueueItem.find({ workspaceId, status: 'open' })
        .populate('recommendationId boardId cardId')
        .sort({ riskLevel: -1, dueAt: 1, createdAt: 1 })
        .limit(limit),
      Recommendation.find({ workspaceId, status: { $in: ['pending', 'approved', 'change_requested', 'failed'] } })
        .populate('boardId cardId memberId')
        .sort({ riskLevel: -1, createdAt: 1 })
        .limit(limit),
      TrelloActionAttempt.find({ workspaceId, status: 'failed' })
        .populate('recommendationId boardId cardId')
        .sort({ createdAt: -1 })
        .limit(25),
      FollowUpPlan.find({
        workspaceId,
        status: { $in: ['scheduled', 'due'] },
        dueAt: { $lte: now }
      })
        .populate('recommendationId interventionId boardId cardId memberId')
        .sort({ dueAt: 1 })
        .limit(50),
      CardFinding.find({ workspaceId, status: 'open' })
        .populate('boardId cardId memberId')
        .sort({ lastObservedAt: -1 })
        .limit(limit),
      BoardHealthSnapshot.find({ workspaceId })
        .populate('boardId')
        .sort({ generatedAt: -1 })
        .limit(50),
      workGraphService.listDecisionCandidates({
        workspaceId,
        limit: Math.min(limit, 25)
      })
    ]);

    return this.buildBrief({
      mode: 'live',
      generatedAt: now,
      decisions,
      recommendations,
      failedActions,
      dueFollowUps,
      findings,
      healthSnapshots,
      graphDecisionCandidates: graphDecisionResult.candidates || []
    });
  }

  buildBrief(records = {}) {
    const decisions = records.decisions || [];
    const graphDecisionCandidates = this.normalizeGraphDecisionCandidates(records.graphDecisionCandidates || []);
    const decisionItems = [
      ...decisions,
      ...graphDecisionCandidates
    ];
    const recommendations = records.recommendations || [];
    const failedActions = records.failedActions || [];
    const dueFollowUps = records.dueFollowUps || [];
    const findings = records.findings || [];
    const healthSnapshots = this.latestHealthByBoard(records.healthSnapshots || []);
    const generatedAt = records.generatedAt || new Date();

    const robertDecisions = this.sortPriority(decisionItems.filter(item => item.ownerType === 'robert'));
    const vaReady = this.sortPriority([
      ...decisionItems.filter(item => item.ownerType === 'va'),
      ...findings.filter(item => item.waitingOn === 'va')
    ]);
    const teamQueue = this.sortPriority([
      ...decisionItems.filter(item => item.ownerType === 'team'),
      ...findings.filter(item => ['team', 'worker', 'external'].includes(item.waitingOn))
    ]);
    const criticalFindings = this.sortPriority(findings.filter(item =>
      ['critical', 'high'].includes(item.severity)
    ));
    const boardsAtRisk = healthSnapshots.filter(snapshot =>
      ['critical', 'at_risk'].includes(snapshot.healthStatus)
    );

    const topDecision = robertDecisions[0] || decisionItems[0] || recommendations[0] || criticalFindings[0];
    const confidence = this.calculateConfidence({
      decisions: decisionItems,
      failedActions,
      dueFollowUps,
      findings,
      boardsAtRisk
    });

    return {
      mode: records.mode || 'live',
      generatedAt,
      readonly: true,
      headline: this.buildHeadline({ robertDecisions, boardsAtRisk, failedActions, criticalFindings }),
      narrative: this.buildNarrative({ robertDecisions, vaReady, teamQueue, failedActions, dueFollowUps, boardsAtRisk }),
      nextDecision: this.describeDecision(topDecision),
      confidence,
      counts: {
        robertDecisions: robertDecisions.length,
        vaReady: vaReady.length,
        teamQueue: teamQueue.length,
        failedActions: failedActions.length,
        dueFollowUps: dueFollowUps.length,
        highRiskFindings: criticalFindings.length,
        boardsAtRisk: boardsAtRisk.length,
        graphDecisions: graphDecisionCandidates.length,
        pendingRecommendations: recommendations.filter(item => ['pending', 'approved', 'change_requested'].includes(item.status)).length
      },
      robertDecisions: robertDecisions.slice(0, 5).map(item => this.toBriefItem(item, 'robert_decision')),
      vaReady: vaReady.slice(0, 5).map(item => this.toBriefItem(item, 'va_ready')),
      teamQueue: teamQueue.slice(0, 5).map(item => this.toBriefItem(item, 'team_queue')),
      failedActions: failedActions.slice(0, 5).map(item => this.toBriefItem(item, 'failed_action')),
      dueFollowUps: dueFollowUps.slice(0, 5).map(item => this.toBriefItem(item, 'follow_up_due')),
      boardHealth: boardsAtRisk.slice(0, 5).map(item => this.toBriefItem(item, 'board_health')),
      graphDecisions: graphDecisionCandidates.slice(0, 5).map(item => this.toBriefItem(item, 'graph_decision')),
      morningPlan: this.buildMorningPlan({
        robertDecisions,
        vaReady,
        teamQueue,
        failedActions,
        dueFollowUps,
        boardsAtRisk
      })
    };
  }

  buildHeadline({ robertDecisions, boardsAtRisk, failedActions, criticalFindings }) {
    if (failedActions.length > 0) {
      return `${failedActions.length} failed Trello action${failedActions.length === 1 ? '' : 's'} need review`;
    }
    if (robertDecisions.length > 0) {
      return `${robertDecisions.length} Robert decision${robertDecisions.length === 1 ? '' : 's'} waiting`;
    }
    if (boardsAtRisk.length > 0) {
      return `${boardsAtRisk.length} board${boardsAtRisk.length === 1 ? '' : 's'} need recovery attention`;
    }
    if (criticalFindings.length > 0) {
      return `${criticalFindings.length} high-risk finding${criticalFindings.length === 1 ? '' : 's'} detected`;
    }
    return 'No critical operating decisions waiting';
  }

  buildNarrative({ robertDecisions, vaReady, teamQueue, failedActions, dueFollowUps, boardsAtRisk }) {
    const parts = [];
    parts.push(this.sentenceCount(robertDecisions.length, 'item', 'requires Robert', 'require Robert'));
    parts.push(this.sentenceCount(vaReady.length, 'item', 'is VA-ready', 'are VA-ready'));
    parts.push(this.sentenceCount(teamQueue.length, 'team follow-up', 'is queued', 'are queued'));
    if (failedActions.length > 0) parts.push(`${failedActions.length} Trello write attempt${failedActions.length === 1 ? '' : 's'} failed.`);
    if (dueFollowUps.length > 0) parts.push(this.sentenceCount(dueFollowUps.length, 'follow-up', 'is due', 'are due'));
    if (boardsAtRisk.length > 0) parts.push(this.sentenceCount(boardsAtRisk.length, 'board', 'is at risk', 'are at risk'));
    return parts.join(' ');
  }

  describeDecision(item) {
    if (!item) {
      return 'Refresh after the next Trello sync; no decision is currently queued.';
    }

    if (item.question) return item.question;
    if (item.recommendedAction) return `${item.recommendedAction} Approve: Yes/No.`;
    if (item.title) return `${item.title} Approve: Yes/No.`;
    if (item.reason) return item.reason;
    return 'Review the top operating item.';
  }

  buildMorningPlan({ robertDecisions, vaReady, teamQueue, failedActions, dueFollowUps, boardsAtRisk }) {
    const plan = [];
    if (failedActions.length > 0) {
      plan.push(`Inspect ${failedActions.length} failed Trello action${failedActions.length === 1 ? '' : 's'} before approving more writes.`);
    }
    if (robertDecisions.length > 0) {
      plan.push(`Answer the top ${Math.min(robertDecisions.length, 3)} Robert Yes/No decision${robertDecisions.length === 1 ? '' : 's'}.`);
    }
    if (boardsAtRisk.length > 0) {
      plan.push(`Review recovery status for ${this.displayName(boardsAtRisk[0].boardId) || 'the highest-risk board'}.`);
    }
    if (dueFollowUps.length > 0) {
      plan.push(`Clear ${dueFollowUps.length} due worker follow-up${dueFollowUps.length === 1 ? '' : 's'}.`);
    }
    if (vaReady.length > 0) {
      plan.push(`Delegate ${Math.min(vaReady.length, 3)} VA-ready item${vaReady.length === 1 ? '' : 's'}.`);
    }
    if (teamQueue.length > 0 && plan.length < 5) {
      plan.push(`Push ${Math.min(teamQueue.length, 3)} team accountability item${teamQueue.length === 1 ? '' : 's'}.`);
    }
    if (plan.length === 0) {
      plan.push('No urgent operating cleanup is needed; keep monitoring after the next sync.');
    }
    return plan.slice(0, 5);
  }

  toBriefItem(item, type) {
    const board = item.boardId || item.board || {};
    const card = item.cardId || item.card || {};
    const recommendation = item.recommendationId || {};

    return {
      id: this.toId(item._id || item.id),
      type,
      title: item.question || item.title || item.recommendedAction || item.reason || item.actionType || item.summary || 'Operating item',
      reason: item.reason || item.description || item.errorMessage || item.recommendedAction || item.summary || '',
      riskLevel: item.riskLevel || item.severity || this.statusToRisk(item.healthStatus) || 'medium',
      status: item.status || item.healthStatus || 'open',
      ownerType: item.ownerType || item.waitingOn || undefined,
      boardName: this.displayName(board),
      cardName: this.displayName(card),
      dueAt: item.dueAt,
      generatedAt: item.generatedAt,
      sourceCount: (item.sourceEvidence || recommendation.sourceEvidence || []).length,
      sourceSystem: item.sourceSystem,
      sourceProvider: item.sourceProvider,
      externalId: item.externalId,
      providerUrl: item.providerUrl || item.url || '',
      workItemId: item.workItemId,
      draftOnly: item.draftOnly || item.actionPayload?.draftOnly || false,
      executable: item.executable || item.actionPayload?.executable || false
    };
  }

  normalizeGraphDecisionCandidates(candidates) {
    return candidates.map(candidate => ({
      ...candidate,
      id: candidate.id || candidate.workItemId || candidate.externalId || candidate.canonicalKey,
      status: candidate.status || 'open',
      sourceSystem: 'work_graph',
      providerUrl: candidate.providerUrl || candidate.actionPayload?.providerUrl || '',
      sourceProvider: candidate.sourceProvider || candidate.actionPayload?.sourceProvider,
      externalId: candidate.externalId || candidate.actionPayload?.externalId,
      draftOnly: candidate.draftOnly ?? candidate.actionPayload?.draftOnly ?? true,
      executable: candidate.executable ?? candidate.actionPayload?.executable ?? false
    }));
  }

  latestHealthByBoard(snapshots) {
    const latest = new Map();
    for (const snapshot of snapshots) {
      const boardId = this.toId(snapshot.boardId) || this.toId(snapshot._id);
      if (!boardId || latest.has(boardId)) continue;
      latest.set(boardId, snapshot);
    }
    return [...latest.values()];
  }

  sortPriority(items) {
    return [...items].sort((left, right) => {
      const severityDiff = this.priorityScore(right) - this.priorityScore(left);
      if (severityDiff !== 0) return severityDiff;
      return new Date(left.dueAt || left.lastObservedAt || left.createdAt || 0) -
        new Date(right.dueAt || right.lastObservedAt || right.createdAt || 0);
    });
  }

  priorityScore(item) {
    return SEVERITY_SCORE[item.riskLevel] || SEVERITY_SCORE[item.severity] || this.statusScore(item.healthStatus) || 0;
  }

  statusScore(status) {
    if (status === 'critical') return 4;
    if (status === 'at_risk') return 3;
    if (status === 'watch') return 2;
    return 0;
  }

  statusToRisk(status) {
    if (status === 'critical') return 'critical';
    if (status === 'at_risk') return 'high';
    if (status === 'watch') return 'medium';
    return 'low';
  }

  calculateConfidence({ decisions, failedActions, dueFollowUps, findings, boardsAtRisk }) {
    let confidence = 88;
    confidence -= failedActions.length * 8;
    confidence -= decisions.filter(item => item.riskLevel === 'critical').length * 5;
    confidence -= boardsAtRisk.filter(item => item.healthStatus === 'critical').length * 6;
    confidence -= dueFollowUps.length * 2;
    confidence -= findings.filter(item => item.severity === 'critical').length * 3;
    return Math.max(25, Math.min(98, confidence));
  }

  displayName(value) {
    if (!value) return '';
    if (typeof value === 'string') return '';
    return value.name || value.title || value.username || value.fullName || '';
  }

  sentenceCount(count, noun, singularVerb, pluralVerb) {
    return `${count} ${noun}${count === 1 ? '' : 's'} ${count === 1 ? singularVerb : pluralVerb}.`;
  }

  toId(value) {
    if (!value) return '';
    return String(value._id || value.id || value);
  }

  getDemoDailyBrief() {
    const now = new Date();
    return this.buildBrief({
      mode: 'demo',
      generatedAt: now,
      decisions: [
        {
          _id: 'demo-decision-1',
          ownerType: 'robert',
          question: 'Approve recovery plan for Growth Experiments: Yes/No.',
          reason: 'Campaign dependencies are blocked and production is saturated.',
          riskLevel: 'critical',
          status: 'open',
          boardId: { name: 'Growth Experiments' },
          dueAt: now
        },
        {
          _id: 'demo-decision-2',
          ownerType: 'team',
          question: 'Post a crisp update request to paid campaign owner: Yes/No.',
          reason: 'No activity for 6 days.',
          riskLevel: 'medium',
          status: 'open',
          cardId: { name: 'Clear copy approvals for paid campaign' }
        }
      ],
      recommendations: [
        {
          _id: 'demo-recommendation-1',
          status: 'pending',
          riskLevel: 'critical',
          recommendedAction: 'Run Growth Experiments recovery plan'
        }
      ],
      failedActions: [],
      dueFollowUps: [
        {
          _id: 'demo-follow-up-1',
          reason: 'Verify launch checklist response.',
          nextAction: 'Check whether Nina responded with the next action.',
          status: 'due',
          riskLevel: 'medium',
          dueAt: now,
          cardId: { name: 'Approve launch checklist for Sneup onboarding' }
        }
      ],
      findings: [
        {
          _id: 'demo-finding-1',
          title: 'Analytics webhook rollout has no owner',
          description: 'Unowned work has no accountable path to completion.',
          findingType: 'unassigned',
          waitingOn: 'va',
          severity: 'high',
          status: 'open',
          cardId: { name: 'Analytics webhook rollout' }
        }
      ],
      healthSnapshots: [
        {
          _id: 'demo-health-1',
          boardId: { name: 'Growth Experiments' },
          healthStatus: 'critical',
          healthScore: 42,
          summary: 'Production queue is saturated and owner capacity is overloaded.',
          generatedAt: now
        }
      ]
    });
  }
}

module.exports = new OperationsBriefService();
