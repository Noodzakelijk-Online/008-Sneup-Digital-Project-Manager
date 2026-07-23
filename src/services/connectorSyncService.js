const mongoose = require('mongoose');
const schedule = require('node-schedule');
const ConnectorAccount = require('../models/ConnectorAccount');
const jobObservabilityService = require('./jobObservabilityService');
const providerSyncPolicyService = require('./providerSyncPolicyService');
const workGraphService = require('./workGraphService');
const workSignalAdapterService = require('./workSignalAdapterService');
const workSignalService = require('./workSignalService');
const logger = require('../utils/logger');
const {
  getDefaultWorkspaceObjectId,
  listActiveWorkspaceIds,
  normalizeWorkspaceObjectId
} = require('./workspaceScopeService');

class ConnectorSyncService {
  constructor() {
    this.job = null;
    this.activeScheduledSync = null;
    this.scheduledSyncStartedAt = null;
  }

  init() {
    if (this.job) return this.job;
    const cron = process.env.CONNECTOR_SYNC_CRON || '*/30 * * * *';
    this.job = schedule.scheduleJob(cron, () => this.runScheduledSyncs());
    logger.info('Connector sync service initialized');
    return this.job;
  }

  stop() {
    if (this.job) {
      this.job.cancel();
      this.job = null;
    }
  }

  async runTrackedSync(options = {}) {
    return jobObservabilityService.trackJob({
      jobName: 'connectors.work_signals_sync',
      jobType: 'sync',
      triggerType: options.triggerType || 'scheduled',
      workspaceId: options.workspaceId,
      metadata: {
        actor: options.actor || 'connector-sync'
      }
    }, () => this.syncConnectedAccounts(options));
  }

  async runScheduledSyncs() {
    if (this.activeScheduledSync) {
      const startedAt = this.scheduledSyncStartedAt;
      logger.warn('Skipping overlapping scheduled connector sync', { startedAt });
      return {
        skipped: true,
        reason: 'scheduled_sync_in_progress',
        startedAt
      };
    }

    this.scheduledSyncStartedAt = new Date().toISOString();
    const scheduledRun = this.runScheduledSyncPass();
    this.activeScheduledSync = scheduledRun;

    try {
      return await scheduledRun;
    } finally {
      this.activeScheduledSync = null;
      this.scheduledSyncStartedAt = null;
    }
  }

  async runScheduledSyncPass() {
    const workspaceIds = await listActiveWorkspaceIds();
    const results = [];

    for (const workspaceId of workspaceIds) {
      results.push(await this.runTrackedSync({
        triggerType: 'scheduled',
        workspaceId
      }));
    }

    return results;
  }

  async syncConnectedAccounts(options = {}) {
    this.requireDatabase();
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    const connectorIds = workSignalAdapterService.getFirstWaveConnectorIds();
    const accounts = await ConnectorAccount.find({
      workspaceId,
      status: 'connected',
      connectorId: { $in: connectorIds }
    }).sort({ updatedAt: 1 });

    let successCount = 0;
    let failureCount = 0;
    let signalCount = 0;
    let retryCount = 0;
    let rateLimitWaitMs = 0;
    const providerStats = {};
    const successfulProviders = new Set();

    for (const account of accounts) {
      try {
        const result = await this.syncAccount(account, {
          ...options,
          deferDependencyFreshness: true
        });
        successCount += 1;
        signalCount += result.signalCount;
        retryCount += result.retryCount || 0;
        rateLimitWaitMs += result.rateLimitWaitMs || 0;
        successfulProviders.add(result.connectorId);
        this.recordProviderStats(providerStats, result.connectorId, result);
      } catch (error) {
        failureCount += 1;
        account.status = 'failed';
        account.lastError = this.safeErrorMessage(error);
        await account.save();
        const policy = error.connectorSyncPolicy || {};
        retryCount += policy.retryCount || 0;
        rateLimitWaitMs += policy.rateLimitWaitMs || 0;
        this.recordProviderStats(providerStats, account.connectorId, {
          retryCount: policy.retryCount || 0,
          rateLimitWaitMs: policy.rateLimitWaitMs || 0,
          failed: true
        });
        logger.error(`Failed to sync connector account ${account._id}: ${this.safeErrorMessage(error)}`);
      }
    }

    const dependencyFreshness = await this.finalizeDependencyFreshness(workspaceId, successfulProviders);

    return {
      processedCount: accounts.length,
      successCount,
      failureCount,
      metadata: {
        signalCount,
        adapterCount: connectorIds.length,
        retryCount,
        rateLimitWaitMs,
        providerStats,
        dependencyFreshness
      }
    };
  }

