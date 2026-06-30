const mongoose = require('mongoose');
const WorkActor = require('../models/WorkActor');
const WorkComment = require('../models/WorkComment');
const WorkContainer = require('../models/WorkContainer');
const WorkEvent = require('../models/WorkEvent');
const WorkItem = require('../models/WorkItem');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unknown';

const asDate = (value) => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const signalId = (signal) => signal?._id || signal?.id;
const OPEN_STATUSES = new Set(['open', 'in_progress', 'blocked', 'waiting', 'unknown']);
const ROBERT_SENSITIVE_PATTERN = /\b(robert|client|legal|contract|money|budget|invoice|payment|government|tax|compliance|commitment|approval)\b/i;

class WorkGraphService {
  buildProjection(signal) {
    const provider = signal.provider || signal.sourceProvider || 'unknown';
    const externalId = String(signal.externalId || '').trim();
    const workspaceId = this.resolveWorkspaceId(signal.workspaceId);
    const canonicalKey = `${provider}:${externalId}`;
    const ownerKeys = (signal.owners || []).map(owner => `${provider}:actor:${slugify(owner)}`);
    const containerKey = this.containerKeyForSignal(signal);
    const providerUpdatedAt = asDate(signal.providerUpdatedAt || signal.updatedAt || signal.lastSeenAt);
    const eventStamp = providerUpdatedAt ? providerUpdatedAt.toISOString() : String(signal.lastSeenAt || signal.updatedAt || Date.now());

    return {
      workspaceId,
      sourceProvider: provider,
      connectorAccountId: signal.connectorAccountId,
      sourceSignalId: signalId(signal),
      externalId,
      canonicalKey,
      title: signal.title,
      description: signal.description || '',
      itemType: this.itemTypeForSignal(signal.sourceType),
      status: signal.status || 'unknown',
      priority: signal.priority || 'unknown',
      url: signal.url || '',
      ownerKeys,
      labelKeys: (signal.labels || []).map(label => slugify(label)),
      containerKey,
      dueAt: asDate(signal.dueAt),
      providerCreatedAt: asDate(signal.providerCreatedAt),
      providerUpdatedAt,
      evidenceRefs: signal.evidenceRefs || [],
      raw: signal.raw || {},
      syncState: signal.syncState || {},
      actors: (signal.owners || []).map(owner => ({
        workspaceId,
        sourceProvider: provider,
        externalId: `actor:${slugify(owner)}`,
        displayName: owner,
        actorType: 'person',
        connectorAccountId: signal.connectorAccountId
      })),
      container: {
        workspaceId,
        sourceProvider: provider,
        externalId: containerKey,
        name: this.containerNameForSignal(signal),
        containerType: this.containerTypeForProvider(provider),
        connectorAccountId: signal.connectorAccountId,
        url: ''
      },
      comment: this.commentProjection(signal, workspaceId, provider, externalId),
      event: {
        workspaceId,
        sourceSignalId: signalId(signal),
        sourceProvider: provider,
        externalId,
        eventKey: `${canonicalKey}:${eventStamp}`,
        eventType: this.eventTypeForSignal(signal.sourceType),
        occurredAt: providerUpdatedAt || asDate(signal.lastSeenAt) || new Date(),
        summary: `${signal.title || externalId} synced from ${provider}`,
        metadata: {
          status: signal.status,
          priority: signal.priority,
          sourceType: signal.sourceType
        }
      }
    };
  }

  async upsertFromSignal(signal, options = {}) {
    this.requireDatabase();
    const projection = this.buildProjection(signal);
    const now = new Date();

    const item = await WorkItem.findOneAndUpdate({
      workspaceId: projection.workspaceId,
      sourceProvider: projection.sourceProvider,
      externalId: projection.externalId
    }, {
      $set: {
        ...projection,
        lastSeenAt: now,
        syncState: {
          ...projection.syncState,
          lastProjectedBy: options.actorId || 'work-graph'
        }
      },
      $setOnInsert: {
        firstSeenAt: now
      }
    }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });

    await this.upsertActors(projection, now);
    await this.upsertContainer(projection, now);
    await this.upsertComment(projection, item, now);
    await this.upsertEvent(projection, item);

