const mongoose = require('mongoose');
const WorkActor = require('../models/WorkActor');
const WorkComment = require('../models/WorkComment');
const WorkContainer = require('../models/WorkContainer');
const WorkDependency = require('../models/WorkDependency');
const WorkEvent = require('../models/WorkEvent');
const WorkItem = require('../models/WorkItem');
const Recommendation = require('../models/Recommendation');
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
const DEFAULT_DEPENDENCY_STALE_AFTER_DAYS = 30;
const DEPENDENCY_REVIEW_ACTIONS = new Set(['confirm', 'dismiss', 'refresh']);

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
    await this.resolvePendingDependenciesForItem(projection, item, now);
    if (options.deferDependencyFreshness !== true) {
      await this.markStaleDependencies(projection.workspaceId, {
        now,
        sourceProvider: projection.sourceProvider
      });
    }

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
      const targetProvider = dependency.targetProvider || projection.sourceProvider;
      const target = await WorkItem.findOne({
        workspaceId: projection.workspaceId,
        sourceProvider: targetProvider,
        externalId: dependency.targetExternalId
      });

      await WorkDependency.findOneAndUpdate({
        workspaceId: projection.workspaceId,
        sourceProvider: projection.sourceProvider,
        externalId: dependency.externalId
      }, {
        $set: {
          workspaceId: projection.workspaceId,
          sourceItemId: item._id,
          ...(target ? { targetItemId: target._id } : {}),
          dependencyType: dependency.dependencyType,
          sourceExternalId: projection.externalId,
          sourceProvider: projection.sourceProvider,
          targetProvider,
          targetExternalId: dependency.targetExternalId,
          targetTitle: dependency.targetTitle || dependency.label || '',
          targetUrl: dependency.targetUrl || dependency.url || '',
          resolutionStatus: target ? 'resolved' : 'unresolved',
          freshnessStatus: 'fresh',
          lastSeenAt: now,
          staleReason: '',
          externalId: dependency.externalId,
          confidence: dependency.confidence,
          evidenceRefs: dependency.evidenceRefs,
          metadata: {
            ...(dependency.metadata || {}),
            targetProvider,
            targetExternalId: dependency.targetExternalId,
            targetTitle: dependency.targetTitle || dependency.label || '',
            targetUrl: dependency.targetUrl || dependency.url || '',
            resolutionStatus: target ? 'resolved' : 'unresolved',
            freshnessStatus: 'fresh',
            lastSeenAt: now
          }
        },
        $unset: {
          staleSince: '',
          'metadata.staleSince': '',
          'metadata.staleReason': '',
          ...(target ? {} : { targetItemId: '' })
        }
      }, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      });
    }
  }

  async resolvePendingDependenciesForItem(projection, item, now) {
    await WorkDependency.updateMany({
      workspaceId: projection.workspaceId,
      targetProvider: projection.sourceProvider,
      targetExternalId: projection.externalId,
      resolutionStatus: 'unresolved'
    }, {
      $set: {
        targetItemId: item._id,
        targetTitle: item.title,
        targetUrl: item.url || '',
        resolutionStatus: 'resolved',
        'metadata.resolutionStatus': 'resolved',
        'metadata.resolvedAt': now,
        'metadata.targetTitle': item.title,
        'metadata.targetUrl': item.url || ''
      }
    });
  }

  async reviewDependency(dependencyId, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const action = String(options.action || '').trim().toLowerCase();
    if (!DEPENDENCY_REVIEW_ACTIONS.has(action)) {
      const error = new Error('Dependency review action must be confirm, dismiss, or refresh');
      error.statusCode = 400;
      throw error;
    }

    const dependency = await WorkDependency.findOne({ _id: dependencyId, workspaceId });
    if (!dependency) {
      const error = new Error('Work graph dependency not found');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date();
    const actorId = options.actorId || options.actor || 'api';
    const reason = String(options.reason || '').trim();
    const baseSet = {
      reviewedAt: now,
      reviewedBy: actorId,
      reviewReason: reason,
      'metadata.reviewedAt': now,
      'metadata.reviewedBy': actorId,
      'metadata.reviewReason': reason,
      'metadata.reviewAction': action
    };
    const update = {
      $set: baseSet
    };

    if (action === 'dismiss') {
      update.$set = {
        ...update.$set,
        freshnessStatus: 'stale',
        reviewStatus: 'dismissed',
        staleSince: dependency.staleSince || now,
        staleReason: reason || 'Dismissed by graph dependency review.',
        confidence: 0,
        'metadata.freshnessStatus': 'stale',
        'metadata.reviewStatus': 'dismissed',
        'metadata.staleSince': dependency.staleSince || now,
        'metadata.staleReason': reason || 'Dismissed by graph dependency review.'
      };
    } else {
      const reviewStatus = action === 'refresh' ? 'refreshed' : 'confirmed';
      update.$set = {
        ...update.$set,
        freshnessStatus: 'fresh',
        reviewStatus,
        lastSeenAt: now,
        confidence: Math.max(Number(dependency.confidence) || 0, 0.8),
        'metadata.freshnessStatus': 'fresh',
        'metadata.reviewStatus': reviewStatus,
        'metadata.lastSeenAt': now
      };
      update.$unset = {
        staleSince: '',
        staleReason: '',
        'metadata.staleSince': '',
        'metadata.staleReason': ''
      };
    }

    const updated = await WorkDependency.findOneAndUpdate({
      _id: dependencyId,
      workspaceId
    }, update, {
      new: true
    });

    return this.sanitizeDependencyDetail(updated, null);
  }

  async markStaleDependencies(workspaceId, options = {}) {
    const now = options.now || new Date();
    const cutoff = new Date(now.getTime() - this.dependencyStaleAfterMs(options));
    const staleReason = 'Provider dependency link has not been observed during recent syncs.';
    const requestedProviders = options.sourceProviders || options.sourceProvider;
    const sourceProviders = [...new Set(asArray(requestedProviders).map(provider => String(provider).trim()).filter(Boolean))];
    const query = {
      workspaceId,
      freshnessStatus: { $ne: 'stale' },
      $or: [
        { lastSeenAt: { $lt: cutoff } },
        { lastSeenAt: { $exists: false }, updatedAt: { $lt: cutoff } },
        { 'metadata.lastSeenAt': { $lt: cutoff } }
      ]
    };
    if (sourceProviders.length === 1) query.sourceProvider = sourceProviders[0];
    if (sourceProviders.length > 1) query.sourceProvider = { $in: sourceProviders };

    return WorkDependency.updateMany(query, {
      $set: {
        freshnessStatus: 'stale',
        reviewStatus: 'unreviewed',
        staleSince: now,
        staleReason,
        'metadata.freshnessStatus': 'stale',
        'metadata.reviewStatus': 'unreviewed',
        'metadata.staleSince': now,
        'metadata.staleReason': staleReason
      }
    });
  }

  dependencyStaleAfterMs(options = {}) {
    const configuredDays = Number.parseInt(
      options.staleAfterDays || process.env.SNEUP_DEPENDENCY_STALE_AFTER_DAYS,
      10
    );
    const days = Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : DEFAULT_DEPENDENCY_STALE_AFTER_DAYS;
    return days * 24 * 60 * 60 * 1000;
  }

  async getSummary(options = {}) {
    if (!this.isDatabaseReady()) {
      return this.emptySummary();
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 50, 200));
    const [itemCount, actorCount, containerCount, commentCount, dependencyCount, eventCount, byStatus, byProvider, byDependencyType, byDependencyFreshness, byDependencyReviewStatus, dependencyReviewQuality, recentItems, recentDependencies] = await Promise.all([
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
      WorkDependency.aggregate([
        { $match: { workspaceId } },
        { $group: { _id: '$freshnessStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      WorkDependency.aggregate([
        { $match: { workspaceId } },
        { $group: { _id: { $ifNull: ['$reviewStatus', 'unreviewed'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      WorkDependency.aggregate([
        { $match: { workspaceId } },
        {
          $group: {
            _id: '$sourceProvider',
            dependencies: { $sum: 1 },
            stale: { $sum: { $cond: [{ $eq: ['$freshnessStatus', 'stale'] }, 1, 0] } },
            staleUnreviewed: {
              $sum: {
                $cond: [{
                  $and: [
                    { $eq: ['$freshnessStatus', 'stale'] },
                    { $eq: [{ $ifNull: ['$reviewStatus', 'unreviewed'] }, 'unreviewed'] }
                  ]
                }, 1, 0]
              }
            },
            confirmed: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'confirmed'] }, 1, 0] } },
            refreshed: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'refreshed'] }, 1, 0] } },
            dismissed: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'dismissed'] }, 1, 0] } }
          }
        },
        { $sort: { staleUnreviewed: -1, stale: -1, dependencies: -1, _id: 1 } }
      ]),
      WorkItem.find({ workspaceId }).sort({ priority: 1, dueAt: 1, lastSeenAt: -1 }).limit(limit),
      WorkDependency.find({ workspaceId }).sort({ updatedAt: -1 }).limit(Math.min(limit, 25))
    ]);
    const providerReviewQuality = this.providerReviewQualityRows(dependencyReviewQuality);

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
      byDependencyFreshness: this.aggregateRows(byDependencyFreshness),
      byDependencyReviewStatus: this.aggregateRows(byDependencyReviewStatus),
      reviewMetrics: this.dependencyReviewMetrics(byDependencyFreshness, byDependencyReviewStatus, providerReviewQuality),
      providerReviewQuality,
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

  async getItemDetail(itemId, options = {}) {
    this.requireDatabase();

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const item = await WorkItem.findOne({ _id: itemId, workspaceId });
    if (!item) return null;

    const [dependencies, container, actors, events, recommendations] = await Promise.all([
      WorkDependency.find({
        workspaceId,
        $or: [
          { sourceItemId: item._id },
          { targetItemId: item._id }
        ]
      }).populate('sourceItemId targetItemId').sort({ updatedAt: -1 }).limit(50),
      WorkContainer.findOne({
        workspaceId,
        sourceProvider: item.sourceProvider,
        externalId: item.containerKey
      }),
      WorkActor.find({
        workspaceId,
        sourceProvider: item.sourceProvider,
        externalId: { $in: this.actorExternalIdsForItem(item) }
      }).sort({ displayName: 1 }).limit(25),
      WorkEvent.find({ workspaceId, workItemId: item._id }).sort({ occurredAt: -1 }).limit(25),
      Recommendation.find({
        workspaceId,
        'actionPayload.workItemId': String(item._id)
      }).sort({ createdAt: -1 }).limit(25)
    ]);

    const dependencySummary = this.dependencySummaryByItem([item._id], dependencies).get(String(item._id));

    return {
      item: this.sanitizeItem(item),
      container: container ? this.sanitizeContainer(container) : null,
      actors: actors.map(actor => this.sanitizeActor(actor)),
      dependencySummary: this.normalizeDependencySummary(dependencySummary),
      dependencies: dependencies.map(dependency => this.sanitizeDependencyDetail(dependency, item._id)),
      events: events.map(event => this.sanitizeEvent(event)),
      recommendations: recommendations.map(recommendation => this.sanitizeGraphRecommendation(recommendation)),
      candidate: this.buildDecisionCandidate(item, dependencySummary)
    };
  }

  async getTrelloBoardLedgerContext(board, cards = [], options = {}) {
    if (!board) return this.emptyLedgerContext('board');
    this.requireDatabase();

    const workspaceId = this.resolveWorkspaceId(options.workspaceId || board.workspaceId);
    const boardExternalIds = this.trelloBoardExternalIds(board);
    const cardExternalIds = cards.flatMap(card => this.trelloCardExternalIds(card));
    const containerKeys = boardExternalIds.map(id => `trello:container:${slugify(id)}`);
    const query = {
      workspaceId,
      sourceProvider: 'trello',
      $or: [
        { containerKey: { $in: containerKeys } }
      ]
    };
    if (cardExternalIds.length > 0) {
      query.$or.push({ externalId: { $in: cardExternalIds } });
    }

    const items = await WorkItem.find(query).sort({ priority: 1, dueAt: 1, lastSeenAt: -1 }).limit(200);
    return this.ledgerContextForItems(items, {
      contextType: 'board',
      sourceProvider: 'trello',
      sourceId: board.trelloId || String(board._id),
      sourceName: board.name,
      limit: options.limit
    });
  }

  async getTrelloCardLedgerContext(card, options = {}) {
    if (!card) return this.emptyLedgerContext('card');
    this.requireDatabase();

    const workspaceId = this.resolveWorkspaceId(options.workspaceId || card.workspaceId);
    const externalIds = this.trelloCardExternalIds(card);
    if (externalIds.length === 0) return this.emptyLedgerContext('card');

    const items = await WorkItem.find({
      workspaceId,
      sourceProvider: 'trello',
      externalId: { $in: externalIds }
    }).sort({ lastSeenAt: -1 }).limit(10);

    return this.ledgerContextForItems(items, {
      contextType: 'card',
      sourceProvider: 'trello',
      sourceId: card.trelloId || String(card._id),
      sourceName: card.name,
      limit: options.limit
    });
  }

  async ledgerContextForItems(items = [], options = {}) {
    const itemIds = items.map(item => item._id).filter(Boolean);
    if (itemIds.length === 0) {
      return {
        ...this.emptyLedgerContext(options.contextType),
        sourceProvider: options.sourceProvider || 'trello',
        sourceId: options.sourceId || null,
        sourceName: options.sourceName || ''
      };
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId || items[0].workspaceId);
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 25, 100));
    const [dependencies, recommendations] = await Promise.all([
      WorkDependency.find({
        workspaceId,
        $or: [
          { sourceItemId: { $in: itemIds } },
          { targetItemId: { $in: itemIds } }
        ]
      }).populate('sourceItemId targetItemId').sort({ updatedAt: -1 }).limit(limit * 4),
      Recommendation.find({
        workspaceId,
        'actionPayload.workItemId': { $in: itemIds.map(id => String(id)) }
      }).sort({ createdAt: -1 }).limit(limit * 2)
    ]);
    const summaryByItem = this.dependencySummaryByItem(itemIds, dependencies);
    const recommendationsByWorkItem = recommendations.reduce((result, recommendation) => {
      const workItemId = recommendation.actionPayload?.workItemId;
      if (!workItemId) return result;
      if (!result.has(workItemId)) result.set(workItemId, []);
      result.get(workItemId).push(this.sanitizeGraphRecommendation(recommendation));
      return result;
    }, new Map());
    const candidates = [];
    const sanitizedItems = items.slice(0, limit).map(item => {
      const dependencySummary = this.normalizeDependencySummary(summaryByItem.get(String(item._id)));
      const candidate = this.buildDecisionCandidate(item, dependencySummary);
      if (candidate) candidates.push(candidate);
      return {
        ...this.sanitizeItem(item),
        dependencySummary,
        candidate,
        recommendations: recommendationsByWorkItem.get(String(item._id)) || []
      };
    });

    const sanitizedDependencies = dependencies.slice(0, limit).map(dependency => this.sanitizeDependencyDetail(dependency, null));
    const sanitizedRecommendations = recommendations.slice(0, limit).map(recommendation => this.sanitizeGraphRecommendation(recommendation));

    return {
      contextType: options.contextType || 'work_graph',
      sourceProvider: options.sourceProvider || 'trello',
      sourceId: options.sourceId || null,
      sourceName: options.sourceName || '',
      counts: {
        items: items.length,
        dependencies: dependencies.length,
        recommendations: recommendations.length,
        decisions: candidates.length
      },
      items: sanitizedItems,
      dependencies: sanitizedDependencies,
      recommendations: sanitizedRecommendations,
      candidates: candidates.sort((left, right) => (right.graphScore || 0) - (left.graphScore || 0)).slice(0, limit),
      sourceLinks: this.sourceLinksForLedgerContext(sanitizedItems, sanitizedDependencies, sanitizedRecommendations, limit),
      filters: this.filtersForLedgerContext(sanitizedItems, sanitizedDependencies, sanitizedRecommendations)
    };
  }

  async dependencySummaryForItem(item, workspaceId) {
    if (!item?._id) return this.normalizeDependencySummary();
    const dependencies = await WorkDependency.find({
      workspaceId,
      $or: [
        { sourceItemId: item._id },
        { targetItemId: item._id }
      ]
    }).limit(100);
    return this.dependencySummaryByItem([item._id], dependencies).get(String(item._id));
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
      byDependencyFreshness: {},
      byDependencyReviewStatus: {},
      reviewMetrics: this.dependencyReviewMetrics(),
      providerReviewQuality: [],
      items: [],
      dependencies: []
    };
  }

  emptyLedgerContext(contextType = 'work_graph') {
    return {
      contextType,
      sourceProvider: 'trello',
      sourceId: null,
      sourceName: '',
      counts: {
        items: 0,
        dependencies: 0,
        recommendations: 0,
        decisions: 0
      },
      items: [],
      dependencies: [],
      recommendations: [],
      candidates: [],
      sourceLinks: [],
      filters: {
        providers: [],
        dependencyTypes: [],
        directions: []
      }
    };
  }

  aggregateRows(rows = []) {
    return rows.reduce((result, row) => {
      result[row._id || 'unknown'] = row.count;
      return result;
    }, {});
  }

  providerReviewQualityRows(rows = []) {
    return rows.map(row => {
      const dependencies = Number(row.dependencies) || 0;
      const stale = Number(row.stale) || 0;
      const pendingReview = Number(row.staleUnreviewed) || 0;
      const confirmed = Number(row.confirmed) || 0;
      const refreshed = Number(row.refreshed) || 0;
      const dismissed = Number(row.dismissed) || 0;
      const reviewed = confirmed + refreshed + dismissed;
      const reviewable = pendingReview + reviewed;

      return {
        provider: row._id || 'unknown',
        dependencies,
        stale,
        pendingReview,
        confirmed,
        refreshed,
        dismissed,
        reviewed,
        staleRate: dependencies ? Math.round((stale / dependencies) * 100) : 0,
        reviewCoverage: reviewable ? Math.round((reviewed / reviewable) * 100) : 100,
        status: pendingReview > 0 ? 'needs_review' : stale > 0 ? 'reviewed_stale' : 'stable'
      };
    });
  }

  dependencyReviewMetrics(freshnessRows = [], reviewRows = [], providerReviewQuality = []) {
    const freshness = this.aggregateRows(freshnessRows);
    const reviewStatus = this.aggregateRows(reviewRows);
    const pendingReview = providerReviewQuality.reduce((total, row) => total + (Number(row.pendingReview) || 0), 0);
    const confirmed = Number(reviewStatus.confirmed) || 0;
    const refreshed = Number(reviewStatus.refreshed) || 0;
    const dismissed = Number(reviewStatus.dismissed) || 0;
    const reviewed = confirmed + refreshed + dismissed;
    const reviewable = pendingReview + reviewed;

    return {
      stale: Number(freshness.stale) || 0,
      fresh: Number(freshness.fresh) || 0,
      pendingReview,
      reviewed,
      confirmed,
      refreshed,
      dismissed,
      reviewCoverage: reviewable ? Math.round((reviewed / reviewable) * 100) : 100
    };
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
        this.addDependencyToSummary(byItem.get(sourceId), dependency.dependencyType, 'source', dependency.freshnessStatus);
      }
      if (byItem.has(targetId)) {
        this.addDependencyToSummary(byItem.get(targetId), dependency.dependencyType, 'target', dependency.freshnessStatus);
      }
    }

    return byItem;
  }

  addDependencyToSummary(summary, dependencyType, direction, freshnessStatus = 'fresh') {
    summary.dependencyCount += 1;
    summary.dependencyTypes[dependencyType || 'unknown'] = (summary.dependencyTypes[dependencyType || 'unknown'] || 0) + 1;
    if (freshnessStatus === 'stale') {
      summary.staleDependencyCount = (Number(summary.staleDependencyCount) || 0) + 1;
      return summary;
    }
    summary.activeDependencyCount = (Number(summary.activeDependencyCount) || 0) + 1;

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
      activeDependencyCount: Number(summary.activeDependencyCount) || 0,
      staleDependencyCount: Number(summary.staleDependencyCount) || 0,
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
    if (dependencySummary.staleDependencyCount > 0) {
      return `${reason} ${dependencySummary.staleDependencyCount} stale graph dependenc${dependencySummary.staleDependencyCount === 1 ? 'y needs' : 'ies need'} review before it is trusted.`;
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
      targetTitle: ref.targetTitle || ref.label || '',
      targetUrl: ref.targetUrl || ref.url || '',
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
      targetTitle: context.label || (typeof target === 'object' ? pick(target.title, target.name, target.summary, target.fields?.summary) : undefined),
      targetUrl: context.url || (typeof target === 'object' ? pick(target.url, target.html_url, target.htmlUrl, target.permalink_url, target.webUrl, target.self) : undefined),
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
      sourceExternalId: dependency.sourceExternalId || dependency.metadata?.sourceExternalId || '',
      targetProvider: dependency.targetProvider || dependency.metadata?.targetProvider || '',
      targetExternalId: dependency.targetExternalId || dependency.metadata?.targetExternalId || '',
      targetTitle: dependency.targetTitle || dependency.metadata?.targetTitle || '',
      targetUrl: dependency.targetUrl || dependency.metadata?.targetUrl || '',
      resolutionStatus: dependency.resolutionStatus || dependency.metadata?.resolutionStatus || 'resolved',
      freshnessStatus: dependency.freshnessStatus || dependency.metadata?.freshnessStatus || 'fresh',
      staleSince: dependency.staleSince || dependency.metadata?.staleSince || null,
      staleReason: dependency.staleReason || dependency.metadata?.staleReason || '',
      reviewStatus: dependency.reviewStatus || dependency.metadata?.reviewStatus || 'unreviewed',
      reviewedAt: dependency.reviewedAt || dependency.metadata?.reviewedAt || null,
      reviewedBy: dependency.reviewedBy || dependency.metadata?.reviewedBy || '',
      reviewReason: dependency.reviewReason || dependency.metadata?.reviewReason || '',
      lastSeenAt: dependency.lastSeenAt || dependency.metadata?.lastSeenAt || dependency.updatedAt || null,
      externalId: dependency.externalId,
      confidence: dependency.confidence,
      evidenceRefs: dependency.evidenceRefs || [],
      metadata: dependency.metadata || {},
      createdAt: dependency.createdAt,
      updatedAt: dependency.updatedAt
    };
  }

  sanitizeDependencyDetail(dependency, currentItemId) {
    const sourceId = String(dependency.sourceItemId?._id || dependency.sourceItemId || '');
    const targetId = String(dependency.targetItemId?._id || dependency.targetItemId || '');
    const currentId = currentItemId ? String(currentItemId) : '';
    const direction = sourceId === currentId ? 'outgoing' : targetId === currentId ? 'incoming' : 'related';
    const peerItem = direction === 'outgoing' ? dependency.targetItemId
      : direction === 'incoming' ? dependency.sourceItemId
        : null;

    return {
      ...this.sanitizeDependency(dependency),
      direction,
      peerItem: peerItem && typeof peerItem === 'object' && peerItem._id
        ? this.sanitizeItem(peerItem)
        : null,
      sourceItem: dependency.sourceItemId && typeof dependency.sourceItemId === 'object' && dependency.sourceItemId._id
        ? this.sanitizeItem(dependency.sourceItemId)
        : null,
      targetItem: dependency.targetItemId && typeof dependency.targetItemId === 'object' && dependency.targetItemId._id
        ? this.sanitizeItem(dependency.targetItemId)
        : null,
      unresolvedTarget: !dependency.targetItemId || typeof dependency.targetItemId !== 'object'
        ? this.sanitizeUnresolvedTarget(dependency)
        : null,
      relationship: this.dependencyRelationshipLabel(dependency.dependencyType, direction)
    };
  }

  sanitizeUnresolvedTarget(dependency) {
    const targetProvider = dependency.targetProvider || dependency.metadata?.targetProvider;
    const targetExternalId = dependency.targetExternalId || dependency.metadata?.targetExternalId;
    if (!targetProvider && !targetExternalId) return null;
    return {
      id: null,
      sourceProvider: targetProvider || dependency.sourceProvider || 'provider',
      externalId: targetExternalId || '',
      title: dependency.targetTitle || dependency.metadata?.targetTitle || targetExternalId || 'Unresolved dependency target',
      status: dependency.resolutionStatus || dependency.metadata?.resolutionStatus || 'unresolved',
      url: dependency.targetUrl || dependency.metadata?.targetUrl || null
    };
  }

  sanitizeContainer(container) {
    return {
      id: String(container._id),
      sourceProvider: container.sourceProvider,
      externalId: container.externalId,
      name: container.name,
      containerType: container.containerType,
      url: container.url || null,
      lastSeenAt: container.lastSeenAt,
      createdAt: container.createdAt,
      updatedAt: container.updatedAt
    };
  }

  sanitizeActor(actor) {
    return {
      id: String(actor._id),
      sourceProvider: actor.sourceProvider,
      externalId: actor.externalId,
      displayName: actor.displayName,
      actorType: actor.actorType,
      lastSeenAt: actor.lastSeenAt
    };
  }

  sanitizeEvent(event) {
    return {
      id: String(event._id),
      sourceProvider: event.sourceProvider,
      externalId: event.externalId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      summary: event.summary,
      metadata: event.metadata || {}
    };
  }

  sanitizeGraphRecommendation(recommendation) {
    const payload = recommendation.actionPayload || {};
    return {
      id: String(recommendation._id),
      title: recommendation.title,
      findingType: recommendation.findingType,
      recommendedAction: recommendation.recommendedAction,
      actionType: recommendation.actionType,
      sourceProvider: payload.sourceProvider || null,
      externalId: payload.externalId || null,
      providerUrl: payload.providerUrl || null,
      workItemId: payload.workItemId ? String(payload.workItemId) : null,
      riskLevel: recommendation.riskLevel,
      ownerType: recommendation.ownerType,
      status: recommendation.status,
      requiresApproval: recommendation.requiresApproval,
      approvalReason: recommendation.approvalReason,
      confidence: recommendation.confidence,
      createdAt: recommendation.createdAt,
      updatedAt: recommendation.updatedAt
    };
  }

  sourceLinksForLedgerContext(items = [], dependencies = [], recommendations = [], limit = 25) {
    const links = new Map();
    const add = (item) => {
      if (!item?.url) return;
      const key = `${item.sourceProvider || 'provider'}:${item.externalId || item.id || item.url}`;
      if (links.has(key)) return;
      links.set(key, {
        id: item.id || null,
        sourceProvider: item.sourceProvider || 'provider',
        externalId: item.externalId || item.canonicalKey || '',
        title: item.title || item.externalId || 'Source item',
        status: item.status || 'unknown',
        url: item.url
      });
    };

    items.forEach(add);
    dependencies.forEach(dependency => {
      add(dependency.sourceItem);
      add(dependency.targetItem);
      add(dependency.peerItem);
      add(dependency.unresolvedTarget);
    });
    recommendations.forEach(recommendation => {
      if (!recommendation.providerUrl) return;
      const key = `${recommendation.sourceProvider || 'provider'}:${recommendation.externalId || recommendation.workItemId || recommendation.providerUrl}`;
      if (links.has(key)) return;
      links.set(key, {
        id: recommendation.workItemId || null,
        sourceProvider: recommendation.sourceProvider || 'provider',
        externalId: recommendation.externalId || '',
        title: recommendation.title || recommendation.recommendedAction || 'Recommendation source',
        status: recommendation.status || 'pending',
        url: recommendation.providerUrl
      });
    });

    return Array.from(links.values()).slice(0, limit);
  }

  filtersForLedgerContext(items = [], dependencies = [], recommendations = []) {
    const providers = new Set();
    const dependencyTypes = new Set();
    const directions = new Set();
    const addProvider = value => {
      if (value) providers.add(value);
    };

    items.forEach(item => addProvider(item.sourceProvider));
    dependencies.forEach(dependency => {
      addProvider(dependency.sourceProvider);
      addProvider(dependency.targetProvider);
      addProvider(dependency.sourceItem?.sourceProvider);
      addProvider(dependency.targetItem?.sourceProvider);
      addProvider(dependency.unresolvedTarget?.sourceProvider);
      if (dependency.dependencyType) dependencyTypes.add(dependency.dependencyType);
      if (dependency.direction) directions.add(dependency.direction);
    });
    recommendations.forEach(recommendation => addProvider(recommendation.sourceProvider));

    return {
      providers: Array.from(providers).sort(),
      dependencyTypes: Array.from(dependencyTypes).sort(),
      directions: Array.from(directions).sort()
    };
  }

  actorExternalIdsForItem(item) {
    return (item.ownerKeys || [])
      .map(key => String(key || ''))
      .map(key => key.startsWith(`${item.sourceProvider}:`) ? key.slice(item.sourceProvider.length + 1) : key)
      .filter(Boolean);
  }

  dependencyRelationshipLabel(type, direction) {
    if (direction === 'outgoing') {
      if (type === 'blocks') return 'This item blocks the linked item';
      if (['blocked_by', 'depends_on'].includes(type)) return 'This item depends on the linked item';
      if (type === 'duplicates') return 'This item duplicates the linked item';
      return 'This item relates to the linked item';
    }
    if (direction === 'incoming') {
      if (type === 'blocks') return 'The linked item is blocked by this item';
      if (['blocked_by', 'depends_on'].includes(type)) return 'The linked item depends on this item';
      if (type === 'duplicates') return 'The linked item duplicates this item';
      return 'The linked item relates to this item';
    }
    return 'Dependency relationship';
  }

  trelloBoardExternalIds(board = {}) {
    return [
      board.trelloId,
      board.externalId,
      board.shortLink,
      board.name,
      board._id ? String(board._id) : null
    ].filter(Boolean).map(value => String(value));
  }

  trelloCardExternalIds(card = {}) {
    return [
      card.trelloId,
      card.externalId,
      card.shortLink,
      card._id ? String(card._id) : null
    ].filter(Boolean).map(value => String(value));
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
