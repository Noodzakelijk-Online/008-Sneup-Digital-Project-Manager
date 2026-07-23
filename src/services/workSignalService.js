const mongoose = require('mongoose');
const WorkSignal = require('../models/WorkSignal');
const ConnectorAccount = require('../models/ConnectorAccount');
const { getConnector, getConnectors } = require('./connectorRegistry');
const workGraphService = require('./workGraphService');
const workSignalAdapterService = require('./workSignalAdapterService');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const STATUS_ALIASES = {
  backlog: 'open',
  todo: 'open',
  open: 'open',
  new: 'open',
  started: 'in_progress',
  progress: 'in_progress',
  in_progress: 'in_progress',
  active: 'in_progress',
  blocked: 'blocked',
  stuck: 'blocked',
  waiting: 'waiting',
  pending: 'waiting',
  done: 'done',
  complete: 'done',
  completed: 'done',
  closed: 'done',
  archived: 'archived'
};

const TYPE_ALIASES = {
  card: 'task',
  task: 'task',
  item: 'task',
  project: 'project',
  portfolio: 'project',
  comment: 'comment',
  update: 'comment',
  message: 'message',
  issue: 'issue',
  bug: 'issue',
  pull_request: 'pull_request',
  pr: 'pull_request',
  document: 'document',
  doc: 'document',
  survey: 'survey',
  file: 'file',
  folder: 'folder',
  directory: 'folder',
  event: 'event',
  meeting: 'event',
  time_entry: 'time_entry',
  workflow: 'workflow',
  execution: 'execution',
  test_run: 'test_run',
  risk: 'risk',
  decision: 'decision'
};

const PRIORITY_ALIASES = {
  low: 'low',
  normal: 'normal',
  medium: 'normal',
  default: 'normal',
  high: 'high',
  urgent: 'critical',
  critical: 'critical',
  blocker: 'critical'
};

const asArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
};

const parseDate = (value) => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const normalizeEnum = (value, aliases, fallback) => {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return aliases[key] || fallback;
};

class WorkSignalService {
  getAdapterContracts() {
    return getConnectors().map(connector => this.buildAdapterContract(connector.id)).filter(Boolean);
  }

  buildAdapterContract(connectorId) {
    const connector = getConnector(connectorId);
    if (!connector) return null;
    const providerAdapter = workSignalAdapterService.getAdapter(connector.id);

    return {
      connectorId: connector.id,
      connectorName: connector.name,
      category: connector.category,
      authType: connector.auth.type,
      syncTargets: connector.sync || [],
      outputModel: 'WorkSignal',
      adapterStatus: providerAdapter ? 'implemented' : 'contract_only',
      adapterCapabilities: providerAdapter?.capabilities || {
        list: false,
        fetchDelta: false,
        normalize: false,
        applyAction: false
      },
      requiredFields: ['externalId', 'title'],
      optionalFields: [
        'sourceType',
        'status',
        'priority',
        'description',
        'url',
        'owners',
        'labels',
        'dueAt',
        'providerCreatedAt',
        'providerUpdatedAt',
        'evidenceRefs',
        'raw'
      ],
      safeWritePolicy: 'Provider sync adapters may upsert normalized signals, but must not execute external provider actions.'
    };
  }

  normalizeProviderRecord(account, record = {}) {
    const providerPayload = workSignalAdapterService.normalize(account, record);
    return this.normalizeSignalPayload(account, providerPayload);
  }

  normalizeSignalPayload(account, payload = {}) {
    const externalId = String(payload.externalId || payload.id || payload.key || '').trim();
    const title = String(payload.title || payload.name || payload.summary || '').trim();

    if (!externalId) {
      const error = new Error('Work signal externalId is required');
      error.statusCode = 400;
      throw error;
    }

    if (!title) {
      const error = new Error('Work signal title is required');
      error.statusCode = 400;
      throw error;
    }

    return {
      workspaceId: this.resolveWorkspaceId(account.workspaceId),
      connectorAccountId: account._id,
      provider: account.connectorId,
      externalId,
      sourceType: normalizeEnum(payload.sourceType || payload.type || payload.objectType, TYPE_ALIASES, 'other'),
      title,
      description: String(payload.description || payload.body || ''),
      status: normalizeEnum(payload.status || payload.state, STATUS_ALIASES, 'unknown'),
      priority: normalizeEnum(payload.priority || payload.severity, PRIORITY_ALIASES, 'unknown'),
      url: payload.url || payload.webUrl || payload.htmlUrl,
      owners: asArray(payload.owners || payload.assignees || payload.owner),
      labels: asArray(payload.labels || payload.tags),
      dueAt: parseDate(payload.dueAt || payload.due || payload.deadline),
      providerCreatedAt: parseDate(payload.providerCreatedAt || payload.createdAt),
      providerUpdatedAt: parseDate(payload.providerUpdatedAt || payload.updatedAt || payload.modifiedAt),
      evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [],
      raw: payload.raw || payload
    };
  }

