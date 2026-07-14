const crypto = require('crypto');
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Board = require('../models/Board');
const Card = require('../models/Card');
const List = require('../models/List');
const Member = require('../models/Member');
const Comment = require('../models/Comment');
const Analytics = require('../models/Analytics');
const Intervention = require('../models/Intervention');
const Learning = require('../models/Learning');
const Performance = require('../models/Performance');
const Conversation = require('../models/Conversation');
const ConnectorAccount = require('../models/ConnectorAccount');
const Recommendation = require('../models/Recommendation');
const Approval = require('../models/Approval');
const DecisionQueueItem = require('../models/DecisionQueueItem');
const TrelloActionAttempt = require('../models/TrelloActionAttempt');
const AuditEvent = require('../models/AuditEvent');
const FollowUpPlan = require('../models/FollowUpPlan');
const WorkerResponse = require('../models/WorkerResponse');
const OutcomeRecord = require('../models/OutcomeRecord');
const CardFinding = require('../models/CardFinding');
const BoardHealthSnapshot = require('../models/BoardHealthSnapshot');
const WorkActor = require('../models/WorkActor');
const WorkComment = require('../models/WorkComment');
const WorkContainer = require('../models/WorkContainer');
const WorkDependency = require('../models/WorkDependency');
const WorkEvent = require('../models/WorkEvent');
const WorkItem = require('../models/WorkItem');
const PolicyRule = require('../models/PolicyRule');
const JobRun = require('../models/JobRun');
const JobControl = require('../models/JobControl');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const DEFAULT_BACKFILL_CONCURRENCY = 4;

const getDefaultWorkspaceKey = () => Workspace.defaultWorkspaceKey();
const getDefaultWorkspaceName = () => Workspace.defaultWorkspaceName();

const slugifyWorkspaceKey = (value) => {
  const slug = String(value || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
};

const objectIdFromWorkspaceKey = (value) => {
  const key = String(value || getDefaultWorkspaceKey());
  if (OBJECT_ID_PATTERN.test(key)) {
    return new mongoose.Types.ObjectId(key);
  }

  const hex = crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
};

const normalizeWorkspaceObjectId = (value) => objectIdFromWorkspaceKey(value || getDefaultWorkspaceKey());

const getDefaultWorkspaceObjectId = () => objectIdFromWorkspaceKey(getDefaultWorkspaceKey());

const getRequestWorkspaceObjectId = (req) => normalizeWorkspaceObjectId(req?.auth?.workspaceId);

const scopeQuery = (req, query = {}) => ({
  ...query,
  workspaceId: getRequestWorkspaceObjectId(req)
});

const defaultWorkspaceQuery = (query = {}) => ({
  ...query,
  workspaceId: getDefaultWorkspaceObjectId()
});

const workspaceScopedModels = [
  ['boards', Board],
  ['cards', Card],
  ['lists', List],
  ['members', Member],
  ['comments', Comment],
  ['analytics', Analytics],
  ['interventions', Intervention],
  ['learning', Learning],
  ['performance', Performance],
  ['conversations', Conversation],
  ['connectorAccounts', ConnectorAccount],
  ['recommendations', Recommendation],
  ['approvals', Approval],
  ['decisionQueueItems', DecisionQueueItem],
  ['trelloActionAttempts', TrelloActionAttempt],
  ['auditEvents', AuditEvent],
  ['followUpPlans', FollowUpPlan],
  ['workerResponses', WorkerResponse],
  ['outcomeRecords', OutcomeRecord],
  ['cardFindings', CardFinding],
  ['boardHealthSnapshots', BoardHealthSnapshot],
  ['workActors', WorkActor],
  ['workComments', WorkComment],
  ['workContainers', WorkContainer],
  ['workDependencies', WorkDependency],
  ['workEvents', WorkEvent],
  ['workItems', WorkItem],
  ['policyRules', PolicyRule],
  ['jobRuns', JobRun],
  ['jobControls', JobControl]
];

const missingWorkspaceQuery = () => ({
  $or: [
    { workspaceId: { $exists: false } },
    { workspaceId: null }
  ]
});

const getBackfillConcurrency = (value = process.env.SNEUP_WORKSPACE_BACKFILL_CONCURRENCY) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKFILL_CONCURRENCY;
  return Math.min(Math.max(parsed, 1), 16);
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length || 1);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
};