    return this.sanitizeItem(item);
  }

  async upsertActors(projection, now) {
    for (const actor of projection.actors) {
      await WorkActor.findOneAndUpdate({
        workspaceId: actor.workspaceId,
        sourceProvider: actor.sourceProvider,
        externalId: actor.externalId
      }, {
        $set: {
          displayName: actor.displayName,
          actorType: actor.actorType,
          lastSeenAt: now
        },
        $addToSet: {
          connectorAccountIds: actor.connectorAccountId
        }
      }, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      });
    }
  }

  async upsertContainer(projection, now) {
    await WorkContainer.findOneAndUpdate({
      workspaceId: projection.container.workspaceId,
      sourceProvider: projection.container.sourceProvider,
      externalId: projection.container.externalId
    }, {
      $set: {
        name: projection.container.name,
        containerType: projection.container.containerType,
        connectorAccountId: projection.container.connectorAccountId,
        url: projection.container.url,
        lastSeenAt: now
      }
    }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });
  }

  async upsertComment(projection, item, now) {
    if (!projection.comment) return null;
    return WorkComment.findOneAndUpdate({
      workspaceId: projection.comment.workspaceId,
      sourceProvider: projection.comment.sourceProvider,
      externalId: projection.comment.externalId
    }, {
      $set: {
        ...projection.comment,
        workItemId: item._id,
        lastSeenAt: now
      }
    }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });
  }

  async upsertEvent(projection, item) {
    return WorkEvent.findOneAndUpdate({
      workspaceId: projection.event.workspaceId,
      sourceProvider: projection.event.sourceProvider,
      eventKey: projection.event.eventKey
    }, {
      $setOnInsert: {
        ...projection.event,
        workItemId: item._id
      }
    }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });
  }

  async getSummary(options = {}) {
    if (!this.isDatabaseReady()) {
      return this.emptySummary();
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 50, 200));
    const [itemCount, actorCount, containerCount, commentCount, eventCount, byStatus, byProvider, recentItems] = await Promise.all([
      WorkItem.countDocuments({ workspaceId }),
      WorkActor.countDocuments({ workspaceId }),
      WorkContainer.countDocuments({ workspaceId }),
      WorkComment.countDocuments({ workspaceId }),
      WorkEvent.countDocuments({ workspaceId }),
      WorkItem.aggregate([
        { $match: { workspaceId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      WorkItem.aggregate([
        { $match: { workspaceId } },
        { $group: { _id: '$sourceProvider', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      WorkItem.find({ workspaceId }).sort({ priority: 1, dueAt: 1, lastSeenAt: -1 }).limit(limit)
    ]);

    return {
      counts: {
        items: itemCount,
        actors: actorCount,
        containers: containerCount,
        comments: commentCount,
        events: eventCount
      },
      byStatus: this.aggregateRows(byStatus),
      byProvider: this.aggregateRows(byProvider),
      items: recentItems.map(item => this.sanitizeItem(item))
    };
  }

  async listDecisionCandidates(options = {}) {
    if (!this.isDatabaseReady()) {
      return { count: 0, candidates: [] };
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 50, 200));
    const items = await WorkItem.find({
      workspaceId,
      status: { $in: [...OPEN_STATUSES] }
    }).sort({ priority: 1, dueAt: 1, lastSeenAt: -1 }).limit(limit * 3);

    const candidates = items
      .map(item => this.buildDecisionCandidate(item))
      .filter(Boolean)
      .slice(0, limit);

    return {
      count: candidates.length,
      candidates
    };
  }

  emptySummary() {
    return {
      counts: {
        items: 0,
        actors: 0,
        containers: 0,
        comments: 0,
        events: 0
      },
      byStatus: {},
      byProvider: {},
      items: []
    };
  }

  aggregateRows(rows = []) {
    return rows.reduce((result, row) => {
      result[row._id || 'unknown'] = row.count;
      return result;
    }, {});
  }

  buildDecisionCandidate(item) {
    if (!item || ['done', 'archived'].includes(item.status)) return null;

    const sensitive = this.requiresRobertReview(item);
    const overdue = item.dueAt && item.dueAt < new Date() && OPEN_STATUSES.has(item.status);
    const ownerless = !Array.isArray(item.ownerKeys) || item.ownerKeys.length === 0;
    const critical = item.priority === 'critical';
    const high = item.priority === 'high' || critical;

    if (item.status === 'blocked') {
      return this.decisionCandidate(item, {
        findingType: 'graph_blocked_work',
        ownerType: sensitive || high ? 'robert' : 'team',
        riskLevel: critical ? 'critical' : high ? 'high' : 'medium',
        actionType: high ? 'escalate' : 'follow_up',
        title: `Unblock ${item.title}`,
        recommendedAction: `Ask for blocker, owner, and next action on "${item.title}".`,
        reason: 'The normalized work graph shows this item is blocked.'
      });
    }

    if (overdue) {
      return this.decisionCandidate(item, {
        findingType: 'graph_overdue_work',
        ownerType: sensitive || high ? 'robert' : 'team',
        riskLevel: critical ? 'critical' : high ? 'high' : 'medium',
        actionType: 'escalate',
        title: `Recover overdue ${item.title}`,
        recommendedAction: `Escalate overdue work and request a recovery date for "${item.title}".`,
        reason: 'The normalized work graph shows this item is overdue and still open.'
      });
    }

    if (sensitive) {
      return this.decisionCandidate(item, {
        findingType: 'graph_robert_review',
        ownerType: 'robert',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'manual_review',
        title: `Robert review: ${item.title}`,
        recommendedAction: `Keep "${item.title}" in Robert review before any provider action.`,
        reason: 'The title, description, or labels indicate client, legal, money, contract, compliance, or Robert-only decision risk.'
      });
    }

    if (ownerless) {
      return this.decisionCandidate(item, {
        findingType: 'graph_unowned_work',
        ownerType: high ? 'robert' : 'va',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'reassign',
        title: `Assign owner: ${item.title}`,
        recommendedAction: `Choose an accountable owner for "${item.title}".`,
        reason: 'The normalized work graph has no owner for this open item.'
      });
    }

    if (item.status === 'waiting') {
      return this.decisionCandidate(item, {
        findingType: 'graph_waiting_follow_up',
        ownerType: 'team',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'follow_up',
        title: `Follow up waiting item: ${item.title}`,
        recommendedAction: `Request the waiting-party status and next action for "${item.title}".`,
        reason: 'The normalized work graph shows this item is waiting.'
      });
    }

    return null;
  }

  decisionCandidate(item, spec) {
    const itemId = item._id || item.id;
    const payload = {
      source: 'work_graph',
      workItemId: itemId ? String(itemId) : undefined,
      sourceProvider: item.sourceProvider,
      externalId: item.externalId,
      canonicalKey: item.canonicalKey,
      providerUrl: item.url || '',
      externalProviderWriteBlocked: true,
      executable: false,
      draftOnly: true,
      requiredChange: 'Approve the decision, then convert it into an exact provider-specific action payload before execution.',
      commentText: this.defaultCommentText(item, spec)
    };

    return {
      workItemId: itemId ? String(itemId) : null,
      findingType: spec.findingType,
      title: spec.title,
      description: spec.reason,
      recommendedAction: spec.recommendedAction,
      actionType: spec.actionType,
      actionPayload: payload,
      riskLevel: spec.riskLevel,
      confidence: this.confidenceForCandidate(item, spec),
      requiresApproval: true,
      approvalReason: `${spec.reason} Provider writes are blocked until a human approves an exact action payload.`,
      ownerType: spec.ownerType,
      sourceEvidence: [this.evidenceForItem(item, spec)]
    };
  }

  evidenceForItem(item, spec) {
    return {
      type: 'work_item',
      entityId: item._id || item.id || item.externalId,
      label: item.title,
      url: item.url || undefined,
      observedAt: item.lastSeenAt || item.updatedAt || new Date(),
      data: {
        reason: spec.reason,
        sourceProvider: item.sourceProvider,
        externalId: item.externalId,
        canonicalKey: item.canonicalKey,
        status: item.status,
        priority: item.priority,
        ownerKeys: item.ownerKeys || [],
        labelKeys: item.labelKeys || [],
        dueAt: item.dueAt || null
      }
    };
  }

  defaultCommentText(item, spec) {
    if (spec.actionType === 'reassign') {
      return 'Please confirm the accountable owner and next concrete action.';
    }
    if (spec.actionType === 'escalate') {
      return 'This item needs recovery: please confirm blocker, owner, and recovery date.';
    }
    if (spec.actionType === 'follow_up') {
      return 'Please provide current status and the next concrete action today.';
    }
    return 'Review this work item before any external provider action is taken.';
  }

  confidenceForCandidate(item, spec) {
    if (item.status === 'blocked' || item.priority === 'critical') return 0.84;
    if (spec.findingType === 'graph_overdue_work') return 0.8;
    if (spec.findingType === 'graph_unowned_work') return 0.74;
    if (spec.findingType === 'graph_robert_review') return 0.7;
    return 0.66;
  }

  requiresRobertReview(item) {
    const text = [
      item.title,
      item.description,
      ...(item.labelKeys || [])
    ].filter(Boolean).join(' ');
    return ROBERT_SENSITIVE_PATTERN.test(text);
  }

  itemTypeForSignal(sourceType) {
    if (sourceType === 'comment') return 'message';
    if (sourceType === 'time_entry') return 'other';
    return WorkItem.itemTypes.includes(sourceType) ? sourceType : 'other';
  }

  eventTypeForSignal(sourceType) {
    if (sourceType === 'comment' || sourceType === 'message') return 'commented';
    return 'synced';
  }

  commentProjection(signal, workspaceId, provider, externalId) {
    if (!['comment', 'message'].includes(signal.sourceType)) return null;
    return {
      workspaceId,
      sourceProvider: provider,
      externalId,
      authorKey: (signal.owners || [])[0] ? `${provider}:actor:${slugify(signal.owners[0])}` : '',
      body: signal.description || signal.title || '',
      url: signal.url || '',
      providerCreatedAt: asDate(signal.providerCreatedAt),
      providerUpdatedAt: asDate(signal.providerUpdatedAt),
      raw: signal.raw || {}
    };
  }

  containerKeyForSignal(signal) {
    const raw = signal.raw || {};
    const container = raw.container || raw.project || raw.board || raw.repository || raw.channel || raw.folder || raw.calendar;
    const id = container?.id || container?.gid || container?.key || container?.name || raw.projectId || raw.boardId || raw.repo || raw.channel;
    return id ? `${signal.provider}:container:${slugify(id)}` : `${signal.provider}:account:${signal.connectorAccountId}`;
  }

  containerNameForSignal(signal) {
    const raw = signal.raw || {};
    const container = raw.container || raw.project || raw.board || raw.repository || raw.channel || raw.folder || raw.calendar;
    return container?.name || container?.full_name || container?.key || `${signal.provider} account`;
  }

  containerTypeForProvider(provider) {
    if (provider === 'trello') return 'board';
    if (['jira_software', 'jira_service_management', 'asana'].includes(provider)) return 'project';
    if (provider === 'github') return 'repository';
    if (provider === 'slack') return 'channel';
    if (provider === 'google_workspace') return 'folder';
    if (provider === 'microsoft_365') return 'account';
    return 'unknown';
  }

  sanitizeItem(item) {
    return {
      id: String(item._id),
      workspaceId: item.workspaceId ? String(item.workspaceId) : null,
      sourceProvider: item.sourceProvider,
      connectorAccountId: item.connectorAccountId ? String(item.connectorAccountId) : null,
      sourceSignalId: item.sourceSignalId ? String(item.sourceSignalId) : null,
      externalId: item.externalId,
      canonicalKey: item.canonicalKey,
      title: item.title,
      description: item.description,
      itemType: item.itemType,
      status: item.status,
      priority: item.priority,
      url: item.url || null,
      ownerKeys: item.ownerKeys || [],
      labelKeys: item.labelKeys || [],
      containerKey: item.containerKey || '',
      dueAt: item.dueAt || null,
      providerCreatedAt: item.providerCreatedAt || null,
      providerUpdatedAt: item.providerUpdatedAt || null,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      evidenceRefs: item.evidenceRefs || [],
      syncState: item.syncState || {},
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required to project the work graph');
      error.statusCode = 503;
      throw error;
    }
  }

  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }
}

module.exports = new WorkGraphService();