  async upsertSignal(accountId, payload = {}, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const account = await ConnectorAccount.findOne({ _id: accountId, workspaceId });
    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }

    const normalized = this.normalizeSignalPayload(account, payload);
    const signal = await this.upsertNormalizedSignal(account, normalized, { ...options, syncState: payload.syncState });
    account.lastSyncAt = new Date();
    account.lastError = undefined;
    await account.save();
    return signal;
  }

  async upsertNormalizedSignal(account, normalized, options = {}) {
    const now = new Date();
    const signal = await WorkSignal.findOneAndUpdate({
      workspaceId: normalized.workspaceId,
      connectorAccountId: account._id,
      provider: account.connectorId,
      externalId: normalized.externalId
    }, {
      $set: {
        ...normalized,
        lastSeenAt: now,
        syncState: {
          ...(options.syncState && typeof options.syncState === 'object' ? options.syncState : {}),
          lastUpsertedBy: options.actorId || 'sync-worker'
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

    await workGraphService.upsertFromSignal(signal, {
      actorId: options.actorId || 'sync-worker',
      deferDependencyFreshness: options.deferDependencyFreshness === true
    });

    return this.sanitizeSignal(signal);
  }

  async upsertProviderRecords(account, records = [], options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    if (!account?._id || String(account.workspaceId) !== String(workspaceId)) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }
    if (!Array.isArray(records)) {
      const error = new Error('Provider sync records must be an array');
      error.statusCode = 400;
      throw error;
    }

    let count = 0;
    let lastSignal = null;
    for (const record of records) {
      const providerPayload = workSignalAdapterService.normalize(account, record);
      const normalized = this.normalizeSignalPayload(account, providerPayload);
      lastSignal = await this.upsertNormalizedSignal(account, normalized, {
        ...options,
        workspaceId,
        actorId: options.actorId || 'provider-adapter',
        syncState: providerPayload.syncState
      });
      count += 1;
    }

    if (options.deferAccountSave !== true) {
      account.lastSyncAt = new Date();
      account.lastError = undefined;
      await account.save();
    }
    return { count, lastSignal };
  }

  async upsertProviderRecord(accountId, record = {}, options = {}) {
    this.requireDatabase();
    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const account = await ConnectorAccount.findOne({ _id: accountId, workspaceId });
    if (!account) {
      const error = new Error('Connector account not found');
      error.statusCode = 404;
      throw error;
    }

    const result = await this.upsertProviderRecords(account, [record], {
      ...options,
      workspaceId,
      actorId: options.actorId || 'provider-adapter'
    });
    return result.lastSignal;
  }

  async listSignals(options = {}) {
    if (!this.isDatabaseReady()) {
      return { count: 0, signals: [] };
    }

    const workspaceId = this.resolveWorkspaceId(options.workspaceId);
    const query = { workspaceId };
    if (options.provider) query.provider = options.provider;
    if (options.status) query.status = options.status;
    if (options.sourceType) query.sourceType = options.sourceType;
    if (options.priority) query.priority = options.priority;

    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 100, 500));
    const signals = await WorkSignal.find(query)
      .sort({ priority: 1, dueAt: 1, lastSeenAt: -1 })
      .limit(limit);

    return {
      count: signals.length,
      signals: signals.map(signal => this.sanitizeSignal(signal))
    };
  }

  sanitizeSignal(signal) {
    return {
      id: String(signal._id),
      workspaceId: signal.workspaceId ? String(signal.workspaceId) : null,
      connectorAccountId: signal.connectorAccountId ? String(signal.connectorAccountId) : null,
      provider: signal.provider,
      externalId: signal.externalId,
      sourceType: signal.sourceType,
      title: signal.title,
      description: signal.description,
      status: signal.status,
      priority: signal.priority,
      url: signal.url || null,
      owners: signal.owners || [],
      labels: signal.labels || [],
      dueAt: signal.dueAt || null,
      providerCreatedAt: signal.providerCreatedAt || null,
      providerUpdatedAt: signal.providerUpdatedAt || null,
      firstSeenAt: signal.firstSeenAt,
      lastSeenAt: signal.lastSeenAt,
      evidenceRefs: signal.evidenceRefs || [],
      syncState: signal.syncState || {},
      createdAt: signal.createdAt,
      updatedAt: signal.updatedAt
    };
  }

  resolveWorkspaceId(workspaceId) {
    return normalizeWorkspaceObjectId(workspaceId || getDefaultWorkspaceObjectId());
  }

  requireDatabase() {
    if (!this.isDatabaseReady()) {
      const error = new Error('Database connection is required to sync work signals');
      error.statusCode = 503;
      throw error;
    }
  }

  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }
}

const workSignalService = new WorkSignalService();
module.exports = workSignalService;
module.exports.WorkSignalService = WorkSignalService;