const ensureDefaultWorkspace = async () => {
  const workspaceId = getDefaultWorkspaceObjectId();
  const key = getDefaultWorkspaceKey();
  return Workspace.findByIdAndUpdate(
    workspaceId,
    {
      $setOnInsert: {
        _id: workspaceId,
        name: getDefaultWorkspaceName(),
        slug: slugifyWorkspaceKey(key),
        status: 'active',
        plan: 'local',
        metadata: {
          source: 'default-workspace-bootstrap',
          workspaceKey: key
        }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const backfillModelWorkspace = async (Model, workspaceId) => {
  const result = await Model.updateMany(
    missingWorkspaceQuery(),
    { $set: { workspaceId } }
  );

  return result.modifiedCount || result.nModified || 0;
};

const inspectDefaultWorkspaceBackfill = async ({
  models = workspaceScopedModels,
  workspaceId = getDefaultWorkspaceObjectId(),
  workspaceKey = getDefaultWorkspaceKey(),
  concurrency = getBackfillConcurrency()
} = {}) => {
  const normalizedConcurrency = getBackfillConcurrency(concurrency);
  const results = await mapWithConcurrency(models, normalizedConcurrency, async ([key, Model]) => [
    key,
    await Model.countDocuments(missingWorkspaceQuery())
  ]);

  const counts = Object.fromEntries(results);
  const totalMissing = Object.values(counts).reduce((total, count) => total + count, 0);

  return {
    mode: 'inspect',
    workspaceId: String(workspaceId),
    workspaceKey,
    concurrency: normalizedConcurrency,
    collections: counts,
    totalMissing
  };
};

const backfillDefaultWorkspace = async ({
  models = workspaceScopedModels,
  workspaceId = getDefaultWorkspaceObjectId(),
  workspaceKey = getDefaultWorkspaceKey(),
  concurrency = getBackfillConcurrency(),
  ensureWorkspace = ensureDefaultWorkspace
} = {}) => {
  const normalizedConcurrency = getBackfillConcurrency(concurrency);
  await ensureWorkspace();

  const results = await mapWithConcurrency(models, normalizedConcurrency, async ([key, Model]) => [
    key,
    await backfillModelWorkspace(Model, workspaceId)
  ]);

  const counts = Object.fromEntries(results);
  const totalModified = Object.values(counts).reduce((total, count) => total + count, 0);

  return {
    mode: 'apply',
    workspaceId: String(workspaceId),
    workspaceKey,
    concurrency: normalizedConcurrency,
    collections: counts,
    ...counts,
    totalModified
  };
};

const ensurePolicyRuleIndexes = async ({ Model = PolicyRule } = {}) => {
  let indexes = [];
  try {
    indexes = await Model.collection.indexes();
  } catch (error) {
    if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') {
      throw error;
    }
  }
  const legacyNameIndex = indexes.find((index) => index.unique === true
    && Object.keys(index.key || {}).length === 1
    && index.key.name === 1);

  if (legacyNameIndex) {
    await Model.collection.dropIndex(legacyNameIndex.name);
  }

  await Model.createIndexes();
  return { removedLegacyNameIndex: Boolean(legacyNameIndex) };
};

const ensureJobControlIndexes = async ({ Model = JobControl } = {}) => {
  let indexes = [];
  try {
    indexes = await Model.collection.indexes();
  } catch (error) {
    if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') throw error;
  }
  const legacyJobNameIndex = indexes.find((index) => index.unique === true
    && Object.keys(index.key || {}).length === 1
    && index.key.jobName === 1);
  if (legacyJobNameIndex) await Model.collection.dropIndex(legacyJobNameIndex.name);
  await Model.createIndexes();
  return { removedLegacyJobNameIndex: Boolean(legacyJobNameIndex) };
};

module.exports = {
  backfillDefaultWorkspace,
  defaultWorkspaceQuery,
  ensurePolicyRuleIndexes,
  ensureJobControlIndexes,
  ensureDefaultWorkspace,
  getBackfillConcurrency,
  getDefaultWorkspaceKey,
  getDefaultWorkspaceName,
  getDefaultWorkspaceObjectId,
  getRequestWorkspaceObjectId,
  inspectDefaultWorkspaceBackfill,
  mapWithConcurrency,
  missingWorkspaceQuery,
  normalizeWorkspaceObjectId,
  objectIdFromWorkspaceKey,
  scopeQuery,
  slugifyWorkspaceKey,
  workspaceScopedModels
};
