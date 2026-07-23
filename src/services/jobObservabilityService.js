const mongoose = require('mongoose');
const JobControl = require('../models/JobControl');
const JobRun = require('../models/JobRun');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 100;

const trackedJobs = [
  {
    jobName: 'trello.full_sync',
    jobType: 'sync',
    label: 'Full Trello sync',
    staleAfterMinutes: 26 * 60,
    manualTriggerAllowed: false
  },
  {
    jobName: 'trello.incremental_sync',
    jobType: 'sync',
    label: 'Incremental Trello sync',
    staleAfterMinutes: 45,
    manualTriggerAllowed: true
  },
  {
    jobName: 'analytics.generate_all',
    jobType: 'analytics',
    label: 'Portfolio analytics',
    staleAfterMinutes: 150,
    manualTriggerAllowed: true
  },
  {
    jobName: 'interventions.process_all',
    jobType: 'intervention',
    label: 'Intervention analysis',
    staleAfterMinutes: 90,
    manualTriggerAllowed: true
  },
  {
    jobName: 'interventions.follow_ups',
    jobType: 'intervention',
    label: 'Follow-up processing',
    staleAfterMinutes: 150,
    manualTriggerAllowed: true
  },
  {
    jobName: 'interventions.escalations',
    jobType: 'intervention',
    label: 'Escalation processing',
    staleAfterMinutes: 270,
    manualTriggerAllowed: true
  },
  {
    jobName: 'performance.daily',
    jobType: 'performance',
    label: 'Daily performance',
    staleAfterMinutes: 30 * 60,
    manualTriggerAllowed: true
  },
  {
    jobName: 'performance.weekly',
    jobType: 'performance',
    label: 'Weekly performance',
    staleAfterMinutes: 8 * 24 * 60,
    manualTriggerAllowed: true
  },
  {
    jobName: 'performance.monthly',
    jobType: 'performance',
    label: 'Monthly performance',
    staleAfterMinutes: 40 * 24 * 60,
    manualTriggerAllowed: true
  },
  {
    jobName: 'trello.webhook_event',
    jobType: 'webhook',
    label: 'Trello webhook processing',
    staleAfterMinutes: 24 * 60,
    manualTriggerAllowed: false
  },
  {
    jobName: 'connectors.work_signals_sync',
    jobType: 'sync',
    label: 'Connector work signal sync',
    staleAfterMinutes: 90,
    manualTriggerAllowed: true
  },
  {
    jobName: 'notifications.reconciliation_alerts',
    jobType: 'system',
    label: 'Reconciliation alert delivery',
    staleAfterMinutes: 45,
    manualTriggerAllowed: true
  },
  {
    jobName: 'notifications.weekly_status_reports',
    jobType: 'system',
    label: 'Weekly status report delivery',
    staleAfterMinutes: 8 * 24 * 60,
    manualTriggerAllowed: false
  },
  {
    jobName: 'identity.invitation_retention',
    jobType: 'security',
    label: 'Invitation privacy retention',
    staleAfterMinutes: 26 * 60,
    manualTriggerAllowed: false
  }
];

