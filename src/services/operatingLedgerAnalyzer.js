const mongoose = require('mongoose');
const Board = require('../models/Board');
const Card = require('../models/Card');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const operationsLedgerService = require('./operationsLedgerService');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const DAY_MS = 24 * 60 * 60 * 1000;

class OperatingLedgerAnalyzer {
  requireDatabase() {
    if (mongoose.connection.readyState !== 1) {
      const error = new Error('Database connection is required for board analysis');
      error.statusCode = 503;
      throw error;
    }
  }

  async analyzeBoard(boardId, options = {}) {
    this.requireDatabase();
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());

    const board = await Board.findOne({ _id: boardId, workspaceId });
    if (!board) {
      const error = new Error('Board not found');
      error.statusCode = 404;
      throw error;
    }

    const cards = await Card.find({ boardId, workspaceId, closed: false })
      .populate('listId')
      .populate('members')
      .populate('comments');

    const detectedFindings = [];
    for (const card of cards) {
      detectedFindings.push(...this.detectCardFindings(board, card));
    }

    const findings = [];
    for (const findingData of detectedFindings) {
      findings.push(await this.upsertFinding({ ...findingData, workspaceId }));
    }

    const snapshot = await this.createHealthSnapshot(board, cards, findings, { workspaceId });
    const recommendations = [];

    if (options.createRecommendations !== false) {
      const actionableFindings = findings
        .filter(finding => ['critical', 'high', 'medium'].includes(finding.severity))
        .slice(0, options.recommendationLimit || 25);

      for (const finding of actionableFindings) {
        recommendations.push(await operationsLedgerService.createRecommendationFromFinding(
          finding,
          this.buildRecommendationSpec(finding, { workspaceId })
        ));
      }
    }

    await operationsLedgerService.recordAudit({
      entityType: 'board',
      entityId: board._id,
      workspaceId,
      boardId: board._id,
      action: 'board_analysis_completed',
      actor: 'sneup',
      source: 'worker',
      riskLevel: snapshot.healthStatus === 'critical' ? 'critical' : snapshot.healthStatus === 'at_risk' ? 'high' : 'low',
      afterState: {
        snapshotId: snapshot._id,
        healthScore: snapshot.healthScore,
        healthStatus: snapshot.healthStatus,
        findingCount: findings.length
      }
    });