  async syncAccount(accountOrId, options = {}) {
    this.requireDatabase();
    const account = typeof accountOrId === 'object' && accountOrId._id
      ? accountOrId
      : await ConnectorAccount.findOne({
        _id: accountOrId,
        workspaceId: normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId())
      });

    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }

    const cursor = account.metadata?.workSignalCursor || null;
    const syncResult = await providerSyncPolicyService.run(
      account.connectorId,
      () => workSignalAdapterService.fetchDelta(account, cursor),
      options
    );
    const delta = syncResult.result || {};
    let signalCount = 0;

    for (const record of delta.records || []) {
      await workSignalService.upsertProviderRecord(account._id, record, {
        workspaceId: account.workspaceId,
        actorId: options.actor || 'connector-sync',
        deferDependencyFreshness: options.deferDependencyFreshness === true
      });
      signalCount += 1;
    }

    const dependencyFreshness = options.deferDependencyFreshness === true
      ? null
      : await this.finalizeDependencyFreshness(account.workspaceId, [account.connectorId]);

    account.status = 'connected';
    account.lastSyncAt = new Date();
    account.lastError = undefined;
    account.metadata = {
      ...(account.metadata || {}),
      workSignalCursor: delta.nextCursor || cursor,
      workSignalAdapter: account.connectorId,
      lastWorkSignalSync: {
        signalCount,
        hasMore: Boolean(delta.hasMore),
        retryCount: syncResult.retryCount,
        rateLimitWaitMs: syncResult.rateLimitWaitMs,
        attemptCount: syncResult.attemptCount,
        source: delta.metadata?.source,
        repositories: delta.metadata?.repositories || 0,
        boards: delta.metadata?.boards || 0,
        sites: delta.metadata?.sites || 0,
        workspaces: delta.metadata?.workspaces || 0,
        projects: delta.metadata?.projects || 0,
        tasks: delta.metadata?.tasks || 0,
        channels: delta.metadata?.channels || 0,
        issues: delta.metadata?.issues || 0,
        workflows: delta.metadata?.workflows || 0,
        executions: delta.metadata?.executions || 0,
        timeEntries: delta.metadata?.timeEntries || 0,
        mergeRequests: delta.metadata?.mergeRequests || 0,
        items: delta.metadata?.items || 0,
        pages: delta.metadata?.pages || 0,
        dataSources: delta.metadata?.dataSources || 0,
        dependencyFreshness,
        finishedAt: new Date()
      }
    };
    await account.save();

    return {
      accountId: String(account._id),
      connectorId: account.connectorId,
      signalCount,
      nextCursor: delta.nextCursor || cursor,
      retryCount: syncResult.retryCount,
      rateLimitWaitMs: syncResult.rateLimitWaitMs,
      attemptCount: syncResult.attemptCount,
      dependencyFreshness
    };
  }

  async finalizeDependencyFreshness(workspaceId, providers = []) {
    const sourceProviders = [...new Set([...providers].map(provider => String(provider || '').trim()).filter(Boolean))].sort();
    const byProvider = {};
    let markedStale = 0;
    let failureCount = 0;

    for (const sourceProvider of sourceProviders) {
      try {
        const result = await workGraphService.markStaleDependencies(workspaceId, { sourceProvider });
        const count = Number(result?.modifiedCount ?? result?.nModified ?? 0);
        const staleAfterDays = Number(result?.staleAfterDays);
        byProvider[sourceProvider] = {
          markedStale: count,
          ...(Number.isFinite(staleAfterDays) ? { staleAfterDays } : {})
        };
        markedStale += count;
      } catch (error) {
        failureCount += 1;
        byProvider[sourceProvider] = { markedStale: 0, error: this.safeErrorMessage(error) };
        logger.error(`Failed to finalize dependency freshness for ${sourceProvider}: ${this.safeErrorMessage(error)}`);
      }
    }

    return {
      providerCount: sourceProviders.length,
      markedStale,
      failureCount,
      byProvider
    };
  }

  recordProviderStats(stats, connectorId, result = {}) {
    const provider = connectorId || 'unknown';
    const current = stats[provider] || {
      accounts: 0,
      failures: 0,
      retryCount: 0,
      rateLimitWaitMs: 0
    };
    current.accounts += 1;
    current.failures += result.failed ? 1 : 0;
    current.retryCount += result.retryCount || 0;
    current.rateLimitWaitMs += result.rateLimitWaitMs || 0;
    stats[provider] = current;
  }

  safeErrorMessage(error) {
    const message = String(error?.response?.data?.message || error?.message || 'Connector sync failed');
    return message
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, '$1 [redacted]')
      .replace(/\b(api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|password|secret)=([^\s&]+)/gi, '$1=[redacted]')
      .slice(0, 500);
  }

  requireDatabase() {
    if (mongoose.connection.readyState !== 1) {
      const error = new Error('Database connection is required to sync connector work signals');
      error.statusCode = 503;
      throw error;
    }
  }
}

module.exports = new ConnectorSyncService();
