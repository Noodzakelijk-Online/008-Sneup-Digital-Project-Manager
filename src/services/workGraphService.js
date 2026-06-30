const mongoose = require('mongoose');
const WorkActor = require('../models/WorkActor');
const WorkComment = require('../models/WorkComment');
const WorkContainer = require('../models/WorkContainer');
const WorkDependency = require('../models/WorkDependency');
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
const asArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [value];
};
const pick = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
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
      dependencies: this.dependencyProjectionsForSignal(signal, workspaceId, provider, externalId),
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
    await this.upsertDependencies(projection, item, now);

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

  async upsertDependencies(projection, item, now) {
    for (const dependency of projection.dependencies || []) {
      const target = await WorkItem.findOne({
        workspaceId: projection.workspaceId,
        sourceProvider: dependency.targetProvider || projection.sourceProvider,
        externalId: dependency.targetExternalId
      });
      if (!target) continue;

      await WorkDependency.findOneAndUpdate({
        workspaceId: projection.workspaceId,
        sourceProvider: projection.sourceProvider,
        externalId: dependency.externalId
      }, {
        $set: {
          workspaceId: projection.workspaceId,
          sourceItemId: item._id,
          targetItemId: target._id,
          dependencyType: dependency.dependencyType,
          sourceProvider: projection.sourceProvider,
          externalId: dependency.externalId,
          confidence: dependency.confidence,
          evidenceRefs: dependency.evidenceRefs,
          metadata: {
            ...(dependency.metadata || {}),
            targetProvider: dependency.targetProvider || projection.sourceProvider,
            targetExternalId: dependency.targetExternalId,
            lastSeenAt: now
          }
        }
      }, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      });
    }
  }

  async getSummary(options = {}) {
    if (!this.isDatabaseReady()) {
      return this.emptySummary();
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 50, 200));
    const [itemCount, actorCount, containerCount, commentCount, dependencyCount, eventCount, byStatus, byProvider, byDependencyType, recentItems, recentDependencies] = await Promise.all([
      WorkItem.countDocuments({ workspaceId }),
      WorkActor.countDocuments({ workspaceId }),
      WorkContainer.countDocuments({ workspaceId }),
      WorkComment.countDocuments({ workspaceId }),
      WorkDependency.countDocuments({ workspaceId }),
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
      WorkDependency.aggregate([
        { $match: { workspaceId } },
        { $group: { _id: '$dependencyType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      WorkItem.find({ workspaceId }).sort({ priority: 1, dueAt: 1, lastSeenAt: -1 }).limit(limit),
      WorkDependency.find({ workspaceId }).sort({ updatedAt: -1 }).limit(Math.min(limit, 25))
    ]);

    return {
      counts: {
        items: itemCount,
        actors: actorCount,
        containers: containerCount,
        comments: commentCount,
        dependencies: dependencyCount,
        events: eventCount
      },
      byStatus: this.aggregateRows(byStatus),
      byProvider: this.aggregateRows(byProvider),
      byDependencyType: this.aggregateRows(byDependencyType),
      items: recentItems.map(item => this.sanitizeItem(item)),
      dependencies: recentDependencies.map(dependency => this.sanitizeDependency(dependency))
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
    const itemIds = items.map(item => item._id);
    const dependencies = itemIds.length > 0
      ? await WorkDependency.find({
        workspaceId,
        $or: [
          { sourceItemId: { $in: itemIds } },
          { targetItemId: { $in: itemIds } }
        ]
      }).limit(limit * 12)
      : [];
    const dependencySummaryByItem = this.dependencySummaryByItem(itemIds, dependencies);

    const candidates = items
      .map(item => this.buildDecisionCandidate(item, dependencySummaryByItem.get(String(item._id))))
      .filter(Boolean)
      .sort((left, right) => (right.graphScore || 0) - (left.graphScore || 0))
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
        dependencies: 0,
        events: 0
      },
      byStatus: {},
      byProvider: {},
      byDependencyType: {},
      items: [],
      dependencies: []
    };
  }

  aggregateRows(rows = []) {
    return rows.reduce((result, row) => {
      result[row._id || 'unknown'] = row.count;
      return result;
    }, {});
  }

  buildDecisionCandidate(item, dependencySummary = {}) {
    if (!item || ['done', 'archived'].includes(item.status)) return null;

    const graphDependencies = this.normalizeDependencySummary(dependencySummary);
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
        reason: this.withDependencyReason('The normalized work graph shows this item is blocked.', graphDependencies)
      }, graphDependencies);
    }

    if (overdue) {
      return this.decisionCandidate(item, {
        findingType: 'graph_overdue_work',
        ownerType: sensitive || high ? 'robert' : 'team',
        riskLevel: critical ? 'critical' : high ? 'high' : 'medium',
        actionType: 'escalate',
        title: `Recover overdue ${item.title}`,
        recommendedAction: `Escalate overdue work and request a recovery date for "${item.title}".`,
        reason: this.withDependencyReason('The normalized work graph shows this item is overdue and still open.', graphDependencies)
      }, graphDependencies);
    }

    if (sensitive) {
      return this.decisionCandidate(item, {
        findingType: 'graph_robert_review',
        ownerType: 'robert',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'manual_review',
        title: `Robert review: ${item.title}`,
        recommendedAction: `Keep "${item.title}" in Robert review before any provider action.`,
        reason: this.withDependencyReason('The title, description, or labels indicate client, legal, money, contract, compliance, or Robert-only decision risk.', graphDependencies)
      }, graphDependencies);
    }

    if (ownerless) {
      return this.decisionCandidate(item, {
        findingType: 'graph_unowned_work',
        ownerType: high ? 'robert' : 'va',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'reassign',
        title: `Assign owner: ${item.title}`,
        recommendedAction: `Choose an accountable owner for "${item.title}".`,
        reason: this.withDependencyReason('The normalized work graph has no owner for this open item.', graphDependencies)
      }, graphDependencies);
    }

    if (item.status === 'waiting') {
      return this.decisionCandidate(item, {
        findingType: 'graph_waiting_follow_up',
        ownerType: 'team',
        riskLevel: high ? 'high' : 'medium',
        actionType: 'follow_up',
        title: `Follow up waiting item: ${item.title}`,
        recommendedAction: `Request the waiting-party status and next action for "${item.title}".`,
        reason: this.withDependencyReason('The normalized work graph shows this item is waiting.', graphDependencies)
      }, graphDependencies);
    }

    return null;
  }

  decisionCandidate(item, spec, dependencySummary = {}) {
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
      commentText: this.defaultCommentText(item, spec),
      dependencySummary
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
      graphScore: this.graphScoreForCandidate(item, spec, dependencySummary),
      dependencySummary,
      requiresApproval: true,
      approvalReason: `${spec.reason} Provider writes are blocked until a human approves an exact action payload.`,
      ownerType: spec.ownerType,
      sourceEvidence: [this.evidenceForItem(item, spec, dependencySummary)]
    };
  }

  evidenceForItem(item, spec, dependencySummary = {}) {
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
        dueAt: item.dueAt || null,
        dependencySummary
      }
    };
  }

  dependencySummaryByItem(itemIds, dependencies = []) {
    const byItem = new Map(itemIds.map(id => [String(id), this.normalizeDependencySummary()]));

    for (const dependency of dependencies) {
      const sourceId = String(dependency.sourceItemId?._id || dependency.sourceItemId || '');
      const targetId = String(dependency.targetItemId?._id || dependency.targetItemId || '');

      if (byItem.has(sourceId)) {
        this.addDependencyToSummary(byItem.get(sourceId), dependency.dependencyType, 'source');
      }
      if (byItem.has(targetId)) {
        this.addDependencyToSummary(byItem.get(targetId), dependency.dependencyType, 'target');
      }
    }

    return byItem;
  }

  addDependencyToSummary(summary, dependencyType, direction) {
    summary.dependencyCount += 1;
    summary.dependencyTypes[dependencyType || 'unknown'] = (summary.dependencyTypes[dependencyType || 'unknown'] || 0) + 1;

    if (direction === 'source') {
      if (dependencyType === 'blocks') summary.blockingCount += 1;
      else if (['blocked_by', 'depends_on'].includes(dependencyType)) summary.blockedByCount += 1;
      else summary.relatedCount += 1;
      return summary;
    }

    if (dependencyType === 'blocks') summary.blockedByCount += 1;
    else if (['blocked_by', 'depends_on'].includes(dependencyType)) summary.blockingCount += 1;
    else summary.relatedCount += 1;
    return summary;
  }

  normalizeDependencySummary(summary = {}) {
    return {
      dependencyCount: Number(summary.dependencyCount) || 0,
      blockingCount: Number(summary.blockingCount) || 0,
      blockedByCount: Number(summary.blockedByCount) || 0,
      relatedCount: Number(summary.relatedCount) || 0,
      dependencyTypes: summary.dependencyTypes || {}
    };
  }

  withDependencyReason(reason, dependencySummary = {}) {
    if (dependencySummary.blockedByCount > 0) {
      return `${reason} It is blocked by ${dependencySummary.blockedByCount} graph dependenc${dependencySummary.blockedByCount === 1 ? 'y' : 'ies'}.`;
    }
    if (dependencySummary.blockingCount > 0) {
      return `${reason} It is blocking ${dependencySummary.blockingCount} downstream graph item${dependencySummary.blockingCount === 1 ? '' : 's'}.`;
    }
    return reason;
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

  graphScoreForCandidate(item, spec, dependencySummary = {}) {
    const severityBase = {
      critical: 90,
      high: 75,
      medium: 55,
      low: 35
    }[spec.riskLevel] || 45;
    const priorityBoost = item.priority === 'critical' ? 18
      : item.priority === 'high' ? 10
        : 0;
    const dependencyBoost = dependencySummary.blockingCount * 14
      + dependencySummary.blockedByCount * 12
      + dependencySummary.relatedCount * 3;
    const statusBoost = item.status === 'blocked' ? 14
      : item.status === 'waiting' ? 8
        : 0;
    return Math.min(100, severityBase + priorityBoost + dependencyBoost + statusBoost);
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

  dependencyProjectionsForSignal(signal, workspaceId, provider, externalId) {
    const raw = signal.raw || {};
    const refs = [
      ...this.genericDependencyRefs(raw, provider, externalId),
      ...this.jiraDependencyRefs(raw, provider, externalId),
      ...this.asanaDependencyRefs(raw, provider, externalId),
      ...this.githubDependencyRefs(raw, provider, externalId),
      ...this.trelloDependencyRefs(raw, provider, externalId)
    ];
    const seen = new Set();

    return refs.filter(ref => {
      if (!ref.targetExternalId || ref.targetExternalId === externalId) return false;
      const key = `${ref.targetProvider || provider}:${ref.targetExternalId}:${ref.dependencyType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(ref => ({
      workspaceId,
      sourceProvider: provider,
      sourceExternalId: externalId,
      targetProvider: ref.targetProvider || provider,
      targetExternalId: String(ref.targetExternalId),
      dependencyType: this.normalizeDependencyType(ref.dependencyType),
      externalId: ref.externalId || `${provider}:${externalId}:${ref.dependencyType || 'unknown'}:${ref.targetProvider || provider}:${ref.targetExternalId}`,
      confidence: ref.confidence || 1,
      evidenceRefs: ref.evidenceRefs || [{
        provider,
        externalId,
        url: ref.url,
        label: ref.label || `Dependency ${ref.targetExternalId}`,
        type: 'dependency'
      }],
      metadata: ref.metadata || {}
    }));
  }

  genericDependencyRefs(raw, provider, externalId) {
    const groups = [
      ['dependencies', 'depends_on'],
      ['dependsOn', 'depends_on'],
      ['blockedBy', 'blocked_by'],
      ['blocks', 'blocks'],
      ['dependents', 'blocks'],
      ['related', 'relates_to'],
      ['relatedItems', 'relates_to'],
      ['duplicates', 'duplicates'],
      ['linkedIssues', 'relates_to'],
      ['linkedCards', 'relates_to']
    ];

    return groups.flatMap(([field, dependencyType]) =>
      asArray(raw[field]).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType,
        relationField: field,
        index
      }))
    ).filter(Boolean);
  }

  jiraDependencyRefs(raw, provider, externalId) {
    const links = asArray(raw.issuelinks || raw.fields?.issuelinks);
    return links.flatMap((link, index) => {
      const refs = [];
      if (link.outwardIssue) {
        refs.push(this.dependencyRefFromTarget(link.outwardIssue, {
          provider,
          externalId,
          dependencyType: this.normalizeDependencyType(link.type?.outward || link.type?.name),
          relationField: 'issuelinks.outward',
          index,
          relationId: link.id,
          label: link.type?.outward || link.type?.name
        }));
      }
      if (link.inwardIssue) {
        refs.push(this.dependencyRefFromTarget(link.inwardIssue, {
          provider,
          externalId,
          dependencyType: this.normalizeDependencyType(link.type?.inward || link.type?.name),
          relationField: 'issuelinks.inward',
          index,
          relationId: link.id,
          label: link.type?.inward || link.type?.name
        }));
      }
      return refs.filter(Boolean);
    });
  }

  asanaDependencyRefs(raw, provider, externalId) {
    return [
      ...asArray(raw.dependencies).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType: 'depends_on',
        relationField: 'dependencies',
        index
      })),
      ...asArray(raw.dependents).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType: 'blocks',
        relationField: 'dependents',
        index
      }))
    ].filter(Boolean);
  }

  githubDependencyRefs(raw, provider, externalId) {
    return [
      ...asArray(raw.blocked_by || raw.blockedBy).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType: 'blocked_by',
        relationField: 'blocked_by',
        index
      })),
      ...asArray(raw.blocks).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType: 'blocks',
        relationField: 'blocks',
        index
      })),
      ...asArray(raw.closing_issues || raw.closingIssues).map((target, index) => this.dependencyRefFromTarget(target, {
        provider,
        externalId,
        dependencyType: 'relates_to',
        relationField: 'closing_issues',
        index
      }))
    ].filter(Boolean);
  }

  trelloDependencyRefs(raw, provider, externalId) {
    return asArray(raw.attachments)
      .filter(attachment => attachment.idModel || attachment.cardId || /\/c\//.test(String(attachment.url || '')))
      .map((attachment, index) => this.dependencyRefFromTarget(attachment.idModel || attachment.cardId || attachment, {
        provider,
        externalId,
        dependencyType: 'relates_to',
        relationField: 'attachments',
        relationId: attachment.id,
        index,
        label: attachment.name || 'Linked Trello card',
        url: attachment.url
      }))
      .filter(Boolean);
  }

  dependencyRefFromTarget(target, context) {
    const targetExternalId = typeof target === 'object'
      ? pick(target.externalId, target.targetExternalId, target.key, target.gid, target.id, target.node_id, target.number, target.shortLink, target.cardId)
      : target;
    if (!targetExternalId) return null;

    const targetProvider = typeof target === 'object'
      ? pick(target.provider, target.targetProvider, context.provider)
      : context.provider;
    const dependencyType = typeof target === 'object'
      ? this.normalizeDependencyType(pick(target.dependencyType, target.relationship, target.type, context.dependencyType))
      : this.normalizeDependencyType(context.dependencyType);
    const relationId = pick(context.relationId, typeof target === 'object' ? target.relationId || target.id : undefined, context.index);

    return {
      targetProvider,
      targetExternalId: String(targetExternalId),
      dependencyType,
      externalId: `${context.provider}:${context.externalId}:${context.relationField}:${relationId}:${targetProvider}:${targetExternalId}`,
      label: context.label || (typeof target === 'object' ? target.title || target.name || target.summary : undefined),
      url: context.url || (typeof target === 'object' ? pick(target.url, target.html_url, target.htmlUrl, target.permalink_url, target.webUrl, target.self) : undefined),
      confidence: typeof target === 'object' ? target.confidence : undefined,
      metadata: {
        relationField: context.relationField,
        relationId,
        rawType: typeof target === 'object' ? target.type?.name || target.type || target.relationship : undefined
      }
    };
  }

  normalizeDependencyType(value) {
    const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
    if (/\b(duplicate|duplicates|duplicated)\b/.test(text)) return 'duplicates';
    if (/\b(blocked by|is blocked by|blocked)\b/.test(text)) return 'blocked_by';
    if (/\b(depends on|depends|dependency|requires|required by)\b/.test(text)) return 'depends_on';
    if (/\b(blocks|blocking|is blocking)\b/.test(text)) return 'blocks';
    if (/\b(relates|related|linked|closes|closing)\b/.test(text)) return 'relates_to';
    return ['blocks', 'blocked_by', 'relates_to', 'duplicates', 'depends_on'].includes(value) ? value : 'unknown';
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

  sanitizeDependency(dependency) {
    return {
      id: String(dependency._id),
      workspaceId: dependency.workspaceId ? String(dependency.workspaceId) : null,
      sourceItemId: dependency.sourceItemId ? String(dependency.sourceItemId) : null,
      targetItemId: dependency.targetItemId ? String(dependency.targetItemId) : null,
      dependencyType: dependency.dependencyType,
      sourceProvider: dependency.sourceProvider,
      externalId: dependency.externalId,
      confidence: dependency.confidence,
      evidenceRefs: dependency.evidenceRefs || [],
      metadata: dependency.metadata || {},
      createdAt: dependency.createdAt,
      updatedAt: dependency.updatedAt
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