    return {
      board,
      snapshot,
      findings,
      recommendations
    };
  }

  detectCardFindings(board, card) {
    const findings = [];
    const now = Date.now();
    const daysSinceActivity = card.lastActivity
      ? Math.floor((now - new Date(card.lastActivity).getTime()) / DAY_MS)
      : 999;
    const list = card.listId;
    const member = Array.isArray(card.members) && card.members.length > 0 ? card.members[0] : null;
    const evidence = this.cardEvidence(board, card);
    const text = `${card.name || ''} ${card.description || ''} ${(card.labels || []).map(label => label.name).join(' ')}`.toLowerCase();

    if (card.isOverdue()) {
      findings.push(this.finding(board, card, member, {
        findingType: 'overdue',
        severity: 'high',
        waitingOn: member ? 'worker' : 'team',
        signalScore: 82,
        title: `Overdue card: ${card.name}`,
        description: 'The due date has passed and the card is still open.',
        recommendedAction: 'Ask for a concrete completion update today.',
        sourceEvidence: evidence
      }));
    }

    if (!card.members || card.members.length === 0) {
      findings.push(this.finding(board, card, null, {
        findingType: 'unassigned',
        severity: 'high',
        waitingOn: 'team',
        signalScore: 76,
        title: `No owner assigned: ${card.name}`,
        description: 'The card has no assigned member, so accountability is unclear.',
        recommendedAction: 'Assign an owner or move this to the VA/team queue.',
        sourceEvidence: evidence
      }));
    }

    if (daysSinceActivity >= 7) {
      findings.push(this.finding(board, card, member, {
        findingType: 'stale',
        severity: daysSinceActivity >= 14 ? 'high' : 'medium',
        waitingOn: member ? 'worker' : 'team',
        signalScore: Math.min(95, 45 + daysSinceActivity * 3),
        title: `No recent activity: ${card.name}`,
        description: `No activity has been recorded for ${daysSinceActivity} days.`,
        recommendedAction: 'Post a status-update request with a clear next-action ask.',
        sourceEvidence: evidence
      }));
    }

    if (this.hasNoNextAction(card)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'missing_next_action',
        severity: 'medium',
        waitingOn: 'team',
        signalScore: 64,
        title: `Missing next action: ${card.name}`,
        description: 'The card does not expose an obvious incomplete checklist item or next-action phrase.',
        recommendedAction: 'Add a short checklist with the next concrete action.',
        sourceEvidence: evidence
      }));
    }

    if (this.hasBlockedSignal(card)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'blocked',
        severity: 'critical',
        waitingOn: 'robert',
        signalScore: 92,
        title: `Blocked work: ${card.name}`,
        description: 'The card is marked or described as blocked.',
        recommendedAction: 'Escalate the blocker into Robert queue with the exact unblock decision.',
        sourceEvidence: evidence
      }));
    }

    if (list && card.isStuck(list.averageTimeInList)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'stuck',
        severity: 'high',
        waitingOn: member ? 'worker' : 'team',
        signalScore: 80,
        title: `Stuck in ${list.name}: ${card.name}`,
        description: 'The card has been in the current list longer than expected workflow time.',
        recommendedAction: 'Ask for the blocking reason and expected handoff date.',
        sourceEvidence: evidence
      }));
    }

    if (this.requiresRobert(text)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'robert_required',
        severity: 'high',
        waitingOn: 'robert',
        signalScore: 84,
        title: `Robert decision likely required: ${card.name}`,
        description: 'The card contains money, legal, client, contract, government, or policy signals.',
        recommendedAction: 'Keep this in Robert queue and require explicit Yes/No approval.',
        sourceEvidence: evidence
      }));
    } else if (this.isVaReady(card)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'va_ready',
        severity: 'low',
        waitingOn: 'va',
        signalScore: 56,
        title: `VA-ready work: ${card.name}`,
        description: 'The card appears procedural, low-risk, and ready for delegation.',
        recommendedAction: 'Queue this for VA handling without escalating to Robert.',
        sourceEvidence: evidence
      }));
    }

    if (this.hasExternalWaitingSignal(text)) {
      findings.push(this.finding(board, card, member, {
        findingType: 'external_waiting',
        severity: 'medium',
        waitingOn: 'external',
        signalScore: 62,
        title: `Waiting externally: ${card.name}`,
        description: 'The card appears to be waiting on a client, vendor, or external party.',
        recommendedAction: 'Create a follow-up plan with a specific external owner.',
        sourceEvidence: evidence
      }));
    }

    return findings;
  }

  finding(board, card, member, data) {
    return {
      boardId: board._id,
      cardId: card._id,
      memberId: member?._id,
      workspaceId: board.workspaceId,
      ...data
    };
  }

  async upsertFinding(data) {
    const existing = await CardFinding.findOne({
      boardId: data.boardId,
      cardId: data.cardId,
      workspaceId: data.workspaceId,
      findingType: data.findingType,
      status: 'open'
    });

    if (existing) {
      existing.memberId = data.memberId;
      existing.title = data.title;
      existing.description = data.description;
      existing.severity = data.severity;
      existing.waitingOn = data.waitingOn;
      existing.signalScore = data.signalScore;
      existing.recommendedAction = data.recommendedAction;
      existing.sourceEvidence = data.sourceEvidence;
      existing.lastObservedAt = new Date();
      return existing.save();
    }

    return CardFinding.create(data);
  }

  async createHealthSnapshot(board, cards, findings, options = {}) {
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || board.workspaceId || getDefaultWorkspaceObjectId());
    const counts = {
      activeCards: cards.length,
      overdueCards: findings.filter(finding => finding.findingType === 'overdue').length,
      staleCards: findings.filter(finding => finding.findingType === 'stale').length,
      blockedCards: findings.filter(finding => finding.findingType === 'blocked').length,
      unassignedCards: findings.filter(finding => finding.findingType === 'unassigned').length,
      missingNextActionCards: findings.filter(finding => finding.findingType === 'missing_next_action').length,
      highRiskCards: findings.filter(finding => ['high', 'critical'].includes(finding.severity)).length,
      robertQueueCandidates: findings.filter(finding => finding.waitingOn === 'robert').length,
      vaReadyCandidates: findings.filter(finding => finding.waitingOn === 'va').length,
      findings: findings.length
    };

    const penalty = (counts.overdueCards * 8)
      + (counts.blockedCards * 10)
      + (counts.unassignedCards * 6)
      + (counts.missingNextActionCards * 4)
      + (counts.staleCards * 3);
    const healthScore = Math.max(0, Math.min(100, 100 - penalty));
    const healthStatus = healthScore < 45 ? 'critical' : healthScore < 70 ? 'at_risk' : healthScore < 86 ? 'watch' : 'healthy';
    const findingsByType = findings.reduce((acc, finding) => {
      acc[finding.findingType] = (acc[finding.findingType] || 0) + 1;
      return acc;
    }, {});
    const cardNames = new Map(cards.map(card => [String(card._id), card.name]));
    const topRisks = findings
      .filter(finding => ['critical', 'high'].includes(finding.severity))
      .sort((left, right) => right.signalScore - left.signalScore)
      .slice(0, 5)
      .map(finding => ({
        cardId: finding.cardId,
        cardName: cardNames.get(String(finding.cardId)),
        findingType: finding.findingType,
        severity: finding.severity,
        reason: finding.description
      }));

    return BoardHealthSnapshot.create({
      boardId: board._id,
      workspaceId,
      healthScore,
      healthStatus,
      counts,
      findingsByType,
      topRisks,
      summary: this.healthSummary(board, healthStatus, counts)
    });
  }

  buildRecommendationSpec(finding, options = {}) {
    const actionTypeByFinding = {
      overdue: 'comment',
      stale: 'comment',
      missing_next_action: 'add_checklist',
      unassigned: 'reassign',
      blocked: 'escalate',
      stuck: 'comment',
      robert_required: 'escalate',
      external_waiting: 'follow_up',
      va_ready: 'comment'
    };

    const actionType = actionTypeByFinding[finding.findingType] || 'comment';
    return {
      title: finding.title,
      recommendedAction: `${finding.recommendedAction} Approve: Yes/No.`,
      actionType,
      ownerType: this.ownerTypeForFinding(finding),
      workspaceId: options.workspaceId || finding.workspaceId,
      actionPayload: {
        draftOnly: true,
        proposedText: finding.recommendedAction,
        findingType: finding.findingType
      }
    };
  }

  ownerTypeForFinding(finding) {
    if (finding.waitingOn === 'robert') return 'robert';
    if (finding.waitingOn === 'va') return 'va';
    if (['team', 'worker', 'external'].includes(finding.waitingOn)) return 'team';
    return 'team';
  }

  cardEvidence(board, card) {
    return [
      {
        type: 'board',
        entityId: board._id,
        label: board.name,
        url: board.url,
        observedAt: new Date()
      },
      {
        type: 'card',
        entityId: card._id,
        label: card.name,
        observedAt: card.updatedAt || card.lastActivity,
        data: {
          due: card.due,
          dueComplete: card.dueComplete,
          riskLevel: card.riskLevel,
          labels: (card.labels || []).map(label => label.name).filter(Boolean)
        }
      }
    ];
  }

  hasNoNextAction(card) {
    const hasIncompleteChecklist = (card.checklists || [])
      .some(checklist => (checklist.items || []).some(item => !item.complete));
    if (hasIncompleteChecklist) return false;

    const text = `${card.name || ''} ${card.description || ''}`.toLowerCase();
    return !/(next action|todo|to do|follow up|follow-up|call|email|send|review|approve|ship|deploy|assign|fix|write|check)/i.test(text);
  }

  hasBlockedSignal(card) {
    const text = `${card.name || ''} ${card.description || ''} ${(card.labels || []).map(label => label.name).join(' ')}`.toLowerCase();
    return /\b(blocked|blocker|stuck|cannot proceed|dependenc(?:y|ies))\b/i.test(text);
  }

  requiresRobert(text) {
    return /\b(robert|legal|contract|invoice|payment|money|tax|government|policy|commitment|signature|budget)\b/i.test(text);
  }

  hasExternalWaitingSignal(text) {
    return /(waiting on client|waiting for client|vendor|supplier|external|third party|third-party|customer reply|client reply)/i.test(text);
  }

  isVaReady(card) {
    const text = `${card.name || ''} ${card.description || ''} ${(card.labels || []).map(label => label.name).join(' ')}`.toLowerCase();
    return /(va|virtual assistant|admin|research|data entry|upload|format|cleanup|clean up|schedule)/i.test(text)
      && !this.requiresRobert(text)
      && !card.isOverdue();
  }

  healthSummary(board, healthStatus, counts) {
    return `${board.name} is ${healthStatus}: ${counts.findings} open findings, ${counts.overdueCards} overdue, ${counts.blockedCards} blocked, ${counts.missingNextActionCards} missing next action.`;
  }
}

module.exports = new OperatingLedgerAnalyzer();
