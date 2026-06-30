const mongoose = require('mongoose');
const schedule = require('node-schedule');
const ConnectorAccount = require('../models/ConnectorAccount');
const jobObservabilityService = require('./jobObservabilityService');
const workSignalAdapterService = require('./workSignalAdapterService');
const workSignalService = require('./workSignalService');
const logger = require('../utils/logger');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

class ConnectorSyncService {
  constructor() {
    this.job = null;
  }

  init() {
    if (this.job) return this.job;
    const cron = process.env.CONNECTOR_SYNC_CRON || '*/30 * * * *';
    this.job = schedule.scheduleJob(cron, () => this.runTrackedSync({
      triggerType: 'scheduled'
    }));
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
      metadata: {
        actor: options.actor || 'connector-sync'
      }
    }, () => this.syncConnectedAccounts(options));
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

    for (const account of accounts) {
      try {
        const result = await this.syncAccount(account, options);
        successCount += 1;
        signalCount += result.signalCount;
      } catch (error) {
        failureCount += 1;
        account.status = 'failed';
        account.lastError = error.message;
        await account.save();
        logger.error(`Failed to sync connector account ${account._id}:`, error);
      }
    }

    return {
      processedCount: accounts.length,
      successCount,
      failureCount,
      metadata: {
        signalCount,
        adapterCount: connectorIds.length
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
    const delta = await workSignalAdapterService.fetchDelta(account, cursor);
    let signalCount = 0;

    for (const record of delta.records || []) {
      await workSignalService.upsertProviderRecord(account._id, record, {
        workspaceId: account.workspaceId,
        actorId: options.actor || 'connector-sync'
      });
      signalCount += 1;
    }

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
        finishedAt: new Date()
      }
    };
    await account.save();

    return {
      accountId: String(account._id),
      connectorId: account.connectorId,
      signalCount,
      nextCursor: delta.nextCursor || cursor
    };
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