class JobObservabilityService {
  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());
  }

  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  async trackJob(options, callback) {
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const scopedOptions = { ...options, workspaceId };
    const paused = await this.isJobPaused(options.jobName, { workspaceId });
    if (paused) {
      return this.recordSkippedRun(scopedOptions, 'Job is paused by operator control');
    }

    const run = await this.startRun(scopedOptions);

    try {
      const result = await callback(run);
      await this.finishRun(run, 'succeeded', result);
      return result;
    } catch (error) {
      await this.finishRun(run, 'failed', { errorMessage: error.message });
      throw error;
    }
  }

  async startRun(options = {}) {
    const startedAt = new Date();
    const config = this.getJobConfig(options.jobName);
    const data = {
      workspaceId: this.resolveWorkspaceId(options.workspaceId),
      jobName: options.jobName,
      jobType: options.jobType || config?.jobType || 'system',
      triggerType: options.triggerType || 'scheduled',
      boardId: options.boardId,
      startedAt,
      staleAfterMinutes: options.staleAfterMinutes || config?.staleAfterMinutes || 120,
      metadata: options.metadata || {}
    };

    if (!this.isDatabaseReady()) {
      return {
        ...data,
        _id: `memory-${data.jobName}-${startedAt.getTime()}`,
        status: 'running',
        inMemory: true
      };
    }

    return JobRun.create(data);
  }

  async finishRun(run, status, result = {}) {
    const finishedAt = new Date();
    const durationMs = finishedAt - new Date(run.startedAt || run.createdAt || Date.now());
    const update = {
      status,
      finishedAt,
      durationMs,
      processedCount: result.processedCount || 0,
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      errorMessage: result.errorMessage,
      metadata: {
        ...(run.metadata || {}),
        ...(result.metadata || {})
      }
    };

    if (run.inMemory || !this.isDatabaseReady()) {
      if (status === 'failed') {
        logger.warn(`Job ${run.jobName} failed without persisted job history: ${update.errorMessage || 'Unknown error'}`);
      }
      return { ...run, ...update };
    }

    Object.assign(run, update);
    return run.save();
  }

  async recordSkippedRun(options = {}, reason = 'Skipped') {
    const run = await this.startRun({
      ...options,
      metadata: {
        ...(options.metadata || {}),
        skippedReason: reason
      }
    });

    return this.finishRun(run, 'skipped', {
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      metadata: { skippedReason: reason }
    });
  }

  async listRuns(filters = {}) {
    if (!this.isDatabaseReady()) {
      return this.getDemoRuns();
    }

    const query = {};
    query.workspaceId = this.resolveWorkspaceId(filters.workspaceId);
    if (filters.jobName) query.jobName = filters.jobName;
    if (filters.jobType) query.jobType = filters.jobType;
    if (filters.status) query.status = filters.status;
    if (filters.boardId) query.boardId = filters.boardId;

    return JobRun.find(query)
      .populate('boardId')
      .sort({ startedAt: -1 })
      .limit(filters.limit || DEFAULT_LIMIT);
  }

  async getDashboard(filters = {}) {
    const runs = await this.listRuns({
      ...filters,
      limit: filters.limit || 250
    });
    const controls = await this.listControls({ workspaceId: filters.workspaceId });
    return this.buildDashboard(runs, new Date(), controls);
  }

  buildDashboard(runs = [], now = new Date(), controls = []) {
    const latestByJob = new Map();
    for (const run of runs) {
      if (!latestByJob.has(run.jobName)) {
        latestByJob.set(run.jobName, run);
      }
    }

    const controlsByJob = new Map(controls.map(control => [control.jobName, control]));

    const health = trackedJobs.map(config => {
      const latest = latestByJob.get(config.jobName);
      const lastSuccess = runs.find(run => run.jobName === config.jobName && run.status === 'succeeded');
      const control = controlsByJob.get(config.jobName);
      const paused = control?.status === 'paused';
      const stale = lastSuccess
        ? (now - new Date(lastSuccess.finishedAt || lastSuccess.startedAt)) > config.staleAfterMinutes * 60 * 1000
        : true;
      const status = paused
        ? 'paused'
        : latest?.status === 'failed'
        ? 'failed'
        : stale
          ? 'stale'
          : 'healthy';

      return {
        jobName: config.jobName,
        jobType: config.jobType,
        label: config.label,
        status,
        paused,
        manualTriggerAllowed: Boolean(config.manualTriggerAllowed),
        stale,
        staleAfterMinutes: config.staleAfterMinutes,
        lastRunAt: latest?.startedAt,
        lastSuccessAt: lastSuccess?.finishedAt || lastSuccess?.startedAt,
        lastDurationMs: latest?.durationMs || 0,
        lastError: latest?.errorMessage || '',
        processedCount: latest?.processedCount || 0,
        successCount: latest?.successCount || 0,
        failureCount: latest?.failureCount || 0,
        metadata: latest?.metadata || {},
        pausedAt: control?.pausedAt,
        pausedBy: control?.pausedBy || '',
        pausedReason: control?.pausedReason || ''
      };
    });

    const failedRuns = runs.filter(run => run.status === 'failed');
    const runningRuns = runs.filter(run => run.status === 'running');
    const staleJobs = health.filter(item => item.stale);

    return {
      mode: this.isDatabaseReady() ? 'live' : 'demo',
      generatedAt: now,
      summary: {
        trackedJobs: trackedJobs.length,
        healthyJobs: health.filter(item => item.status === 'healthy').length,
        staleJobs: staleJobs.length,
        failedJobs: health.filter(item => item.status === 'failed').length,
        pausedJobs: health.filter(item => item.status === 'paused').length,
        runningJobs: runningRuns.length,
        failedRuns: failedRuns.length
      },
      health,
      recentRuns: runs.slice(0, 25).map(run => this.serializeRun(run))
    };
  }

  serializeRun(run) {
    return {
      id: String(run._id || run.id || ''),
      jobName: run.jobName,
      jobType: run.jobType,
      triggerType: run.triggerType,
      status: run.status,
      boardName: run.boardId?.name || '',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs || 0,
      processedCount: run.processedCount || 0,
      successCount: run.successCount || 0,
      failureCount: run.failureCount || 0,
      errorMessage: run.errorMessage || '',
      metadata: run.metadata || {}
    };
  }

  getJobConfig(jobName) {
    return trackedJobs.find(job => job.jobName === jobName);
  }

  ensureKnownJob(jobName) {
    const config = this.getJobConfig(jobName);
    if (!config) {
      const error = new Error('Job is not registered for operator control');
      error.statusCode = 404;
      throw error;
    }
    return config;
  }

  requireDatabaseForControls() {
    if (!this.isDatabaseReady()) {
      const error = new Error('MongoDB is required before job controls can be changed');
      error.statusCode = 503;
      throw error;
    }
  }

  async listControls(options = {}) {
    if (!this.isDatabaseReady()) return [];
    return JobControl.find({
      workspaceId: this.resolveWorkspaceId(options.workspaceId),
      jobName: { $in: trackedJobs.map(job => job.jobName) }
    });
  }

  async getControl(jobName, options = {}) {
    this.ensureKnownJob(jobName);
    if (!this.isDatabaseReady()) return null;
    return JobControl.findOne({ jobName, workspaceId: this.resolveWorkspaceId(options.workspaceId) });
  }

  async isJobPaused(jobName, options = {}) {
    if (!jobName || !this.isDatabaseReady()) return false;
    const control = await JobControl.findOne({ jobName, workspaceId: this.resolveWorkspaceId(options.workspaceId) }).select('status');
    return control?.status === 'paused';
  }

  async setPaused(jobName, paused, options = {}) {
    this.ensureKnownJob(jobName);
    this.requireDatabaseForControls();

    const actor = options.actor || 'sneup';
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const update = paused
      ? {
        status: 'paused',
        pausedAt: new Date(),
        pausedBy: actor,
        pausedReason: options.reason || 'Paused from Sneup command center'
      }
      : {
        status: 'active',
        resumedAt: new Date(),
        resumedBy: actor
      };

    return JobControl.findOneAndUpdate(
      { jobName, workspaceId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  async markManualRun(jobName, actor = 'sneup', options = {}) {
    this.ensureKnownJob(jobName);
    if (!this.isDatabaseReady()) return null;

    return JobControl.findOneAndUpdate(
      { jobName, workspaceId: this.resolveWorkspaceId(options.workspaceId) },
      {
        $set: {
          lastManualRunAt: new Date(),
          lastManualRunBy: actor
        },
        $setOnInsert: { status: 'active' }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  getDemoRuns() {
    const now = Date.now();
    return [
      {
        _id: 'demo-job-run-1',
        jobName: 'trello.incremental_sync',
        jobType: 'sync',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date(now - 15 * 60 * 1000),
        finishedAt: new Date(now - 14 * 60 * 1000),
        durationMs: 61000,
        processedCount: 3,
        successCount: 3,
        failureCount: 0,
        metadata: { mode: 'demo' }
      },
      {
        _id: 'demo-job-run-2',
        jobName: 'analytics.generate_all',
        jobType: 'analytics',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date(now - 55 * 60 * 1000),
        finishedAt: new Date(now - 53 * 60 * 1000),
        durationMs: 122000,
        processedCount: 3,
        successCount: 3,
        failureCount: 0,
        metadata: { mode: 'demo' }
      },
      {
        _id: 'demo-job-run-3',
        jobName: 'interventions.process_all',
        jobType: 'intervention',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date(now - 28 * 60 * 1000),
        finishedAt: new Date(now - 27 * 60 * 1000),
        durationMs: 44000,
        processedCount: 3,
        successCount: 3,
        failureCount: 0,
        metadata: { mode: 'demo' }
      },
      {
        _id: 'demo-job-run-4',
        jobName: 'connectors.work_signals_sync',
        jobType: 'sync',
        triggerType: 'scheduled',
        status: 'succeeded',
        startedAt: new Date(now - 38 * 60 * 1000),
        finishedAt: new Date(now - 37 * 60 * 1000),
        durationMs: 39000,
        processedCount: 2,
        successCount: 2,
        failureCount: 0,
        metadata: {
          mode: 'demo',
          providerQueueCount: 2,
          concurrency: 2,
          dependencyFreshness: {
            providerCount: 2,
            markedStale: 1,
            failureCount: 0,
            byProvider: {
              github: { markedStale: 1, staleAfterDays: 14 },
              asana: { markedStale: 0, staleAfterDays: 30 }
            }
          }
        }
      }
    ];
  }
}

module.exports = new JobObservabilityService();
module.exports.trackedJobs = trackedJobs;
